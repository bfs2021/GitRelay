import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { watchRoot } from "../core/changes.ts";
import { git, gitPathLine } from "../core/git.ts";
import { sessionKey, validateEvent, validateReceipt, validateSession } from "../core/mailbox.ts";
import { assertMigrationReady, hash, isId, repositoryIdentity, stateDirectory, type Repository } from "../core/store.ts";

// Read the named regular file once through the same descriptor and reject changes.
async function snapshot(path: string): Promise<{ value: unknown; sha256: string } | undefined> {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const named = await lstat(path).catch((failure) => { if (failure.code === "ENOENT") return undefined; throw failure; });
    if (named) throw new Error(`Inspection path changed or is a dangling link: ${path}`);
    return undefined;
  }
  try {
    const before = await file.stat({ bigint: true });
    const named = await lstat(path, { bigint: true });
    if (!before.isFile() || !named.isFile() || before.dev !== named.dev || before.ino !== named.ino || before.size > 2n * 1024n * 1024n) throw new Error(`Invalid inspection file: ${path}`);
    const chunks: Buffer[] = [];
    let size = 0;
    for (;;) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, 2 * 1024 * 1024 + 1 - size));
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > 2 * 1024 * 1024) throw new Error(`Inspection file exceeds 2 MiB: ${path}`);
      chunks.push(buffer.subarray(0, bytesRead));
    }
    const after = await file.stat({ bigint: true }), current = await lstat(path, { bigint: true });
    if (!current.isFile() || before.dev !== current.dev || before.ino !== current.ino || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || before.size !== BigInt(size) || current.mtimeNs !== after.mtimeNs || current.ctimeNs !== after.ctimeNs) throw new Error(`Inspection file changed: ${path}`);
    const data = Buffer.concat(chunks, size);
    let value: unknown;
    try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data)); }
    catch { throw new Error(`Invalid JSON or UTF-8 in inspection file: ${path}`); }
    return { value, sha256: createHash("sha256").update(data).digest("hex") };
  } finally { await file.close(); }
}

/** Read-only evidence; observed matching proofs do not establish a complete batch. */
export async function inspectPi(cwd: string, ref: string, session: string, eventId: string, signal?: AbortSignal, instance?: string): Promise<object> {
  if (!isId(eventId)) throw new Error("--event must be a 64-character event ID.");
  const root = await watchRoot(cwd, signal);
  const common = await realpath(gitPathLine(await git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"], signal, "paths")));
  const identity = await repositoryIdentity(common, false);
  if (!identity) throw new Error(`No existing GitRelay repository identity: ${common}`);
  const id = hash([common, identity.identity]);
  const repo: Repository = { root, common, id, directory: join(stateDirectory(), "repos", id), ...identity };
  const key = sessionKey(repo, { adapter: "pi", session, instance }, ref);
  const directory = join(repo.directory, "receipts", key);
  const collect = async () => {
    signal?.throwIfAborted();
    const owner = await snapshot(join(repo.directory, "identity-owner.json"));
    const ready = await snapshot(join(repo.directory, "identity-ready.json"));
    const metadata = await snapshot(join(repo.directory, "repo.json"));
    if (!owner || !ready || (owner.value as { id?: unknown } | undefined)?.id !== id || (ready.value as { id?: unknown } | undefined)?.id !== id) throw new Error(`GitRelay state is not initialized: ${repo.directory}`);
    const meta = metadata?.value as { id?: unknown; common?: unknown; identity?: unknown; identitySource?: unknown } | undefined;
    if (!meta || meta.id !== id || meta.common !== common || meta.identity !== identity.identity || meta.identitySource !== identity.identitySource) throw new Error(`Invalid GitRelay repository metadata: ${repo.directory}`);
    await assertMigrationReady(repo).catch(() => { throw new Error(`GitRelay migration is incomplete or invalid: ${repo.directory}`); });
    const sessionFile = await snapshot(join(repo.directory, "sessions", `${key}.json`));
    let stored;
    try { stored = sessionFile ? validateSession(sessionFile.value, key) : undefined; }
    catch { throw new Error(`Invalid pi subscription: ${key}`); }
    if (!sessionFile || !stored || stored.root !== root || stored.ref !== ref || stored.adapter !== "pi" || stored.session !== session) throw new Error(`No matching pi subscription: ${key}`);
    const names = (await readdir(directory).catch((error) => { if (error.code === "ENOENT") return []; throw error; })).sort();
    if (names.length > 100_000) throw new Error(`Too many receipt entries to inspect safely: ${directory}`);
    const pattern = /^([a-f0-9]{64})\.([a-f0-9]{64})\.pi-proof$/;
    const parsed = names.flatMap((name) => { const match = pattern.exec(name); return match ? [{ name, event: match[1], digest: match[2] }] : []; });
    const digests = new Set(parsed.filter((entry) => entry.event === eventId).map((entry) => entry.digest));
    const grouped = parsed.filter((entry) => digests.has(entry.digest));
    if (grouped.length > 4096) throw new Error("Too many related proofs to inspect safely; no state was changed.");
    const proofs = [];
    for (const entry of grouped) {
      signal?.throwIfAborted();
      const path = join(directory, entry.name), data = await snapshot(path);
      const value = data?.value as { eventId?: unknown; digest?: unknown } | undefined;
      if (!data || value?.eventId !== entry.event || value.digest !== entry.digest) throw new Error(`Invalid or changing pi proof: ${path}`);
      proofs.push({ eventId: entry.event, digest: entry.digest, path, sha256: data.sha256 });
    }
    const events = [];
    for (const related of [...new Set([eventId, ...grouped.map((entry) => entry.event)])].sort()) {
      signal?.throwIfAborted();
      const path = join(repo.directory, "events", `${related}.json`), data = await snapshot(path);
      let event;
      try { event = data ? validateEvent(data.value, related) : undefined; }
      catch { throw new Error(`Invalid event: ${path}`); }
      if (related === eventId && (!event || !event.recipients.includes(key))) throw new Error(`Event is missing or does not address this pi session: ${path}`);
      const receiptPath = join(directory, `${related}.json`), receiptFile = await snapshot(receiptPath);
      let receipt;
      try { receipt = receiptFile ? validateReceipt(receiptFile.value, related, receiptPath) : undefined; }
      catch { throw new Error(`Invalid receipt: ${receiptPath}`); }
      events.push({ eventId: related, path, present: !!event, addressedToSession: event ? event.recipients.includes(key) : null, kind: event?.kind, eventSha256: data?.sha256, receiptPath, receiptStatus: receipt?.status ?? null, receiptSha256: receiptFile?.sha256 });
    }
    return { owner: owner.sha256, ready: ready.sha256, metadata: metadata!.sha256, session: sessionFile.sha256, namesHash: hash(names), proofs, events };
  };
  const first = await collect(), second = await collect();
  if (hash(first) !== hash(second)) throw new Error("Pi evidence changed during inspection; retry after stopping relevant processes.");
  const finalIdentity = await repositoryIdentity(common, false);
  if (!finalIdentity || finalIdentity.identity !== identity.identity || finalIdentity.identitySource !== identity.identitySource) throw new Error("GitRelay repository identity changed during inspection.");
  return { repository: { id, root, common }, session: { id: session, key, ref }, receiptsDirectory: directory, proofs: first.proofs, events: first.events, fingerprint: hash(first), note: "Matching digests show observed proofs only; they do not establish a complete batch or host delivery. No state was changed." };
}
