import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { addWorktree, listWorktrees, type Worktree } from "../../core/git.ts";
import { createWatcher, type Delivery } from "./watch.ts";
import { joinSession, leaveSession } from "../../core/sessions.ts";
import { piIdentity } from "./identity.ts";

function label(tree: Worktree): string {
  const flags = [tree.bare && "bare", tree.detached && "detached", tree.locked !== undefined && "locked", tree.prunable !== undefined && "prunable"].filter(Boolean);
  return `${JSON.stringify(tree.path)} — ${tree.branch ?? tree.head?.slice(0, 8) ?? "bare"}${flags.length ? ` [${flags.join(", ")}]` : ""}`;
}

// Git rejects ASCII whitespace in refs; preserve valid non-ASCII whitespace.
const trimRefInput = (value: string) => value.replace(/^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/g, "");

type Slot = { delivery: Delivery; users: number };
const deliveryKey = Symbol.for("git-relay.pi.pending.v2");
const processState = globalThis as unknown as Record<symbol, Map<string, Slot> | undefined>;

/** @internal Coordinate pending delivery across extension reloads in one process. */
export function sessionDelivery(manager: object, session: string, cwd: string, ref: string): { delivery: Delivery; release: () => void } {
  const pending = processState[deliveryKey] ??= new Map();
  const key = JSON.stringify([session, cwd, ref]);
  let slot = pending.get(key);
  if (!slot) {
    const delivery: Delivery = { owner: new WeakRef(manager) };
    slot = { delivery, users: 0 };
    const created = slot;
    delivery.onConfirmed = () => { if (!created.users && pending.get(key) === created) pending.delete(key); };
    pending.set(key, slot);
  }
  const current = slot;
  // A new host session cannot tell whether the old host's action completed.
  if (current.delivery.owner?.deref() !== manager) current.delivery.started = false;
  current.users++;
  return { delivery: current.delivery, release() {
    current.users--;
    if (!current.users && !current.delivery.pending && pending.get(key) === current) pending.delete(key);
  } };
}

