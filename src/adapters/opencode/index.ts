import type { Plugin } from "@opencode/plugin";
import { setTimeout as delay } from "node:timers/promises";
import { consumeMailbox } from "../../core/consumer.ts";
import { watchRoot } from "../../core/changes.ts";
import { formatNotifications } from "../../core/mailbox.ts";
import { hash } from "../../core/store.ts";

type SessionID = Parameters<Plugin.Context["session"]["get"]>[0]["sessionID"];

export default {
  id: "git-relay",
  async setup(ctx) {
    let root: string | undefined;
    let rootFailure: string | undefined;
    const warnRoot = (error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error);
      if (rootFailure === reason) return;
      rootFailure = reason;
      try { console.warn(`[GitRelay] Initialization failed: ${reason}. Will retry after a session prompt.`); } catch {}
    };
    try { root = await watchRoot(ctx.location.directory); }
    catch (error) { warnRoot(error); }
    const sessions = new Map<SessionID, { abort: AbortController; active?: Promise<void> }>();
    const draining = new Set<Promise<void>>();
    const lookups = new Map<SessionID, Set<{ cancelled: boolean; abort: AbortController }>>();
    const abort = new AbortController();
    let rootProbe: Promise<string | undefined> | undefined;
    let rootRetryAt = 0, rootDelay = 5000;
    const probeRoot = (): Promise<string | undefined> => {
      if (rootProbe) return rootProbe;
      if (performance.now() < rootRetryAt) return Promise.resolve(undefined);
      rootProbe = (async () => {
        try {
          const current = await watchRoot(ctx.location.directory, abort.signal);
          if (root !== undefined && root !== current) throw new Error("Git worktree root changed; reload the plugin before resuming");
          root = current;
          rootFailure = undefined;
          rootDelay = 5000;
          rootRetryAt = 0;
          return current;
        } catch (error) {
          if (!abort.signal.aborted) {
            warnRoot(error);
            rootRetryAt = performance.now() + rootDelay;
            rootDelay = Math.min(rootDelay * 2, 60_000);
          }
          return undefined;
        } finally { rootProbe = undefined; }
      })();
      return rootProbe;
    };
    let timer: ReturnType<typeof setInterval> | undefined;
    const ref = process.env.WORKTREE_MAIN_REF ?? "refs/heads/main";
    const deferred = new Error("Establish baseline without recursively prompting");
    const warn = (error: unknown) => { try { console.warn(`[GitRelay] ${error instanceof Error ? error.message : String(error)}`); } catch {} };
    const belongs = (session: Awaited<ReturnType<typeof ctx.session.get>>) => !session.parentID && session.location.directory === ctx.location.directory;

    function getSession(id: SessionID, signal: AbortSignal, underlying?: (pending: ReturnType<typeof ctx.session.get>) => void): ReturnType<typeof ctx.session.get> {
      signal.throwIfAborted();
      const pending = ctx.session.get({ sessionID: id }, { signal });
      underlying?.(pending);
      return new Promise((resolve, reject) => {
        const aborted = () => { signal.removeEventListener("abort", aborted); reject(signal.reason); };
        signal.addEventListener("abort", aborted, { once: true });
        pending.then((session) => { signal.removeEventListener("abort", aborted); resolve(session); }, (error) => { signal.removeEventListener("abort", aborted); reject(error); });
        if (signal.aborted) aborted();
      });
    }

    function scan(id: SessionID, initial = false): Promise<void> {
      const state = sessions.get(id);
      if (!state || state.active || abort.signal.aborted) return state?.active ?? Promise.resolve();
      state.active = (async () => {
        const currentRoot = await probeRoot();
        state.abort.signal.throwIfAborted();
        if (!currentRoot) return;
        if (!belongs(await getSession(id, state.abort.signal))) return;
        await consumeMailbox({
          cwd: ctx.location.directory, ref, adapter: "opencode", session: id, signal: state.abort.signal, deliverIndividually: true,
          async deliver(notifications) {
            if (initial) throw deferred;
            // V2 durably admits queued input; the host handles busy sessions and idle wake-up.
            for (const notification of notifications) {
              state.abort.signal.throwIfAborted();
              await ctx.session.prompt({ sessionID: id, id: `msg_${hash(["git-relay", currentRoot, id, notification.event.id])}`, text: formatNotifications([notification]), delivery: "queue", metadata: { source: "git-relay" } }, { signal: state.abort.signal });
            }
          },
        });
      })().catch((error) => {
        if (error !== deferred && !state.abort.signal.aborted) warn(error);
      }).finally(() => { state.active = undefined; });
      return state.active;
    }

    const retries = new Map<SessionID, number>();
    let lookupSequence = 0;
    const retrying = new Set<SessionID>();
    function maintainTimer() {
      if ((sessions.size || retries.size) && !timer && !abort.signal.aborted) {
        timer = setInterval(() => {
          for (const id of sessions.keys()) void scan(id);
          let started = 0;
          for (const [id, sequence] of retries) {
            if (retrying.has(id)) continue;
            if (retrying.size >= 128) break;
            retries.delete(id); retries.set(id, sequence);
            retrying.add(id);
            void enroll(id, true);
            if (++started === 8) break;
          }
        }, 5000);
        timer.unref?.();
      } else if (!sessions.size && !retries.size && timer) {
        clearInterval(timer); timer = undefined;
      }
    }
    async function enroll(id: SessionID, retry = false) {
      const token = { cancelled: false, abort: new AbortController() };
      const sequence = ++lookupSequence;
      let pending: Set<typeof token> | undefined;
      let underlyingStarted = false;
      try {
        if (!sessions.has(id)) {
          pending = lookups.get(id) ?? new Set();
          lookups.set(id, pending);
          pending.add(token);
          const session = await getSession(id, AbortSignal.any([abort.signal, token.abort.signal]), retry ? (operation) => {
            underlyingStarted = true;
            void operation.then(() => retrying.delete(id), () => retrying.delete(id));
          } : undefined);
          if (abort.signal.aborted || token.cancelled) return;
          const inScope = belongs(session);
          if (inScope || (retries.get(id) ?? 0) <= sequence) retries.delete(id);
          if (!inScope) return;
          if (!sessions.has(id)) {
            sessions.set(id, { abort: new AbortController() });
            await scan(id, true);
          }
        }
      } catch (error) {
        if (!abort.signal.aborted && !token.cancelled) {
          if (!retry) warn(error);
          if (!sessions.has(id)) {
            if (retries.has(id) || retries.size < 128) retries.set(id, Math.max(retries.get(id) ?? 0, sequence));
            else warn(new Error("Too many pending OpenCode session lookups; prompt again to retry."));
          }
        }
      } finally {
        if (retry && !underlyingStarted) retrying.delete(id);
        if (pending) {
          pending.delete(token);
          if (!pending.size && lookups.get(id) === pending) lookups.delete(id);
        }
        maintainTimer();
      }
    }
    const registration = await ctx.session.hook("prompt", async (event) => {
      if (abort.signal.aborted || event.metadata?.source === "git-relay" || event.metadata?.source === "worktree-relay") return;
      await enroll(event.sessionID);
    });
    const events = (async () => {
      let backoff = 1000;
      while (!abort.signal.aborted) {
        try {
          for await (const event of ctx.event.subscribe({ signal: abort.signal })) {
            backoff = 1000;
            if (event.type !== "session.deleted") continue;
            retries.delete(event.data.sessionID);
            for (const token of lookups.get(event.data.sessionID) ?? []) { token.cancelled = true; token.abort.abort(); }
            maintainTimer();
            const state = sessions.get(event.data.sessionID);
            if (!state) continue;
            state.abort.abort();
            sessions.delete(event.data.sessionID);
            if (state.active) {
              const active = state.active;
              draining.add(active);
              void active.finally(() => draining.delete(active));
            }
            maintainTimer();
          }
        } catch (error) { if (!abort.signal.aborted) warn(error); }
        if (!abort.signal.aborted) {
          await delay(backoff, undefined, { signal: abort.signal }).catch(() => {});
          backoff = Math.min(backoff * 2, 60_000);
        }
      }
    })();

    return async () => {
      abort.abort();
      if (timer) clearInterval(timer);
      retries.clear();
      for (const state of sessions.values()) state.abort.abort();
      const results = await Promise.allSettled([
        Promise.resolve().then(() => registration.dispose()),
        events,
        ...[...sessions.values()].map((state) => state.active),
        ...draining,
      ]);
      sessions.clear();
      const failure = results.find((result) => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
    };
  },
} satisfies Plugin.Plugin;
