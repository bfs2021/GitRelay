import { consumeMailbox } from "../../core/consumer.ts";
import { formatNotifications } from "../../core/mailbox.ts";

// Structural subset of the OpenCode plugin/v1 client; no runtime SDK dependency.
interface PluginInput {
  directory: string;
  client: {
    session: {
      prompt(input: {
        path: { id: string };
        body: { parts: { type: "text"; text: string }[] };
        throwOnError: true;
        signal?: AbortSignal;
      }): Promise<unknown>;
    };
    app: { log(input: { body: { service: string; level: "warn"; message: string } }): Promise<unknown> };
  };
}

export default async function WorktreeSync({ client, directory }: PluginInput) {
  const sessions = new Map<string, { busy: boolean; checking: boolean; removed: boolean; abort: AbortController }>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let disposed = false;
  const ref = process.env.WORKTREE_MAIN_REF ?? "refs/heads/main";
  const deferred = new Error("Wait until the session is idle");

  async function scan(id: string, initial = false) {
    const state = sessions.get(id);
    if (!state || state.checking || (!initial && state.busy)) return;
    state.checking = true;
    try {
      await consumeMailbox({
        cwd: directory, ref, adapter: "opencode", session: id, signal: state.abort.signal,
        async deliver(notifications) {
          if (initial || state.removed || state.busy) throw deferred;
          await client.session.prompt({
            path: { id },
            body: { parts: [{ type: "text", text: formatNotifications(notifications) }] },
            throwOnError: true,
            signal: state.abort.signal,
          });
        },
      });
    } catch (error) {
      if (error !== deferred && !state.removed) {
        await client.app.log({ body: { service: "worktree-sync", level: "warn", message: error instanceof Error ? error.message : String(error) } }).catch(() => {});
      }
    } finally {
      state.checking = false;
    }
  }

  function startTimer() {
    if (!disposed && sessions.size && !timer) {
      timer = setInterval(() => { for (const id of sessions.keys()) void scan(id); }, 5000);
      timer.unref?.();
    }
  }

  return {
    "chat.message": async (input: { sessionID: string }) => {
      if (disposed) return;
      const existing = sessions.get(input.sessionID);
      if (existing) existing.busy = true;
      else {
        sessions.set(input.sessionID, { busy: true, checking: false, removed: false, abort: new AbortController() });
        await scan(input.sessionID, true); // Establish a baseline without recursively prompting.
      }
      startTimer();
    },
    event: async ({ event }: { event: { type: string; properties?: { sessionID?: string; info?: { id: string }; status?: { type: string } } } }) => {
      const id = event.properties?.sessionID ?? event.properties?.info?.id;
      const state = id ? sessions.get(id) : undefined;
      if (state && event.type === "session.status") state.busy = event.properties?.status?.type !== "idle";
      if (state && event.type === "session.idle") state.busy = false;
      if (state && event.type === "session.deleted") {
        state.removed = true;
        state.abort.abort();
        sessions.delete(id!);
      }
      if (event.type === "server.instance.disposed") {
        disposed = true;
        for (const state of sessions.values()) { state.removed = true; state.abort.abort(); }
        sessions.clear();
      }
      if (!sessions.size && timer) { clearInterval(timer); timer = undefined; }
    },
  };
}
