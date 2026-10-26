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
import { branchStatus } from "../core/branch-status.ts";
import { syncBranch } from "../core/branch-sync.ts";
import { git } from "../core/git.ts";
import { writeFile } from "node:fs/promises";
import { formatBranchStatus } from "../core/status-format.ts";

const abort = new AbortController();
const stop = () => { abort.abort(); process.stdin.destroy(); };
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

// A broken or stalled pipe must not bypass lock cleanup or acknowledge undelivered data.
process.stdout.on("error", () => {});

let outputFailed = false;
async function output(value: object | string): Promise<void> {
  const written = Promise.withResolvers<void>();
  const cancel = () => written.reject(abort.signal.reason);
  abort.signal.addEventListener("abort", cancel, { once: true });
  try {
    abort.signal.throwIfAborted();
    process.stdout.write(typeof value === "string" ? value : `${JSON.stringify(value)}\n`, (error) => error ? written.reject(error) : written.resolve());
    await written.promise;
  } catch (error) {
    outputFailed = true;
    throw error;
  } finally {
    abort.signal.removeEventListener("abort", cancel);
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      cwd: { type: "string" },
      branch: { type: "string" },
      github: { type: "boolean" },
      repo: { type: "string" },
      watch: { type: "boolean" },
      "auto-sync": { type: "boolean" },
      "no-auto-sync": { type: "boolean" },
      "branch-status": { type: "boolean" },
      format: { type: "string" },
      output: { type: "string" },
      ref: { type: "string", default: process.env.WORKTREE_MAIN_REF ?? "refs/heads/main" },
      session: { type: "string" },
      agent: { type: "string", default: "cli" },
      message: { type: "string" },
      file: { type: "string", multiple: true },
      apply: { type: "boolean" },
      "dry-run": { type: "boolean" },
      "retention-days": { type: "string", default: "7" },
      "interval-ms": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, agent] = positionals;
  if (values["branch-status"] && !(command === "hook" && agent === "codex")) throw new Error("--branch-status requires hook codex.");
  if ((values.format || values.output) && command !== "status") throw new Error("--format and --output require status.");
  const days = values["retention-days"].trim() ? Number(values["retention-days"]) : NaN;
  if (values.help || !command) {
    process.stdout.write("GitRelay (git-relay; worktree-relay and worktree-sync are compatibility aliases)\n\ngit-relay check|watch --session ID [--agent NAME] [--cwd PATH] [--ref refs/heads/main]\ngit-relay send --session ID --agent NAME --message TEXT [--file PATH] [--cwd PATH]\ngit-relay sessions [--cwd PATH]\ngit-relay join|leave --session ID [--agent NAME] [--cwd PATH] [--ref REF]\ngit-relay gc [--cwd PATH] [--apply|--dry-run] [--retention-days 7]\ngit-relay daemon [status] [--interval-ms 5000] [--retention-days 7]\ngit-relay hook claude-code|codex|cursor < hook-input.json\n");
    process.stdout.write("git-relay status [--branch NAME] [--github [--repo [HOST/]OWNER/REPO]] [--watch] [--auto-sync|--no-auto-sync] [--interval-ms 30000] [--session ID] [--cwd PATH]\n");
    process.stdout.write("  [--format json|markdown] [--output FILE (single Markdown snapshot)]\ngit-relay hook codex [--branch-status] < hook-input.json\n");
    return;
  }
  if (command === "status") {
    if (positionals.length !== 1) throw new Error("Expected status without positional arguments.");
    if (values.format && !["json", "markdown"].includes(values.format)) throw new Error("--format must be json or markdown.");
    if (values.output && (values.format !== "markdown" || values.watch)) throw new Error("--output requires --format markdown without --watch.");
    if (values.repo && !values.github) throw new Error("--repo requires --github.");
    if (values["auto-sync"] && values["no-auto-sync"]) throw new Error("Choose --auto-sync or --no-auto-sync, not both.");
    if (values["auto-sync"] && values.repo) throw new Error("--auto-sync uses the configured Git upstream; omit --repo to avoid an ambiguous sync source.");
    const network = values.github || values["auto-sync"];
    const interval = Number(values["interval-ms"] ?? (network ? "30000" : "5000"));
    if (!Number.isInteger(interval) || interval < (network ? 5000 : 50) || interval > 3_600_000) throw new Error(`interval-ms must be an integer between ${network ? 5000 : 50} and 3600000.`);
    const cwd = values.cwd ?? process.cwd();
    // Pin the authorized sync target so a checkout cannot redirect a running writer.
    const branch = values.branch ?? (values["auto-sync"] ? (await git(cwd, ["symbolic-ref", "--short", "HEAD"], abort.signal)).trim() : undefined);
    let previous: string | undefined;
    do {
      try {
        const sync = values["auto-sync"] ? await syncBranch(cwd, branch!, abort.signal) : undefined;
        const snapshot = { ...await branchStatus({ cwd, branch, github: values.github, repo: values.repo, signal: abort.signal }), ...(sync ? { sync } : {}) };
        const encoded = JSON.stringify(snapshot);
        if (encoded !== previous) {
          if (previous !== undefined && values.session) {
            await sendMessage({ cwd, adapter: values.agent, session: values.session, ref: values.ref, text: encoded, signal: abort.signal });
          }
          const rendered = values.format === "markdown" ? formatBranchStatus(snapshot) : snapshot;
          if (values.output) await writeFile(values.output, rendered as string, "utf8");
          await output(rendered);
          previous = encoded;
        }
        if (!values.watch && snapshot.github && "error" in snapshot.github) process.exitCode = 1;
        if (!values.watch && (sync?.state === "blocked" || sync?.state === "error")) process.exitCode = 1;
      } catch (error) {
        if (!values.watch || abort.signal.aborted || outputFailed) throw error;
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      }
      if (!values.watch || abort.signal.aborted) break;
      await delay(interval, undefined, { signal: abort.signal }).catch(() => {});
    } while (!abort.signal.aborted);
    return;
  }
  if (values.github || values.repo || values.branch || values.watch || values["auto-sync"] || values["no-auto-sync"]) throw new Error("--github, --repo, --branch, --watch and sync flags require the status command.");
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
      process.stderr.write("git-relay: Hook input exceeds 16 MiB; skipped without acknowledging events. The next hook can retry.\n");
      await output({});
      return;
    }
    const input = JSON.parse(data);
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Hook input must be a JSON object.");
    await runHook(agent as HookAgent, input, values.ref, output, abort.signal, values["branch-status"]);
    return;
  }
  if (command === "daemon" && agent === "status" && positionals.length === 2) { await output(await daemonStatus()); return; }
  if (!["check", "watch", "send", "sessions", "join", "leave", "gc", "daemon"].includes(command) || positionals.length !== 1) throw new Error("Expected status, check, watch, send, sessions, join, leave, gc, daemon or hook.");
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
    await runDaemon({ signal: abort.signal, intervalMs: Number(values["interval-ms"] ?? "5000"), retentionDays: days, onEvent: output });
    return;
  }
  if (command === "check") { await check(); return; }
  while (!abort.signal.aborted) {
    try { await check(); } catch (error) {
      if (abort.signal.aborted || outputFailed) throw error;
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    }
    if (abort.signal.aborted) break;
    await delay(5000, undefined, { signal: abort.signal }).catch(() => {});
  }
}

main().catch((error) => {
  if (abort.signal.aborted && (error === abort.signal.reason || error?.name === "AbortError" || error?.code === "ERR_STREAM_PREMATURE_CLOSE")) return;
  process.stderr.write(`git-relay: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}).finally(() => {
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
  // Node cannot cancel OS pipe writes; all awaited operation/lock cleanup has now completed.
  if (abort.signal.aborted) process.exit(process.exitCode ?? 0);
});
