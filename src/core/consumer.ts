import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { inspectChange, readCursor, worktreeFiles, type Change, type Cursor } from "./changes.ts";
import { eventsIn, publishUpstream, readReceipt, readSession, registerSession, sessionKey, validateIdentity, type Identity, type Notification } from "./mailbox.ts";
import { BusyError, readJson, repository, withLock, writeJson } from "./store.ts";
import { daemonStatus } from "./daemon-state.ts";
import { readRef, synchronizeRef } from "./publisher.ts";

export interface MailboxOptions extends Identity {
  cwd: string;
  ref: string;
  signal?: AbortSignal;
  initialCursor?: Cursor;
  isDelivered?(eventId: string): boolean;
  /** false means queued but not durably accepted: retry without writing a receipt. */
  deliver(notifications: Notification[]): Promise<void | boolean>;
  upstreamOnly?: boolean;
}

/** Register, publish shared ref updates, then consume this session's independent inbox. */
export async function consumeMailbox(options: MailboxOptions): Promise<Notification[]> {
  validateIdentity(options);
  options.signal?.throwIfAborted();
  const repo = await repository(options.cwd, options.signal);
  const key = sessionKey(repo, options, options.ref);
  try {
    return await withLock(join(repo.directory, "sessions", `${key}.lock`), async () => {
      let current = "";
      const subscribed = await withLock(join(repo.directory, "publish.lock"), async () => {
        options.signal?.throwIfAborted();
        const existing = await readSession(repo, key);
        if (existing?.closedAt) return false;
        const cached = await readRef(repo, options.ref);
        const daemon = await daemonStatus();
        const age = cached?.checkedAt ? Date.now() - Date.parse(cached.checkedAt) : Infinity;
        if (existing && cached && daemon.running && age >= 0 && age <= Math.max(15_000, daemon.state!.intervalMs * 3)) current = cached.commit;
        else current = await synchronizeRef(repo, options.ref, options, options.signal);
        await writeJson(join(repo.directory, "repo.json"), { id: repo.id, common: repo.common });
        const registered = await registerSession(repo, options, options.ref, current);
        if (!registered.migrated) {
          const legacyPath = join(repo.common, "worktree-agent-sync", `${key}.json`);
          const legacy = options.initialCursor ?? await readJson(legacyPath);
          const previous = legacy === undefined ? undefined : readCursor(legacy, repo.root, options.ref);
          if (legacy !== undefined && !previous) throw new Error(`Invalid legacy cursor: ${legacyPath}`);
          const baseline = registered.baseline!;
          if (previous && previous.commit !== baseline) await publishUpstream(repo, options, options.ref, previous.commit, baseline, [key], `migration:${key}`);
          await writeJson(join(repo.directory, "sessions", `${key}.json`), { ...registered, migrated: true });
        }
        return true;
      });
      if (!subscribed) return [];
      const receipts = join(repo.directory, "receipts", key);
      await mkdir(receipts, { recursive: true, mode: 0o700 });
      const notifications: Notification[] = [];
      let localFiles: Set<string> | undefined;
      let size = 0;
      for (const event of await eventsIn(repo)) {
        options.signal?.throwIfAborted();
        if (!event.recipients.includes(key) || (options.upstreamOnly && event.kind !== "upstream")) continue;
        const receipt = join(receipts, `${event.id}.json`);
        const existing = await readReceipt(repo, key, event.id);
        if (existing) continue;
        if (options.isDelivered?.(event.id)) {
          await writeJson(receipt, { eventId: event.id, status: "delivered", at: new Date().toISOString() });
          continue;
        }
        let notification: Notification | undefined;
        if (event.kind === "upstream" && event.ref === options.ref) {
          const change = await inspectChange({ root: repo.root, ref: event.ref, commit: event.previous }, event.commit, options.signal);
          if (change) notification = { kind: "upstream", event, change: { ...change, eventId: event.id } };
        } else if (event.kind === "message") {
          if (event.files.length) localFiles ??= await worktreeFiles(repo.root, current, options.signal);
          if (!event.files.length || event.files.some((file) => localFiles!.has(file))) notification = { kind: "message", event };
        }
        if (!notification) {
          await writeJson(receipt, { eventId: event.id, status: "irrelevant", at: new Date().toISOString() });
          continue;
        }
        const length = JSON.stringify(notification).length;
        if (notifications.length && (notifications.length >= 8 || size + length > 64 * 1024)) break;
        notifications.push(notification);
        size += length;
      }
      if (!notifications.length) return [];
      options.signal?.throwIfAborted();
      const accepted = await options.deliver(notifications);
      options.signal?.throwIfAborted();
      if (accepted !== false) {
        for (const notification of notifications) await writeJson(join(receipts, `${notification.event.id}.json`), { eventId: notification.event.id, status: "delivered", at: new Date().toISOString() });
      }
      return notifications;
    });
  } catch (error) {
    if (error instanceof BusyError) return [];
    throw error;
  }
}

export interface ConsumerOptions extends Identity {
  cwd: string;
  ref: string;
  signal?: AbortSignal;
  deliver(change: Change): Promise<void>;
}

/** Compatibility API for hosts that only consume upstream changes, not agent messages. */
export async function consumeChanges(options: ConsumerOptions): Promise<Change | undefined> {
  const notifications = await consumeMailbox({
    ...options, upstreamOnly: true,
    async deliver(batch) {
      for (const notification of batch) if (notification.kind === "upstream") await options.deliver(notification.change);
    },
  });
  return notifications.find((notification) => notification.kind === "upstream")?.change;
}
