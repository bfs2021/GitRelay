import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { readSession, registerSession, sessionKey, sessionsIn, validateIdentity, type Identity, type Session } from "./mailbox.ts";
import { synchronizeRef } from "./publisher.ts";
import { hash, isId, readJson, repository, stateDirectory, withLock, writeJson, type Repository } from "./store.ts";

interface SessionOptions extends Identity {
  cwd: string;
  ref: string;
  signal?: AbortSignal;
}

async function leavingRepository(options: SessionOptions): Promise<Repository> {
  try { return await repository(options.cwd, options.signal); }
  catch (error) {
    options.signal?.throwIfAborted();
    // Only a missing worktree permits lookup by its persisted absolute root.
    const exists = await stat(options.cwd).catch((failure) => {
      if (failure.code === "ENOENT") return undefined;
      throw failure;
    });
    if (exists) throw error;
    const root = resolve(options.cwd);
    const repos = join(stateDirectory(), "repos");
    const matches: Repository[] = [];
    for (const id of await readdir(repos).catch((failure) => {
      if (failure.code === "ENOENT") return [];
      throw failure;
    })) {
      options.signal?.throwIfAborted();
      if (!isId(id)) continue;
      const directory = join(repos, id);
      const metadata = await readJson(join(directory, "repo.json")) as { id?: string; common?: string } | undefined;
      if (!metadata) continue;
      if (metadata.id !== id || typeof metadata.common !== "string" || hash(metadata.common) !== id) throw new Error(`Invalid repository metadata: ${id}`);
      const repo = { root, id, directory, common: metadata.common };
      if ((await sessionsIn(repo)).some((session) => session.root === root && session.ref === options.ref && session.adapter === options.adapter && session.session === options.session)) matches.push(repo);
    }
    if (matches.length !== 1) throw new Error("Cannot uniquely locate the removed worktree subscription; use its original absolute --cwd path.", { cause: error });
    return matches[0];
  }
}

/** Explicit opt-out; do not acknowledge or delete unread messages. */
export async function leaveSession(options: SessionOptions): Promise<Session | undefined> {
  validateIdentity(options);
  const repo = await leavingRepository(options);
  const key = sessionKey(repo, options, options.ref);
  return withLock(join(repo.directory, "sessions", `${key}.lock`), () => withLock(join(repo.directory, "publish.lock"), async () => {
    const session = await readSession(repo, key);
    if (!session || session.closedAt) return session;
    const now = new Date().toISOString();
    const closed = { ...session, closedAt: now, lastSeen: now };
    await writeJson(join(repo.directory, "sessions", `${key}.json`), closed);
    return closed;
  }, { signal: options.signal, waitMs: 5000 }), { signal: options.signal });
}

/** Explicit rejoin keeps old inbox/receipts, but does not replay publications while closed. */
export async function joinSession(options: SessionOptions): Promise<Session> {
  validateIdentity(options);
  const repo = await repository(options.cwd, options.signal);
  const key = sessionKey(repo, options, options.ref);
  return withLock(join(repo.directory, "sessions", `${key}.lock`), () => withLock(join(repo.directory, "publish.lock"), async () => {
    const current = await synchronizeRef(repo, options.ref, options, options.signal);
    await writeJson(join(repo.directory, "repo.json"), { id: repo.id, common: repo.common });
    const registered = await registerSession(repo, options, options.ref, current);
    const open = { ...registered, closedAt: undefined };
    await writeJson(join(repo.directory, "sessions", `${key}.json`), open);
    return open;
  }, { signal: options.signal, waitMs: 5000 }), { signal: options.signal });
}
