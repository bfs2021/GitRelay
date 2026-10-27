import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { constants, statSync, type BigIntStats } from "node:fs";
import { link, lstat, open, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { Transform } from "node:stream";
import { isDeepStrictEqual } from "node:util";
import { consumeMailbox, type DeliveryLocation } from "../../core/consumer.ts";
import { readCursor, watchRoot, type Cursor } from "../../core/changes.ts";
import { formatNotifications, type Notification, type SharedEvent } from "../../core/mailbox.ts";
import { hash, readJson } from "../../core/store.ts";

export const WATCH_STATE = "worktree-watch-state"; // Legacy checkpoints remain readable.
export const WATCH_MESSAGE = "worktree-upstream-change";

type DiskEntry = { parentId: string | null; type: string; customType?: string; payload?: unknown };
export type Delivery = { pending?: string[]; started?: boolean; owner?: WeakRef<object>; onConfirmed?: () => void };
type OwnedProof = { path: string; dev: number; ino: number; contents: string };

async function readProof(path: string, id: string, digest: string): Promise<boolean> {
  try {
    const info = await lstat(path).catch((error) => { if (error.code === "ENOENT") return undefined; throw error; });
    if (!info) return false;
    if (!info.isFile()) throw new Error("Not a regular file");
    const value = await readJson(path) as { eventId?: unknown; digest?: unknown } | undefined;
    if (!value || value.eventId !== id || value.digest !== digest) throw new Error("Proof contents do not match");
    return true;
  } catch (error) {
    throw new Error(`Pi delivery proof is invalid or unreadable for event ${id}; preserve the session file, proof and unread event for manual recovery.`, { cause: error });
  }
}

async function removeOwnedProof(proof: OwnedProof, source = proof.path): Promise<void> {
  try {
    const before = await lstat(proof.path).catch((error) => { if (error.code === "ENOENT") return undefined; throw error; });
    if (!before) return;
    if (!before.isFile() || before.dev !== proof.dev || before.ino !== proof.ino || await readFile(source, "utf8") !== proof.contents) throw new Error("Proof ownership or contents changed");
    const after = await lstat(proof.path);
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw new Error("Proof changed during inspection");
    await rm(proof.path);
  } catch (error) {
    throw new Error(`Pi pre-send proof could not be safely removed; preserved for manual recovery: ${proof.path}`, { cause: error });
  }
}

async function writeProof(path: string, id: string, digest: string, signal: AbortSignal): Promise<OwnedProof | undefined> {
  if (await readProof(path, id, digest)) return;
  const temporary = `${path}.${randomUUID()}.tmp`;
  const contents = JSON.stringify({ eventId: id, digest });
  let owned: OwnedProof | undefined;
  let ownedTemporary: OwnedProof | undefined;
  try {
    await writeFile(temporary, contents, { mode: 0o600, flag: "wx" });
    const witness = await lstat(temporary);
    ownedTemporary = { path: temporary, dev: witness.dev, ino: witness.ino, contents };
    signal.throwIfAborted();
    let created = true;
    await link(temporary, path).catch((error) => { if (error.code !== "EEXIST") throw error; created = false; });
    if (created) owned = { path, dev: witness.dev, ino: witness.ino, contents };
    if (!(await readProof(path, id, digest))) throw new Error(`Pi delivery proof disappeared: ${path}`);
  } catch (error) {
    if (owned) await removeOwnedProof(owned, temporary);
    if (!ownedTemporary) throw new Error(`Pi temporary proof ownership could not be verified; preserved if present: ${temporary}`, { cause: error });
    throw error;
  } finally {
    try { if (ownedTemporary) await removeOwnedProof(ownedTemporary); }
    catch (error) { if (owned) await removeOwnedProof(owned, temporary); throw error; }
  }
  return owned;
}

export function createWatcher(pi: ExtensionAPI, ctx: ExtensionContext, ref: string, delivery: Delivery = {}) {
  const abort = new AbortController();
  let active: Promise<void> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let initialized = false;
  let initialCursor: Cursor | undefined;
  let lastError = "";
  let diskCache: { file: string; session: string; signature: string; entries: Map<string, DiskEntry> } | undefined;
  let observedFile: { file: string; session: string } | undefined;

  async function check() {
    if (abort.signal.aborted) return;
    if (!initialized) {
      let root: string;
      try { root = await watchRoot(ctx.cwd, abort.signal); }
      catch (error) {
        const failure = (error as Error)?.cause as { code?: unknown; signal?: unknown; killed?: boolean } | undefined;
        // shortcut: exit 128 also covers damaged repos; improve when Git exposes a reliable distinction.
        if (failure?.code === 128 && !failure.signal && !failure.killed) return;
        throw error;
      }
      for (const entry of ctx.sessionManager.getBranch()) {
        const value = entry.type === "custom" && entry.customType === WATCH_STATE ? entry.data
          : entry.type === "custom_message" && entry.customType === WATCH_MESSAGE ? entry.details : undefined;
        initialCursor = readCursor(value, root, ref) ?? initialCursor;
      }
      initialized = true;
    }
    const sessionId = ctx.sessionManager.getSessionId();
    const file = ctx.sessionManager.getSessionFile();
    let diskEntries: Map<string, DiskEntry> | undefined;
    let diskSignature: string | undefined;
    const signature = (value: BigIntStats) => `${value.dev}:${value.ino}:${value.size}:${value.mtimeNs}:${value.ctimeNs}`;
    if (file) {
      try {
        const before = await stat(file, { bigint: true });
        if (!before.isFile()) throw new Error(`Pi session path is not a regular file: ${file}`);
        observedFile = { file, session: sessionId };
        const key = signature(before);
        diskSignature = key;
        if (diskCache?.file === file && diskCache.session === sessionId && diskCache.signature === key) {
          diskEntries = diskCache.entries;
        } else {
          const handle = await open(file, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
          try {
            const opened = await handle.stat({ bigint: true });
            if (!opened.isFile() || signature(opened) !== key) throw new Error("Pi session file changed before reading");
            const stream = handle.createReadStream({ autoClose: false, signal: abort.signal });
            let lastByte: number | undefined;
            const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
            const decoded = new Transform({
              transform(chunk, _encoding, done) {
                if (chunk.length) lastByte = chunk[chunk.length - 1];
                try { done(null, decoder.decode(chunk, { stream: true })); }
                catch (error) { done(new Error(`Invalid UTF-8 in Pi session file: ${file}`, { cause: error })); }
              },
              flush(done) {
                try { done(null, decoder.decode()); }
                catch (error) { done(new Error(`Invalid UTF-8 in Pi session file: ${file}`, { cause: error })); }
              },
            });
            const lines = createInterface({ input: decoded, crlfDelay: Infinity });
            let readError: Error | undefined;
            stream.on("error", (error) => { readError = error; lines.close(); });
            decoded.on("error", (error) => { readError = error; lines.close(); });
            stream.pipe(decoded);
            diskEntries = new Map();
            let first = true;
            let invalidTail = false;
            try {
              for await (const line of lines) {
                if (!line.trim()) continue;
                let entry: any;
                try { entry = JSON.parse(line); } catch { continue; }
                if (!entry) continue; // Pi ignores malformed or empty entries when opening a session.
                if (first) {
                  if (entry.type !== "session" || entry.id !== sessionId) throw new Error("Pi session file does not match the active session");
                  first = false;
                  continue;
                }
                if (typeof entry.id !== "string" || !entry.id) { invalidTail = true; continue; }
                invalidTail = false;
                if (diskEntries.has(entry.id)) throw new Error("Invalid Pi session entry ID");
                diskEntries.set(entry.id, {
                  parentId: entry.parentId, type: entry.type, customType: entry.customType,
                  payload: entry.type === "custom_message" && entry.customType === WATCH_MESSAGE
                    ? JSON.parse(JSON.stringify({ content: entry.content, display: entry.display, details: entry.details })) : undefined,
                });
              }
              if (readError) throw readError;
              if (first) throw new Error("Pi session file is empty");
              if (lastByte !== 10) throw new Error(`Pi session file has an incomplete final line; stop the session and restore an intact session file: ${file}`);
              if (invalidTail) throw new Error("Pi session file has an invalid final entry ID");
            } finally {
              lines.close();
              stream.unpipe(decoded);
              decoded.destroy();
              await new Promise<void>((resolve) => {
                if (stream.closed) resolve();
                else { stream.once("close", resolve); stream.destroy(); }
              });
            }
          } finally {
            await handle.close();
          }
          if (signature(await stat(file, { bigint: true })) !== key) throw new Error("Pi session file changed during reading");
          diskCache = { file, session: sessionId, signature: key, entries: diskEntries };
        }
      } catch (error) {
        diskCache = undefined;
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        const entries = ctx.sessionManager.getEntries?.() ?? ctx.sessionManager.getBranch();
        const hasConversation = entries.some((entry) => entry.type === "message" && (entry.message.role === "user" || entry.message.role === "assistant"));
        if ((observedFile?.file === file && observedFile.session === sessionId) || hasConversation) throw new Error(`Pi session file disappeared; stop the session and restore an intact session file: ${file}`);
      }
    } else diskCache = undefined;
    let delivered: Map<string, { content: unknown; display: unknown; details: unknown; eventIds: unknown[]; notifications: unknown }> | undefined;
    const verified = new Map<string, object>();
    let recorded: Set<string> | undefined;
    let incomplete = false;
    let leaf: string | null;
    let session: string;
    let proofEvents: Set<string> | undefined;
    function refresh(): void {
      if (ctx.sessionManager.getSessionId() !== sessionId || ctx.sessionManager.getSessionFile() !== file) throw new Error("Pi session changed during worktree monitoring");
      const currentLeaf = ctx.sessionManager.getLeafId();
      if (currentLeaf !== null && (typeof currentLeaf !== "string" || !currentLeaf)) throw new Error("Pi session has an invalid leaf ID");
      // Pi's history is append-only; refresh immediately when its branch/session changes.
      if (!delivered || leaf !== currentLeaf || session !== sessionId) {
        delivered = new Map();
        recorded = new Set();
        incomplete = false;
        let persistedPrefix = Boolean(diskEntries);
        let parentId: string | null = null;
        for (const entry of ctx.sessionManager.getBranch()) {
          if (typeof entry.id !== "string" || !entry.id) throw new Error("Pi session branch has an invalid entry ID");
          if (entry.parentId !== parentId) throw new Error(`Pi session branch has a missing parent; stop the session and restore an intact session file: ${file ?? "unavailable"}`);
          parentId = entry.id;
          const disk = diskEntries?.get(entry.id);
          if (!disk || disk.parentId !== entry.parentId || disk.type !== entry.type) { persistedPrefix = false; incomplete = true; }
          if (entry.type !== "custom_message" || entry.customType !== WATCH_MESSAGE) continue;
          const ids = (entry.details as { eventIds?: unknown } | undefined)?.eventIds;
          if (Array.isArray(ids)) for (const eventId of ids) if (typeof eventId === "string") recorded.add(eventId);
          const payload = JSON.parse(JSON.stringify({ content: entry.content, display: entry.display, details: entry.details }));
          if (disk && (disk.customType !== WATCH_MESSAGE || !isDeepStrictEqual(disk.payload, payload))) { persistedPrefix = false; incomplete = true; }
          if (persistedPrefix && Array.isArray(ids)) {
            const notifications = (entry.details as { notifications?: unknown } | undefined)?.notifications;
            for (const eventId of ids) if (typeof eventId === "string") delivered.set(eventId, { content: entry.content, display: entry.display, details: entry.details, eventIds: ids, notifications });
          }
        }
        if (parentId !== currentLeaf) throw new Error("Pi session branch does not reach its leaf");
        if (!incomplete && delivery.pending?.every((id) => delivered!.has(id))) {
          verifySnapshot("delivery confirmation");
          delivery.pending = undefined;
          delivery.started = undefined;
          delivery.onConfirmed?.();
        }
        leaf = currentLeaf;
        session = sessionId;
      }
    }
    async function isDelivered(id: string, event?: SharedEvent, location?: DeliveryLocation): Promise<boolean> {
      refresh();
      const record = delivered!.get(id);
      if (incomplete || !record) return false;
      verifySnapshot("delivery confirmation");
      const notifications = record.notifications;
      const invalid = () => new Error(`Pi delivery record cannot be verified for event ${id}; preserve the session file and unread event for recovery.`);
      if (!Array.isArray(notifications) || notifications.length !== record.eventIds.length || typeof record.content !== "string") throw invalid();
      const ids: string[] = [];
      for (const item of notifications) {
        if (!item || typeof item !== "object" || (item.kind !== "message" && item.kind !== "upstream") || !item.event || item.event.kind !== item.kind || typeof item.event.id !== "string") throw invalid();
        if (item.kind === "upstream" && (!item.change || item.change.eventId !== item.event.id || item.change.ref !== item.event.ref || item.change.previous !== item.event.previous || item.change.commit !== item.event.commit)) throw invalid();
        ids.push(item.event.id);
      }
      const recordedEvent = notifications[ids.indexOf(id)]?.event;
      if (!location || !event || !recordedEvent || !Array.isArray(recordedEvent.recipients) || !recordedEvent.recipients.includes(location.sessionKey) || !event.recipients.includes(location.sessionKey)) throw invalid();
      let sameEvent = isDeepStrictEqual(recordedEvent, event);
      if (!sameEvent && recordedEvent.kind === "upstream" && event.kind === "upstream") {
        const { recipients: oldRecipients, ...oldFields } = recordedEvent;
        const { recipients: currentRecipients, ...currentFields } = event;
        const current = new Set(currentRecipients);
        sameEvent = oldRecipients.every((recipient: unknown) => current.has(recipient as string)) && isDeepStrictEqual(oldFields, currentFields);
      }
      if (!isDeepStrictEqual(ids, record.eventIds) || new Set(ids).size !== ids.length || !sameEvent) throw invalid();
      try { if (record.content !== formatNotifications(notifications as Notification[])) throw invalid(); }
      catch { throw invalid(); }
      const digest = hash({ customType: WATCH_MESSAGE, content: record.content, display: record.display, details: record.details });
      if (!(await readProof(join(location.repository.directory, "receipts", location.sessionKey, `${id}.${digest}.pi-proof`), id, digest))) throw new Error(`Pi delivery proof is missing or invalid for event ${id}; preserve the session file and unread event for manual recovery.`);
      abort.signal.throwIfAborted();
      refresh();
      verifySnapshot("delivery confirmation");
      if (delivered!.get(id) !== record) throw new Error("Pi session branch changed before delivery confirmation");
      verified.set(id, record);
      return true;
    }
    function beforeReceipt(id: string): void {
      abort.signal.throwIfAborted();
      refresh();
      if (!verified.has(id) || delivered!.get(id) !== verified.get(id)) throw new Error("Pi session branch changed before delivery confirmation");
      verifySnapshot("delivery confirmation");
    }
    function verifySnapshot(action: string): void {
      if (file && diskEntries && signature(statSync(file, { bigint: true })) !== diskSignature) {
        diskCache = undefined;
        throw new Error(`Pi session file changed before ${action}`);
      }
    }
    function isRecorded(id: string): boolean {
      refresh();
      return recorded!.has(id);
    }
    async function isPending(id: string, _event?: SharedEvent, location?: DeliveryLocation): Promise<boolean> {
      if (isRecorded(id)) return true;
      if (!location) throw new Error("Pi delivery location is unavailable; unread events were preserved.");
      if (!proofEvents) {
        const names = await readdir(join(location.repository.directory, "receipts", location.sessionKey));
        abort.signal.throwIfAborted();
        refresh();
        verifySnapshot("delivery inspection");
        proofEvents = new Set(names.flatMap((name) => {
          const match = /^([a-f0-9]{64})\.[a-f0-9]{64}\.pi-proof$/.exec(name);
          return match ? [match[1]] : [];
        }));
      }
      if (isRecorded(id)) return true;
      if (!proofEvents.has(id)) return false;
      if (!ctx.isIdle() || ctx.hasPendingMessages()) return true;
      throw new Error(`Pi delivery outcome is unknown for event ${id}; preserve and inspect the session file ${file ?? "(unavailable)"}, proofs in ${join(location.repository.directory, "receipts", location.sessionKey)}, and unread event in ${join(location.repository.directory, "events")} for manual recovery.`);
    }
    await consumeMailbox({
      cwd: ctx.cwd, ref, adapter: "pi", session: sessionId,
      signal: abort.signal, initialCursor, isDelivered, beforeReceipt, isPending,
      async deliver(notifications, location) {
        refresh();
        if (incomplete && diskEntries) return false;
        // Pi does not expose its custom follow-up queue to extensions.
        if (!ctx.isIdle() || ctx.hasPendingMessages()) return false;
        if (delivery.pending && !delivery.pending.every(isRecorded) && (!delivery.started || (delivery.owner && delivery.owner.deref() !== ctx.sessionManager))) {
          throw new Error("Pi delivery outcome is unknown; preserve the session file, proofs and unread events for manual recovery.");
        }
        verifySnapshot("delivery");
        const eventIds = notifications.map((notification) => notification.event.id);
        const message = { customType: WATCH_MESSAGE, content: formatNotifications(notifications), display: true, details: { eventIds, notifications } };
        if (!location) throw new Error("Pi delivery location is unavailable; unread events were preserved.");
        const digest = hash(message);
        const created: OwnedProof[] = [];
        let sending = false;
        try {
          for (const id of eventIds) {
            const proof = await writeProof(join(location.repository.directory, "receipts", location.sessionKey, `${id}.${digest}.pi-proof`), id, digest, abort.signal);
            if (proof) created.push(proof);
          }
          abort.signal.throwIfAborted();
          refresh();
          verifySnapshot("delivery");
          abort.signal.throwIfAborted();
          sending = true;
          pi.sendMessage(message, { triggerTurn: true, deliverAs: "followUp" });
        } finally {
          if (!sending) for (const proof of created) await removeOwnedProof(proof);
        }
        delivery.pending = eventIds;
        delivery.owner = new WeakRef(ctx.sessionManager);
        delivery.started = !ctx.isIdle();
        return false; // A queued message is not durable until Pi appends it to the session.
      },
    });
    if (incomplete && file && diskEntries && diskSignature === signature(await stat(file, { bigint: true }))) {
      throw new Error(`Pi session history is not fully persisted; stop the session and resume from an intact session file: ${file}`);
    }
  }

  function tick(): Promise<void> {
    if (active) return active;
    active = check().then(() => { lastError = ""; }).catch((error) => {
      if (abort.signal.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      if (message !== lastError) {
        try {
          ctx.ui.notify(`Worktree monitoring is temporarily unavailable; retrying: ${message}`, "warning");
          lastError = message;
        } catch {
          // A host can invalidate its UI while an asynchronous check is finishing.
          // Keep retrying without turning the timer callback into an unhandled rejection.
        }
      }
    }).finally(() => { active = undefined; });
    return active;
  }

  return {
    tick,
    async start() {
      await tick();
      if (!abort.signal.aborted && !timer) {
        timer = setInterval(() => { void tick(); }, 5000);
        timer.unref();
      }
    },
    async stop() {
      abort.abort();
      if (timer) clearInterval(timer);
      await active;
    },
  };
}
