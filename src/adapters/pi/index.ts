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
  pi.registerFlag("worktree-watch", { type: "boolean", default: true, description: "自动向 agent 投递相关的上游变更" });
  pi.registerFlag("worktree-main-ref", { type: "string", default: "refs/heads/main", description: "监控的完整 Git 分支引用" });
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
    description: "管理 Git worktree 与消息订阅：/worktree [list|add|remove|join|leave]",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/worktree 需要支持对话框的交互界面。", "error");
        return;
      }
      try {
        let action = args.trim();
        if (!action) action = (await ctx.ui.select("Git worktree", ["list", "add", "remove", "join", "leave"])) ?? "";
        if (!action) return;
        if (!["list", "add", "remove", "join", "leave"].includes(action)) {
          ctx.ui.notify("用法：/worktree [list|add|remove|join|leave]，路径和分支在对话框中填写。", "warning");
          return;
        }
        if (action === "join" || action === "leave") {
          await watcher?.stop();
          watcher = undefined;
          const ref = String(pi.getFlag("worktree-main-ref") ?? "refs/heads/main");
          const options = { cwd: ctx.cwd, ref, adapter: "pi", session: ctx.sessionManager.getSessionId() };
          if (action === "leave") {
            await leaveSession(options);
            ctx.ui.notify("已退出消息订阅；未读消息已保留，/worktree join 可重新加入。", "info");
          } else {
            await joinSession(options);
            watcher = createWatcher(pi, ctx, ref, delivery);
            await watcher.start();
            ctx.ui.notify("已加入消息订阅。", "info");
          }
          return;
        }
        const trees = await listWorktrees(ctx.cwd);
        if (action === "list") {
          ctx.ui.notify(trees.map(label).join("\n"), "info");
          return;
        }
        if (action === "add") {
          const mode = await ctx.ui.select("创建 worktree", ["新建分支", "使用已有本地分支"]);
          if (!mode) return;
          const branch = await ctx.ui.input("分支名", "feature/my-task");
          if (!branch?.trim()) return;
          const path = await ctx.ui.input("Worktree 路径（相对于当前 pi 目录，支持绝对路径）", "../my-worktree");
          if (!path?.trim()) return;
          let startPoint = "HEAD";
          if (mode === "新建分支") {
            const input = await ctx.ui.input("起点（留空使用 HEAD）", "HEAD");
            if (input === undefined) return;
            startPoint = input.trim() || "HEAD";
          }
          const target = await addWorktree(ctx.cwd, path, branch.trim(), mode === "新建分支", startPoint);
          ctx.ui.notify(`已创建：${JSON.stringify(target)}\n在该目录启动新的 pi 即可使用；当前会话目录不变。`, "info");
          return;
        }
        const candidates = trees.slice(1).filter((tree) => !tree.bare && tree.locked === undefined);
        if (!candidates.length) {
          ctx.ui.notify("没有可删除的关联 worktree（主工作区和锁定工作区不在候选中）。", "info");
          return;
        }
        const options = candidates.map(label);
        const selected = await ctx.ui.select("选择要删除的 worktree", options);
        if (selected === undefined) return;
        const tree = candidates[options.indexOf(selected)];
        if (!tree) return;
        if (!(await ctx.ui.confirm("删除 worktree？", `${JSON.stringify(tree.path)}\n只删除干净的工作区，保留分支；未提交或未跟踪文件会阻止删除。`))) return;
        await removeWorktree(ctx.cwd, tree.path);
        ctx.ui.notify(`已删除 worktree：${JSON.stringify(tree.path)}（分支已保留）`, "info");
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });
}
