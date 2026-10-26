import { readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { eventsIn, readReceipt, readSession, validateEvent, type SharedEvent } from "./mailbox.ts";
import { BusyError, readJson, repository, withLock, type Repository } from "./store.ts";

export interface CleanupOptions {
  apply?: boolean;
  retentionDays?: number;
  signal?: AbortSignal;
}
export interface CleanupReport {
  dryRun: boolean;
  retentionDays: number;
  eligible: string[];
  removed: string[];
  kept: { id: string; reason: "unconfirmed" | "retention" | "busy" | "migration" }[];
}

export function retentionDays(value = 7): number {
  if (!Number.isFinite(value) || value < 0 || value * 86_400_000 > Number.MAX_SAFE_INTEGER) throw new Error("retention-days must be a finite, non-negative number of days.");
  return value;
}

async function withRecipients<T>(repo: Repository, keys: string[], run: () => Promise<T>, index = 0): Promise<T> {
  if (index === keys.length) return run();
  return withLock(join(repo.directory, "sessions", `${keys[index]}.lock`), () => withRecipients(repo, keys, run, index + 1));
}

/** Only events fully confirmed by all original recipients can enter the deletion journal. */
export async function collectRepository(repo: Repository, options: CleanupOptions = {}): Promise<CleanupReport> {
  const days = retentionDays(options.retentionDays);
  const report: CleanupReport = { dryRun: !options.apply, retentionDays: days, eligible: [], removed: [], kept: [] };
  return withLock(join(repo.directory, "publish.lock"), async () => {
    // Session metadata cannot change through the relay while this publication lock is held.
    const migrated = new Set<string>();
    const approved: SharedEvent[] = [];
    for (const name of await readdir(join(repo.directory, "trash"))) {
      options.signal?.throwIfAborted();
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      const value = await readJson(join(repo.directory, "trash", name));
      if (value !== undefined) approved.push(validateEvent(value, name.slice(0, -5)));
    }
    const events = await eventsIn(repo, undefined, options.signal); // Validate before making any deletion.
    const cutoff = Date.now() - days * 86_400_000;
    for (const event of [...approved, ...events]) {
      options.signal?.throwIfAborted();
      const committed = approved.includes(event);
      try {
        await withRecipients(repo, [...new Set(event.recipients)].sort(), async () => {
          if (!committed) {
            let latest = Date.parse(event.createdAt);
            for (const key of event.recipients) {
              const receipt = await readReceipt(repo, key, event.id);
              if (!receipt) { report.kept.push({ id: event.id, reason: "unconfirmed" }); return; }
              if (!migrated.has(key)) {
                const session = await readSession(repo, key);
                if (!session?.migrated) { report.kept.push({ id: event.id, reason: "migration" }); return; }
                migrated.add(key);
              }
              latest = Math.max(latest, Date.parse(receipt.at));
            }
            if (latest > cutoff) { report.kept.push({ id: event.id, reason: "retention" }); return; }
          }
          report.eligible.push(event.id);
          if (!options.apply) return;
          options.signal?.throwIfAborted();
          const trash = join(repo.directory, "trash", `${event.id}.json`);
          // The rename commits deletion. A crash can only leave confirmed events in trash.
          if (!committed) await rename(join(repo.directory, "events", `${event.id}.json`), trash);
          for (const key of event.recipients) await rm(join(repo.directory, "receipts", key, `${event.id}.json`), { force: true });
          await rm(trash, { force: true });
          report.removed.push(event.id);
        });
      } catch (error) {
        if (error instanceof BusyError) report.kept.push({ id: event.id, reason: "busy" });
        else throw error;
      }
    }
    return report;
  }, { signal: options.signal, waitMs: 5000 });
}

export async function collectGarbage(cwd: string, options: CleanupOptions = {}): Promise<CleanupReport> {
  retentionDays(options.retentionDays);
  return collectRepository(await repository(cwd, options.signal), options);
}
