import { stat } from "node:fs/promises";
import { join } from "node:path";
import { branchStatus } from "./branch-status.ts";
import { git } from "./git.ts";
import { repository, withLock } from "./store.ts";

export interface SyncResult {
  state: "updated" | "up-to-date" | "ahead" | "blocked" | "error";
  remote?: string;
  reason?: string;
}

export async function syncBranch(cwd: string, branch: string, signal?: AbortSignal): Promise<SyncResult> {
  try {
    const repo = await repository(cwd, signal);
    // Serialize relay writers across worktrees; Git still protects against external writers.
    return await withLock(join(repo.directory, "branch-sync.lock"), async (): Promise<SyncResult> => {
      const initial = await branchStatus({ cwd, branch, signal });
      if (initial.worktree.branch !== branch || !initial.local.commit) return { state: "blocked", reason: "Auto-sync only updates an existing branch checked out in --cwd." };
      const upstream = initial.local.tracking?.ref;
      if (!upstream?.startsWith("refs/remotes/")) return { state: "blocked", reason: "Configure a remote upstream for this branch before enabling auto-sync." };
      const remote = (await git(cwd, ["config", "--get-all", `branch.${branch}.remote`], signal)).trim();
      const source = (await git(cwd, ["config", "--get-all", `branch.${branch}.merge`], signal)).trim();
      const remotes = (await git(cwd, ["remote"], signal)).trim().split("\n");
      if (!remotes.includes(remote) || !source.startsWith("refs/heads/")) return { state: "blocked", reason: "Auto-sync requires one configured remote branch upstream." };
      await git(cwd, ["check-ref-format", source], signal);
      await git(cwd, ["check-ref-format", upstream], signal);
      await git(cwd, ["fetch", "--no-tags", "--no-recurse-submodules", "--no-write-fetch-head", "--", remote, `+${source}:${upstream}`], signal);
      const fresh = await branchStatus({ cwd, branch, signal });
      if (fresh.worktree.branch !== branch || fresh.local.commit !== initial.local.commit || fresh.local.tracking?.ref !== upstream) return { state: "blocked", remote, reason: "Branch or upstream changed during fetch; retry after other Git operations finish." };
      if (fresh.worktree.dirty) return { state: "blocked", remote, reason: "Worktree has staged, unstaged or untracked changes; preserved without stashing." };
      const operations = ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply", "sequencer", "BISECT_START"];
      for (let offset = 0; offset < operations.length; offset += 4) {
        // Keep Git's per-worktree path resolution and settle every child before releasing the writer lock.
        const batch = await Promise.allSettled(operations.slice(offset, offset + 4).map(async (name) => {
          const path = (await git(cwd, ["rev-parse", "--path-format=absolute", "--git-path", name], signal)).trim();
          const exists = await stat(path).then(() => true, (error) => { if (error.code === "ENOENT") return false; throw error; });
          return { name, exists };
        }));
        for (const result of batch) {
          if (result.status === "rejected") throw result.reason;
          if (result.value.exists) return { state: "blocked", remote, reason: `Git operation in progress (${result.value.name}); finish it before syncing.` };
        }
      }
      const tracking = fresh.local.tracking;
      if (!tracking?.commit || tracking.ahead === null || tracking.behind === null) return { state: "blocked", remote, reason: "Upstream commit is unavailable." };
      if (tracking.ahead && tracking.behind) return { state: "blocked", remote, reason: "Branches have diverged; auto-sync never rebases or resets local commits." };
      if (!tracking.behind) return { state: tracking.ahead ? "ahead" : "up-to-date", remote };
      const currentRef = (await git(cwd, ["symbolic-ref", "HEAD"], signal)).trim();
      const currentCommit = (await git(cwd, ["rev-parse", "HEAD"], signal)).trim();
      if (currentRef !== initial.local.ref || currentCommit !== initial.local.commit) return { state: "blocked", remote, reason: "HEAD changed before fast-forward; retry after other Git operations finish." };
      await git(cwd, ["-c", "submodule.recurse=false", "merge", "--ff-only", "--no-autostash", "--no-overwrite-ignore", "--", tracking.commit], signal);
      return { state: "updated", remote };
    }, { signal, waitMs: 5000 });
  } catch (error) {
    signal?.throwIfAborted();
    return { state: "error", reason: error instanceof Error ? error.message : String(error) };
  }
}
