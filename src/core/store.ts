import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { git } from "./git.ts";
import { watchRoot } from "./changes.ts";

export const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const isId = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export const isCommit = (value: unknown): value is string => typeof value === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);

export interface Repository {
  root: string;
  common: string;
  id: string;
  directory: string;
}

export function stateDirectory(): string {
  const override = process.env.WORKTREE_SYNC_STATE_DIR;
  if (override) {
    if (!isAbsolute(override)) throw new Error("WORKTREE_SYNC_STATE_DIR must be an absolute path.");
    return override;
  }
  const xdg = process.env.XDG_STATE_HOME;
  return join(xdg && isAbsolute(xdg) ? xdg : join(homedir(), ".local", "state"), "worktree-agent-sync");
}

export async function repository(cwd: string, signal?: AbortSignal): Promise<Repository> {
  const root = await watchRoot(cwd, signal);
  const common = await realpath((await git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"], signal)).replace(/\r?\n$/, ""));
  const id = hash(common);
  const directory = join(stateDirectory(), "repos", id);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  for (const name of ["sessions", "events", "receipts", "refs", "trash"]) await mkdir(join(directory, name), { mode: 0o700 }).catch((error) => {
    if (error.code !== "EEXIST") throw error;
  });
  return { root, common, id, directory };
}

export async function readJson(path: string): Promise<unknown | undefined> {
  try {
    const info = await stat(path);
    if (info.size > 2 * 1024 * 1024) throw new Error(`State file exceeds 2 MiB: ${path}`);
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export class BusyError extends Error {}

export async function withLock<T>(path: string, run: () => Promise<T>, options: { token?: string; signal?: AbortSignal; waitMs?: number } = {}): Promise<T> {
  const deadline = performance.now() + (options.waitMs ?? 0);
  let lock;
  for (;;) {
    options.signal?.throwIfAborted();
    try { lock = await open(path, "wx", 0o600); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const owner = await readJson(path).catch(() => undefined) as { pid?: number } | undefined;
      const info = await stat(path).catch((failure) => {
        if (failure.code === "ENOENT") return undefined;
        throw failure;
      });
      if (!info) continue;
      if (owner && Number.isInteger(owner.pid) && owner.pid! > 0) {
        try { process.kill(owner.pid!, 0); }
        catch (failure) {
          if ((failure as NodeJS.ErrnoException).code === "ESRCH") throw new Error(`Stale worktree-sync lock: ${path}. Verify the owner has exited, then remove this lock file.`);
        }
      }
      // shortcut: PID files cannot authenticate reused PIDs; use OS locks if automatic recovery is required.
      const old = Date.now() - info.mtimeMs > 60_000;
      if (old || (options.waitMs && performance.now() >= deadline)) {
        throw new Error(`Worktree-sync lock remains busy: ${path} (PID ${owner?.pid ?? "unknown"}). The owner may be stalled or its PID reused; verify no relay operation owns this lock before removing it.`);
      }
      if (!options.waitMs) throw new BusyError(`Worktree-sync is busy: ${path}`);
      await delay(Math.min(10 + Math.random() * 30, Math.max(1, deadline - performance.now())), undefined, { signal: options.signal });
    }
  }
  try {
    options.signal?.throwIfAborted();
    await lock.writeFile(JSON.stringify({ pid: process.pid, token: options.token }));
    options.signal?.throwIfAborted();
    return await run();
  } finally {
    try { await lock.close(); }
    finally { await rm(path, { force: true }); }
  }
}
