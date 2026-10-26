import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { addWorktree, listWorktrees, removeWorktree, type Worktree } from "../../core/git.ts";
import { createWatcher } from "./watch.ts";
import { watchRoot } from "../../core/changes.ts";
import { joinSession, leaveSession } from "../../core/sessions.ts";

function label(tree: Worktree): string {
  const flags = [tree.bare && "bare", tree.detached && "detached", tree.locked !== undefined && "locked", tree.prunable !== undefined && "prunable"].filter(Boolean);
  return `${JSON.stringify(tree.path)} — ${tree.branch ?? tree.head?.slice(0, 8) ?? "bare"}${flags.length ? ` [${flags.join(", ")}]` : ""}`;
}

export default function (pi: ExtensionAPI) {
  pi.registerFlag("worktree-watch", { type: "boolean", default: true, description: "Automatically deliver relevant upstream changes to the agent" });
  pi.registerFlag("worktree-main-ref", { type: "string", default: "refs/heads/main", description: "Full Git branch ref to monitor" });
  let watcher: ReturnType<typeof createWatcher> | undefined;
  // A watcher may be replaced by join while its follow-up still belongs to the host.
  let delivery: { pending?: string[] } = {};
  pi.on("session_start", async (_event, ctx) => {
    await watcher?.stop();
    watcher = undefined;
    delivery = {};
    const enabled = pi.getFlag("worktree-watch");
    if (enabled === false || enabled === "false" || (ctx.mode !== "tui" && ctx.mode !== "rpc")) return;
    try { await watchRoot(ctx.cwd); } catch { return; }
    watcher = createWatcher(pi, ctx, String(pi.getFlag("worktree-main-ref") ?? "refs/heads/main"), delivery);
    await watcher.start();
  });
  pi.on("session_shutdown", async () => {
    await watcher?.stop();
    watcher = undefined;
  });
  pi.registerCommand("worktree", {
    description: "Manage Git worktrees and message subscriptions: /worktree [list|add|remove|join|leave]",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/worktree requires an interactive UI with dialog support.", "error");
        return;
      }
      try {
        let action = args.trim();
        if (!action) action = (await ctx.ui.select("Git worktree", ["list", "add", "remove", "join", "leave"])) ?? "";
        if (!action) return;
        if (!["list", "add", "remove", "join", "leave"].includes(action)) {
          ctx.ui.notify("Usage: /worktree [list|add|remove|join|leave]; enter paths and branches in the dialogs.", "warning");
          return;
        }
        if (action === "join" || action === "leave") {
          const wasWatching = watcher !== undefined;
          await watcher?.stop();
          watcher = undefined;
          const ref = String(pi.getFlag("worktree-main-ref") ?? "refs/heads/main");
          const options = { cwd: ctx.cwd, ref, adapter: "pi", session: ctx.sessionManager.getSessionId() };
          try {
            if (action === "leave") await leaveSession(options);
            else await joinSession(options);
          } catch (error) {
            if (wasWatching) {
              watcher = createWatcher(pi, ctx, ref, delivery);
              await watcher.start();
            }
            throw error;
          }
          if (action === "leave") {
            ctx.ui.notify("Left the message subscription; unread messages are preserved. Use /worktree join to rejoin.", "info");
          } else {
            watcher = createWatcher(pi, ctx, ref, delivery);
            await watcher.start();
            ctx.ui.notify("Joined the message subscription.", "info");
          }
          return;
        }
        const trees = await listWorktrees(ctx.cwd);
        if (action === "list") {
          ctx.ui.notify(trees.map(label).join("\n"), "info");
          return;
        }
        if (action === "add") {
          const mode = await ctx.ui.select("Create worktree", ["Create a new branch", "Use an existing local branch"]);
          if (!mode) return;
          const branch = await ctx.ui.input("Branch name", "feature/my-task");
          if (!branch?.trim()) return;
          const path = await ctx.ui.input("Worktree path (relative to the current pi directory; absolute paths are supported)", "../my-worktree");
          if (!path?.trim()) return;
          let startPoint = "HEAD";
          if (mode === "Create a new branch") {
            const input = await ctx.ui.input("Starting point (leave empty for HEAD)", "HEAD");
            if (input === undefined) return;
            startPoint = input.trim() || "HEAD";
          }
          const target = await addWorktree(ctx.cwd, path, branch.trim(), mode === "Create a new branch", startPoint);
          ctx.ui.notify(`Created: ${JSON.stringify(target)}\nStart a new pi session in that directory to use it; the current session stays here.`, "info");
          return;
        }
        const candidates = trees.slice(1).filter((tree) => !tree.bare && tree.locked === undefined);
        if (!candidates.length) {
          ctx.ui.notify("No linked worktrees can be removed (the main worktree and locked worktrees are excluded).", "info");
          return;
        }
        const options = candidates.map(label);
        const selected = await ctx.ui.select("Select a worktree to remove", options);
        if (selected === undefined) return;
        const tree = candidates[options.indexOf(selected)];
        if (!tree) return;
        if (!(await ctx.ui.confirm("Remove worktree?", `${JSON.stringify(tree.path)}\nOnly clean worktrees can be removed; branches are kept. Uncommitted or untracked files block removal, but Git-ignored files (such as .env and build/) will be deleted. Back them up first.`))) return;
        await removeWorktree(ctx.cwd, tree.path);
        ctx.ui.notify(`Removed worktree: ${JSON.stringify(tree.path)} (branch preserved)`, "info");
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });
}
