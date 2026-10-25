import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

export interface Worktree {
  path: string;
  head?: string;
  branch?: string;
  bare?: boolean;
  detached?: boolean;
  locked?: string;
  prunable?: string;
}

export async function git(cwd: string, args: string[], signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  try {
    const { stdout } = await exec("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      timeout: 30_000,
      signal,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    return stdout;
  } catch (error) {
    signal?.throwIfAborted();
    const failure = error as Error & { stderr?: string };
    throw new Error(failure.stderr?.trim() || failure.message, { cause: error });
  }
}

export function parseWorktrees(output: string): Worktree[] {
  const trees: Worktree[] = [];
  let tree: Worktree | undefined;
  for (const field of output.split("\0")) {
    const space = field.indexOf(" ");
    const key = space < 0 ? field : field.slice(0, space);
    const value = space < 0 ? "" : field.slice(space + 1);
    if (key === "worktree") {
      tree = { path: value };
      trees.push(tree);
    } else if (tree) {
      if (key === "HEAD") tree.head = value;
      if (key === "branch") tree.branch = value.replace(/^refs\/heads\//, "");
      if (key === "bare") tree.bare = true;
      if (key === "detached") tree.detached = true;
      if (key === "locked") tree.locked = value;
      if (key === "prunable") tree.prunable = value;
    }
  }
  return trees;
}

export async function listWorktrees(cwd: string): Promise<Worktree[]> {
  return parseWorktrees(await git(cwd, ["worktree", "list", "--porcelain", "-z"]));
}

export async function addWorktree(
  cwd: string,
  path: string,
  branch: string,
  newBranch = false,
  startPoint = "HEAD",
): Promise<string> {
  if (!path.trim()) throw new Error("Worktree 路径不能为空。");
  await git(cwd, ["check-ref-format", "--branch", branch]);
  // Do not let check-ref-format's @{-n} expansion change the requested branch.
  if (branch.startsWith("-") || branch.startsWith("@{")) throw new Error("请使用明确的分支名。");
  const target = resolve(cwd, path);
  if (newBranch) {
    const commit = (await git(cwd, ["rev-parse", "--verify", "--end-of-options", `${startPoint}^{commit}`])).trim();
    await git(cwd, ["worktree", "add", "-b", branch, "--", target, commit]);
  } else {
    // A fully qualified ref prevents a tag or revision expression from becoming a detached checkout.
    await git(cwd, ["show-ref", "--verify", "--", `refs/heads/${branch}`]);
    await git(cwd, ["worktree", "add", "--", target, branch]);
  }
  return realpath(target);
}

export async function removeWorktree(cwd: string, path: string): Promise<void> {
  const trees = await listWorktrees(cwd);
  const target = await realpath(resolve(cwd, path));
  const tree = trees.find((entry) => resolve(entry.path) === target);
  if (!tree) throw new Error("所选路径不是当前仓库的 worktree。");
  if (tree === trees[0] || tree.bare) throw new Error("不能删除主工作区或裸仓库。");
  if (tree.locked !== undefined) throw new Error("不能删除已锁定的 worktree。");
  const current = await realpath(cwd);
  const inside = relative(target, current);
  if (!inside || (!isAbsolute(inside) && inside !== ".." && !inside.startsWith(`..${sep}`))) {
    throw new Error("不能删除当前 pi 所在的 worktree，请先在其他工作区启动 pi。");
  }
  // Git refuses dirty worktrees (including untracked files); never retry with --force.
  await git(cwd, ["worktree", "remove", "--", target]);
}
