import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { consumeMailbox } from "../../core/consumer.ts";
import { readCursor, watchRoot, type Cursor } from "../../core/changes.ts";
import { formatNotifications } from "../../core/mailbox.ts";

export const WATCH_STATE = "worktree-watch-state"; // Legacy checkpoints remain readable.
export const WATCH_MESSAGE = "worktree-upstream-change";

export function createWatcher(pi: ExtensionAPI, ctx: ExtensionContext, ref: string, delivery: { pending?: string[] } = {}) {
  const abort = new AbortController();
  let active: Promise<void> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let initialized = false;
  let initialCursor: Cursor | undefined;
  let lastError = "";

  function isDelivered(id: string): boolean {
    return ctx.sessionManager.getBranch().some((entry) => {
      if (entry.type !== "custom_message" || entry.customType !== WATCH_MESSAGE) return false;
      const ids = (entry.details as { eventIds?: unknown } | undefined)?.eventIds;
      return Array.isArray(ids) && ids.includes(id);
    });
  }

  async function check() {
    if (abort.signal.aborted) return;
    if (!initialized) {
      const root = await watchRoot(ctx.cwd, abort.signal);
      for (const entry of ctx.sessionManager.getBranch()) {
        const value = entry.type === "custom" && entry.customType === WATCH_STATE ? entry.data
          : entry.type === "custom_message" && entry.customType === WATCH_MESSAGE ? entry.details : undefined;
        initialCursor = readCursor(value, root, ref) ?? initialCursor;
      }
      initialized = true;
    }
    await consumeMailbox({
      cwd: ctx.cwd, ref, adapter: "pi", session: ctx.sessionManager.getSessionId(),
      signal: abort.signal, initialCursor, isDelivered,
      async deliver(notifications) {
        // Custom follow-ups are not counted by hasPendingMessages; idle lets an Esc-discarded batch retry.
        if (ctx.hasPendingMessages() || (delivery.pending && !delivery.pending.every(isDelivered) && !ctx.isIdle())) return false;
        const eventIds = notifications.map((notification) => notification.event.id);
        pi.sendMessage({ customType: WATCH_MESSAGE, content: formatNotifications(notifications), display: true, details: { eventIds, notifications } }, { triggerTurn: true, deliverAs: "followUp" });
        delivery.pending = eventIds;
        return false; // A queued message is not durable until Pi appends it to the session.
      },
    });
  }

  function tick(): Promise<void> {
    if (active) return active;
    active = check().then(() => { lastError = ""; }).catch((error) => {
      if (abort.signal.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      if (message !== lastError) ctx.ui.notify(`Worktree monitoring is temporarily unavailable; retrying: ${message}`, "warning");
      lastError = message;
    }).finally(() => { active = undefined; });
    return active;
  }

  return {
    tick,
    async start() {
      await tick();
      if (!abort.signal.aborted && !timer) {
        timer = setInterval(() => { void tick(); }, 5000);
        timer.unref();
      }
    },
    async stop() {
      abort.abort();
      if (timer) clearInterval(timer);
      await active;
    },
  };
}
