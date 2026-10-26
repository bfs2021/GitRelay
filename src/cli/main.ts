#!/usr/bin/env node
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { consumeMailbox } from "../core/consumer.ts";
import { formatNotifications, listSessions, sendMessage } from "../core/mailbox.ts";
import { runHook, type HookAgent } from "../adapters/hooks.ts";
import { joinSession, leaveSession } from "../core/sessions.ts";
import { collectGarbage } from "../core/cleanup.ts";
import { runDaemon } from "../core/daemon.ts";
import { daemonStatus } from "../core/daemon-state.ts";

const abort = new AbortController();
const stop = () => { abort.abort(); process.stdin.destroy(); };
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

// A broken or stalled pipe must not bypass lock cleanup or acknowledge undelivered data.
process.stdout.on("error", () => {});

async function output(value: object): Promise<void> {
  const written = Promise.withResolvers<void>();
  const cancel = () => written.reject(abort.signal.reason);
  abort.signal.addEventListener("abort", cancel, { once: true });
  try {
    abort.signal.throwIfAborted();
    process.stdout.write(`${JSON.stringify(value)}\n`, (error) => error ? written.reject(error) : written.resolve());
    await written.promise;
  } finally {
    abort.signal.removeEventListener("abort", cancel);
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      cwd: { type: "string" },
      ref: { type: "string", default: process.env.WORKTREE_MAIN_REF ?? "refs/heads/main" },
      session: { type: "string" },
      agent: { type: "string", default: "cli" },
      message: { type: "string" },
      file: { type: "string", multiple: true },
      apply: { type: "boolean" },
      "dry-run": { type: "boolean" },
      "retention-days": { type: "string", default: "7" },
      "interval-ms": { type: "string", default: "5000" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, agent] = positionals;
  const days = values["retention-days"].trim() ? Number(values["retention-days"]) : NaN;
  if (values.help || !command) {
    process.stdout.write("Worktree Relay (worktree-relay; worktree-sync is a compatibility alias)\n\nworktree-sync check|watch --session ID [--agent NAME] [--cwd PATH] [--ref refs/heads/main]\nworktree-sync send --session ID --agent NAME --message TEXT [--file PATH] [--cwd PATH]\nworktree-sync sessions [--cwd PATH]\nworktree-sync join|leave --session ID [--agent NAME] [--cwd PATH] [--ref REF]\nworktree-sync gc [--cwd PATH] [--apply|--dry-run] [--retention-days 7]\nworktree-sync daemon [status] [--interval-ms 5000] [--retention-days 7]\nworktree-sync hook claude-code|codex|cursor < hook-input.json\n");
    return;
  }
  if (command === "hook") {
    if (positionals.length !== 2 || !["claude-code", "codex", "cursor"].includes(agent)) throw new Error("Choose hook claude-code, codex or cursor.");
    let data = "";
    let size = 0;
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) {
      size += Buffer.byteLength(chunk);
      if (size <= 16 * 1024 * 1024) data += chunk;
      else data = "";
    }
    abort.signal.throwIfAborted();
    if (size > 16 * 1024 * 1024) {
      process.stderr.write("worktree-sync: Hook input exceeds 16 MiB; skipped without acknowledging events. The next hook can retry.\n");
      await output({});
      return;
    }
    const input = JSON.parse(data);
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Hook input must be a JSON object.");
    await runHook(agent as HookAgent, input, values.ref, output, abort.signal);
    return;
  }
  if (command === "daemon" && agent === "status" && positionals.length === 2) { await output(await daemonStatus()); return; }
  if (!["check", "watch", "send", "sessions", "join", "leave", "gc", "daemon"].includes(command) || positionals.length !== 1) throw new Error("Expected check, watch, send, sessions, join, leave, gc, daemon or hook.");
  const cwd = () => values.cwd ?? process.cwd();
  if (command === "sessions") { await output({ sessions: await listSessions(cwd()) }); return; }
  if (command === "gc") {
    if (values.apply && values["dry-run"]) throw new Error("Choose --apply or --dry-run, not both.");
    await output(await collectGarbage(cwd(), { apply: values.apply === true, retentionDays: days, signal: abort.signal }));
    return;
  }
  if (command !== "daemon" && !values.session) throw new Error("--session ID is required for per-session delivery and deduplication.");
  if (command === "join" || command === "leave") {
    const options = { cwd: cwd(), ref: values.ref, adapter: values.agent, session: values.session!, signal: abort.signal };
    const session = command === "join" ? await joinSession(options) : await leaveSession(options);
    await output({ session, left: command === "leave" && session !== undefined });
    return;
  }
  if (command === "send") {
    if (!values.message) throw new Error("--message TEXT is required.");
    const event = await sendMessage({ cwd: cwd(), ref: values.ref, adapter: values.agent, session: values.session!, text: values.message, files: values.file, signal: abort.signal });
    await output({ eventId: event.id, recipients: event.recipients.length });
    return;
  }
  const check = () => consumeMailbox({
    cwd: cwd(), ref: values.ref, session: values.session!, adapter: values.agent, signal: abort.signal,
    async deliver(notifications) {
      for (const notification of notifications) {
        const data = notification.kind === "upstream" ? notification.change : notification.event;
        await output({ type: notification.kind === "upstream" ? "worktree.upstream-change" : "worktree.agent-message", ...data, eventId: notification.event.id, message: formatNotifications([notification]) });
      }
    },
  });
  if (command === "daemon") {
    await runDaemon({ signal: abort.signal, intervalMs: Number(values["interval-ms"]), retentionDays: days, onEvent: output });
    return;
  }
  if (command === "check") { await check(); return; }
  while (!abort.signal.aborted) {
    try { await check(); } catch (error) {
      if (abort.signal.aborted) throw error;
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    }
    if (abort.signal.aborted) break;
    await delay(5000, undefined, { signal: abort.signal }).catch(() => {});
  }
}

main().catch((error) => {
  if (abort.signal.aborted && (error === abort.signal.reason || error?.name === "AbortError" || error?.code === "ERR_STREAM_PREMATURE_CLOSE")) return;
  process.stderr.write(`worktree-sync: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}).finally(() => {
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
  // Node cannot cancel OS pipe writes; all awaited operation/lock cleanup has now completed.
  if (abort.signal.aborted) process.exit(process.exitCode ?? 0);
});
