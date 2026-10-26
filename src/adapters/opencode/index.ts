import type { Plugin } from "@opencode/plugin";
import { consumeMailbox } from "../../core/consumer.ts";
import { watchRoot } from "../../core/changes.ts";
import { formatNotifications } from "../../core/mailbox.ts";

type SessionID = Parameters<Plugin.Context["session"]["get"]>[0]["sessionID"];

export default {
  id: "git-relay",
  async setup(ctx) {
    try { await watchRoot(ctx.location.directory); }
    catch { return async () => {}; }
    const sessions = new Map<SessionID, { abort: AbortController; active?: Promise<void> }>();
    const deleted = new Set<SessionID>();
    const abort = new AbortController();
    let timer: ReturnType<typeof setInterval> | undefined;
    let polling: Promise<void> | undefined;
    const ref = process.env.WORKTREE_MAIN_REF ?? "refs/heads/main";
    const deferred = new Error("Establish baseline without recursively prompting");
    const warn = (error: unknown) => console.warn(`[GitRelay] ${error instanceof Error ? error.message : String(error)}`);
    const belongs = (session: Awaited<ReturnType<typeof ctx.session.get>>) => !session.parentID && session.location.directory === ctx.location.directory;

    function scan(id: SessionID, initial = false): Promise<void> {
      const state = sessions.get(id);
      if (!state || state.active || abort.signal.aborted) return state?.active ?? Promise.resolve();
      state.active = (async () => {
        if (!belongs(await ctx.session.get({ sessionID: id }, { signal: state.abort.signal }))) return;
        await consumeMailbox({
          cwd: ctx.location.directory, ref, adapter: "opencode", session: id, signal: state.abort.signal,
          async deliver(notifications) {
            if (initial) throw deferred;
            // V2 durably admits queued input; the host handles busy sessions and idle wake-up.
            await ctx.session.prompt({ sessionID: id, text: formatNotifications(notifications), delivery: "queue", metadata: { source: "git-relay" } }, { signal: state.abort.signal });
          },
        });
      })().catch((error) => {
        if (error !== deferred && !state.abort.signal.aborted) warn(error);
      }).finally(() => { state.active = undefined; });
      return state.active;
    }

    const registration = await ctx.session.hook("prompt", async (event) => {
      if (abort.signal.aborted || deleted.has(event.sessionID) || event.metadata?.source === "git-relay" || event.metadata?.source === "worktree-relay") return;
      try {
        if (!sessions.has(event.sessionID)) {
          const session = await ctx.session.get({ sessionID: event.sessionID }, { signal: abort.signal });
          if (!belongs(session) || abort.signal.aborted || deleted.has(event.sessionID)) return;
          sessions.set(event.sessionID, { abort: new AbortController() });
          await scan(event.sessionID, true);
        }
        if (!abort.signal.aborted && sessions.size && !timer) {
          timer = setInterval(() => {
            polling ??= (async () => {
              for (const id of sessions.keys()) await scan(id);
            })().finally(() => { polling = undefined; });
          }, 5000);
          timer.unref?.();
        }
      } catch (error) {
        if (!abort.signal.aborted) warn(error);
      }
    });
    const events = (async () => {
      for await (const event of ctx.event.subscribe({ signal: abort.signal })) {
        if (event.type !== "session.deleted") continue;
        deleted.add(event.data.sessionID);
        const state = sessions.get(event.data.sessionID);
        if (!state) continue;
        state.abort.abort();
        await state.active;
        sessions.delete(event.data.sessionID);
        if (!sessions.size && timer) { clearInterval(timer); timer = undefined; }
      }
    })().catch((error) => { if (!abort.signal.aborted) warn(error); });

    return async () => {
      abort.abort();
      if (timer) clearInterval(timer);
      await registration.dispose();
      for (const state of sessions.values()) state.abort.abort();
      await Promise.all([...sessions.values()].map((state) => state.active));
      sessions.clear();
      await polling;
      await events;
    };
  },
} satisfies Plugin.Plugin;
