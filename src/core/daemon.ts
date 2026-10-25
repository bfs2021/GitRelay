import { randomUUID } from "node:crypto";
import { mkdir, readdir, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { collectRepository, retentionDays } from "./cleanup.ts";
import { sessionsIn } from "./mailbox.ts";
import { synchronizeRef } from "./publisher.ts";
import { BusyError, hash, isId, readJson, stateDirectory, withLock, writeJson, type Repository } from "./store.ts";

export interface DaemonOptions {
  signal: AbortSignal;
  intervalMs?: number;
  retentionDays?: number;
  onEvent?(event: object): void | Promise<void>;
}

export async function runDaemon(options: DaemonOptions): Promise<void> {
  const intervalMs = options.intervalMs ?? 5000;
  if (!Number.isInteger(intervalMs) || intervalMs < 50 || intervalMs > 60_000) throw new Error("interval-ms must be an integer between 50 and 60000.");
  const days = retentionDays(options.retentionDays);
  options.signal.throwIfAborted();
  const root = stateDirectory();
  await mkdir(join(root, "repos"), { recursive: true, mode: 0o700 });
  const token = hash(randomUUID());
  await withLock(join(root, "daemon.lock"), async () => {
    const heartbeat = () => writeJson(join(root, "daemon.json"), { pid: process.pid, token, intervalMs, heartbeatAt: new Date().toISOString() });
    let lastCleanup = -Infinity;
    try {
      await heartbeat();
      await options.onEvent?.({ type: "daemon.ready", pid: process.pid, stateDirectory: root, intervalMs, retentionDays: days });
      while (!options.signal.aborted) {
        await heartbeat();
        const clean = Date.now() - lastCleanup >= 60 * 60 * 1000;
        for (const id of await readdir(join(root, "repos"))) {
          if (!isId(id) || options.signal.aborted) continue;
          try {
            const directory = join(root, "repos", id);
            const metadata = await readJson(join(directory, "repo.json")) as { id: string; common: string } | undefined;
            if (!metadata) continue; // A newly created store may not yet be registered.
            if (metadata.id !== id || typeof metadata.common !== "string") throw new Error(`Invalid repository metadata: ${id}`);
            const common = await realpath(metadata.common);
            if (hash(common) !== id) throw new Error(`Repository identity mismatch: ${id}`);
            const repo: Repository = { id, common, root: common, directory };
            await mkdir(join(directory, "trash"), { recursive: true, mode: 0o700 });
            await withLock(join(directory, "publish.lock"), async () => {
              const refs = [...new Set((await sessionsIn(repo)).filter((session) => !session.closedAt).map((session) => session.ref))];
              for (const ref of refs) {
                options.signal.throwIfAborted();
                try { await synchronizeRef(repo, ref, { adapter: "daemon", session: String(process.pid) }, options.signal); }
                catch (error) {
                  if (!options.signal.aborted) await options.onEvent?.({ type: "daemon.error", repo: id, ref, message: error instanceof Error ? error.message : String(error) });
                }
                await heartbeat();
              }
            });
            if (clean && !options.signal.aborted) {
              const report = await collectRepository(repo, { apply: true, retentionDays: days, signal: options.signal });
              await options.onEvent?.({ type: "daemon.cleanup", repo: id, removed: report.removed.length, kept: report.kept.length });
            }
          } catch (error) {
            if (!(error instanceof BusyError) && !options.signal.aborted) await options.onEvent?.({ type: "daemon.error", repo: id, message: error instanceof Error ? error.message : String(error) });
          }
        }
        if (clean) lastCleanup = Date.now();
        if (!options.signal.aborted) await delay(intervalMs, undefined, { signal: options.signal }).catch(() => {});
      }
    } finally {
      const state = await readJson(join(root, "daemon.json")) as { token?: string } | undefined;
      if (state?.token === token) await rm(join(root, "daemon.json"), { force: true });
    }
  }, { token });
}
