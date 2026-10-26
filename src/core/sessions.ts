import { join } from "node:path";
import { readSession, registerSession, sessionKey, validateIdentity, type Identity, type Session } from "./mailbox.ts";
import { synchronizeRef } from "./publisher.ts";
import { repository, withLock, writeJson } from "./store.ts";

interface SessionOptions extends Identity {
  cwd: string;
  ref: string;
  signal?: AbortSignal;
}

/** Explicit opt-out; do not acknowledge or delete unread messages. */
export async function leaveSession(options: SessionOptions): Promise<Session | undefined> {
  validateIdentity(options);
  const repo = await repository(options.cwd, options.signal);
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
