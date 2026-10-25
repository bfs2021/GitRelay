import { join } from "node:path";
import { resolveMain } from "./changes.ts";
import { publishUpstream, sessionsIn, type Identity } from "./mailbox.ts";
import { hash, isCommit, isId, readJson, writeJson, type Repository } from "./store.ts";

export async function readRef(repo: Repository, ref: string): Promise<{ ref: string; commit: string; eventId?: string; checkedAt?: string } | undefined> {
  const path = join(repo.directory, "refs", `${hash(ref)}.json`);
  const cursor = await readJson(path) as { ref: string; commit: string; eventId?: string; checkedAt?: string } | undefined;
  if (cursor === undefined) return;
  if (!cursor || cursor.ref !== ref || !isCommit(cursor.commit) || (cursor.eventId !== undefined && !isId(cursor.eventId)) || (cursor.checkedAt !== undefined && !Number.isFinite(Date.parse(cursor.checkedAt)))) throw new Error(`Invalid ref cursor: ${path}`);
  return cursor;
}

/** Caller owns publish.lock; monitoring uses the common directory, not a possibly removed worktree. */
export async function synchronizeRef(repo: Repository, ref: string, identity: Identity, signal?: AbortSignal): Promise<string> {
  const current = await resolveMain(repo.common, ref, signal);
  const cursor = await readRef(repo, ref);
  let eventId = cursor?.eventId;
  if (cursor && cursor.commit !== current) {
    const recipients = (await sessionsIn(repo)).filter((session) => !session.closedAt && session.ref === ref).map((session) => session.key);
    const event = await publishUpstream(repo, identity, ref, cursor.commit, current, recipients, eventId);
    eventId = event.id;
  }
  signal?.throwIfAborted();
  // Keep the chain head even after GC removes its event; it is an ID, not a file dependency.
  await writeJson(join(repo.directory, "refs", `${hash(ref)}.json`), { ref, commit: current, eventId, checkedAt: new Date().toISOString() });
  return current;
}