export default function (pi: ExtensionAPI) {
  pi.registerFlag("worktree-watch", { type: "boolean", default: true, description: "Automatically deliver relevant upstream changes to the agent" });
  pi.registerFlag("worktree-main-ref", { type: "string", default: "refs/heads/main", description: "Full Git branch ref to monitor" });
  let watcher: ReturnType<typeof createWatcher> | undefined;
  let lease: ReturnType<typeof sessionDelivery> | undefined;
  let generation = 0;
  // shortcut: this queue cannot cover old or other processes; stop them before upgrading.
  const queueKey = Symbol.for("git-relay.pi.subscription-queue.v1");
  const queues = globalThis as unknown as Record<symbol, Map<string, Promise<void>> | undefined>;
  const subscriptionTails = queues[queueKey] ??= new Map();
  const stopping = new Set<Promise<void>>();
  async function stopWatcher() {
    const previousWatcher = watcher, previousLease = lease;
    watcher = undefined;
    lease = undefined;
    if (previousWatcher || previousLease) {
      const pending = (async () => {
        try { await previousWatcher?.stop(); }
        finally { previousLease?.release(); }
      })();
      stopping.add(pending);
      void pending.then(() => stopping.delete(pending), () => stopping.delete(pending));
    }
    const results = await Promise.allSettled(stopping);
    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  }
  async function startWatcher(ctx: ExtensionContext, ref: string) {
    const identity = piIdentity(ctx.sessionManager);
    lease = sessionDelivery(ctx.sessionManager, JSON.stringify([identity.session, identity.instance]), ctx.cwd, ref);
    watcher = createWatcher(pi, ctx, ref, lease.delivery);
    await watcher.start();
  }
  pi.on("session_start", async (_event, ctx) => {
    const currentGeneration = ++generation;
    await stopWatcher();
    if (currentGeneration !== generation) return;
    const enabled = pi.getFlag("worktree-watch");
    if (enabled === false || enabled === "false" || (ctx.mode !== "tui" && ctx.mode !== "rpc")) return;
    const ref = String(pi.getFlag("worktree-main-ref") ?? "refs/heads/main");
    await startWatcher(ctx, ref);
  });
  pi.on("session_shutdown", async () => {
    generation++;
    await stopWatcher();
  });
  pi.registerCommand("worktree", {
    description: "Manage Git worktrees and message subscriptions: /worktree [list|add|remove|join|leave]",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/worktree requires an interactive UI with dialog support.", "error");
        return;
      }
      let current = () => true;
      let started = false;
      const reportStaleOperation = () => {
        try { console.warn("[GitRelay] A worktree operation continued after its session changed; inspect the repository and subscription before retrying."); } catch {}
      };
      try {
        const commandGeneration = generation, manager = ctx.sessionManager, session = manager.getSessionId(), cwd = ctx.cwd;
        current = () => {
          try { return commandGeneration === generation && ctx.sessionManager === manager && manager.getSessionId() === session && ctx.cwd === cwd; }
          catch { return false; }
        };
        let action = args.trim();
        if (!action) action = (await ctx.ui.select("Git worktree", ["list", "add", "remove", "join", "leave"])) ?? "";
        if (!current() || !action) return;
        if (!["list", "add", "remove", "join", "leave"].includes(action)) {
          ctx.ui.notify("Usage: /worktree [list|add|remove|join|leave]; enter paths and branches in the dialogs.", "warning");
          return;
        }
        if (action === "join" || action === "leave") {
          const operation = (subscriptionTails.get(session) ?? Promise.resolve()).then(async () => {
            if (!current()) return;
            const wasWatching = watcher !== undefined;
            await stopWatcher();
            if (!current()) return;
            const ref = String(pi.getFlag("worktree-main-ref") ?? "refs/heads/main");
            const options = { cwd, ref, ...piIdentity(manager) };
            if (!current()) return;
            try {
              started = true;
              if (action === "leave") await leaveSession(options);
              else await joinSession(options);
            } catch (error) {
              if (wasWatching && current()) {
                await startWatcher(ctx, ref);
              }
              throw error;
            }
            if (!current()) { reportStaleOperation(); return; }
            if (action === "leave") {
              ctx.ui.notify("Left the message subscription; unread messages are preserved. Use /worktree join to rejoin.", "info");
            } else {
              await startWatcher(ctx, ref);
              if (!current()) { reportStaleOperation(); return; }
              ctx.ui.notify("Joined the message subscription.", "info");
            }
          });
          const tail = operation.catch(() => {});
          subscriptionTails.set(session, tail);
          void tail.then(() => { if (subscriptionTails.get(session) === tail) subscriptionTails.delete(session); });
          await operation;
          return;
        }
        const trees = await listWorktrees(cwd);
        if (!current()) return;
        if (action === "list") {
          ctx.ui.notify(trees.map(label).join("\n"), "info");
          return;
        }
        if (action === "add") {
          const mode = await ctx.ui.select("Create worktree", ["Create a new branch", "Use an existing local branch"]);
          if (!current() || !mode) return;
          const inputBranch = await ctx.ui.input("Branch name", "feature/my-task");
          if (!current() || inputBranch === undefined) return;
          const branch = trimRefInput(inputBranch);
          if (!branch) return;
          const path = await ctx.ui.input("Worktree path (relative to the current pi directory; absolute paths are supported)", "../my-worktree");
          if (!current() || !path || /^[\t\n\r ]*$/.test(path)) return;
          let startPoint = "HEAD";
          if (mode === "Create a new branch") {
            const input = await ctx.ui.input("Starting point (leave empty for HEAD)", "HEAD");
            if (!current() || input === undefined) return;
            startPoint = trimRefInput(input) || "HEAD";
          }
          if (!current()) return;
          started = true;
          const target = await addWorktree(cwd, path, branch, mode === "Create a new branch", startPoint);
          if (!current()) { reportStaleOperation(); return; }
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
        if (!current() || selected === undefined) return;
        const tree = candidates[options.indexOf(selected)];
        if (!tree) return;
        ctx.ui.notify(`Automatic worktree removal is temporarily unavailable: Git cannot atomically bind deletion to the selected worktree. Selected path (JSON data, not shell quoting; do not paste it as a shell argument): ${JSON.stringify(tree.path)}\nStop all concurrent worktree operations, verify the path and identity with git worktree list --porcelain, and back up Git-ignored files such as .env and build/. To proceed manually, run git worktree remove -- with the verified path as a separately quoted argument, without --force. Git itself can still race with concurrent changes.`, "warning");
      } catch (error) {
        if (current()) {
          const message = error instanceof Error ? error.message : String(error);
          try { ctx.ui.notify(message, "error"); }
          catch { try { console.warn(`[GitRelay] ${message.slice(0, 4096)}`); } catch {} }
        } else if (started) reportStaleOperation();
      }
    },
  });
}
