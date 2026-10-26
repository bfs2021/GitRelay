import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listWorktrees } from "../../src/core/git.ts";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import extension from "../../src/adapters/pi/index.ts";
import { fixture } from "../helpers.ts";
import { listSessions, readReceipt, sendMessage, sessionKey } from "../../src/core/mailbox.ts";
import { repository } from "../../src/core/store.ts";

function harness(hasUI = true, cwd = process.cwd()) {
  const selections: (string | undefined)[] = [];
  const inputs: (string | undefined)[] = [];
  const messages: any[] = [];
  const entries: any[] = [];
  const confirmations: string[] = [];
  let busy = false;
  let confirmed = false;
  let command: Parameters<ExtensionAPI["registerCommand"]>[1] | undefined;
  extension({
    registerFlag() {},
    getFlag() { return undefined; },
    on() { return () => {}; },
    sendMessage(message: unknown) { messages.push(message); busy = true; },
    registerCommand(name: string, definition: Parameters<ExtensionAPI["registerCommand"]>[1]) {
      assert.equal(name, "worktree");
      command = definition;
    },
  } as unknown as ExtensionAPI);
  const notices: { message: string; type?: string }[] = [];
  const ctx = {
    hasUI,
    cwd,
    isIdle: () => !busy,
    hasPendingMessages: () => false,
    sessionManager: { getSessionId: () => "pi-test", getBranch: () => entries },
    ui: {
      notify(message: string, type?: string) { notices.push({ message, type }); },
      async select(_title: string, options: string[]) {
        const selected = selections.shift();
        return selected === "FIRST" ? options[0] : selected;
      },
      async input() { return inputs.shift(); },
      async confirm(_title: string, message: string) { confirmations.push(message); return confirmed; },
    },
  } as unknown as ExtensionCommandContext;
  assert.ok(command);
  return { run: (args: string) => command!.handler(args, ctx), notices, selections, inputs, messages, entries, confirmations, confirm() { confirmed = true; } };
}

test("pi boolean CLI string false disables monitoring before accessing the worktree", async () => {
  let start: ((event: unknown, ctx: unknown) => Promise<void>) | undefined;
  extension({
    registerFlag() {}, registerCommand() {},
    getFlag() { return "false"; },
    on(event: string, handler: typeof start) {
      if (event === "session_start") start = handler;
      return () => {};
    },
  } as unknown as ExtensionAPI);
  let accessed = false;
  await start!({}, { mode: "tui", get cwd() { accessed = true; return process.cwd(); } });
  assert.equal(accessed, false);
});

test("registers command and allows cancelling the menu", async () => {
  const { run, notices } = harness();
  await run("");
  assert.deepEqual(notices, []);
});

test("rejects unsupported subcommands without running Git", async () => {
  const { run, notices } = harness();
  await run("remove --force");
  assert.equal(notices[0].type, "warning");
  assert.match(notices[0].message, /用法/);
});

test("dialog flow creates, lists, cancels deletion and confirms deletion", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-worktree-ui-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = join(root, "repo");
  execFileSync("git", ["init", "-b", "main", repo], { stdio: "ignore" });
  execFileSync("git", ["-C", repo, "-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "initial"], { stdio: "ignore" });
  const ui = harness(true, repo);
  const target = join(root, "new tree");
  ui.selections.push("新建分支");
  ui.inputs.push("feature/ui", target, "");
  await ui.run("add");
  assert.equal((await listWorktrees(repo)).length, 2);
  assert.match(ui.notices.at(-1)!.message, /已创建/);
  await ui.run("list");
  assert.ok(ui.notices.at(-1)!.message.includes(JSON.stringify(await realpath(target))));
  ui.selections.push("FIRST");
  await ui.run("remove");
  assert.equal((await listWorktrees(repo)).length, 2);
  ui.confirm();
  ui.selections.push("FIRST");
  await ui.run("remove");
  assert.equal((await listWorktrees(repo)).length, 1);
  assert.match(ui.confirmations.at(-1)!, /Git 忽略.*\.env.*build/);
  assert.match(ui.notices.at(-1)!.message, /已删除/);
});

test("pi join and leave explicitly control the native session subscription", async (t) => {
  const f = await fixture(t);
  const ui = harness(true, f.b);
  try {
    await ui.run("join");
    assert.equal((await listSessions(f.b))[0].closedAt, undefined);
    assert.match(ui.notices.at(-1)!.message, /已加入/);
  } finally {
    await ui.run("leave");
  }
  assert.ok((await listSessions(f.b))[0].closedAt);
  assert.match(ui.notices.at(-1)!.message, /未读消息已保留/);
});

test("pi join and leave preserve queued relay IDs until the host persists them", async (t) => {
  const f = await fixture(t);
  const ui = harness(true, f.b);
  try {
    await ui.run("join");
    const event = await sendMessage({ cwd: f.a, adapter: "cc", session: "A", text: "queued across join" });
    await ui.run("join");
    assert.equal(ui.messages.length, 1);
    assert.deepEqual(ui.messages[0].details.eventIds, [event.id]);
    const repo = await repository(f.b);
    const key = sessionKey(repo, { adapter: "pi", session: "pi-test" }, "refs/heads/main");
    assert.equal(await readReceipt(repo, key, event.id), undefined);
    await ui.run("join");
    await ui.run("join");
    assert.equal(ui.messages.length, 1, "join must not duplicate an unpersisted custom follow-up");
    await ui.run("leave");
    await ui.run("join");
    assert.equal(ui.messages.length, 1, "leave/join must not duplicate a host-owned follow-up either");
    ui.entries.push({ type: "custom_message", ...ui.messages[0] });
    await ui.run("join");
    assert.equal((await readReceipt(repo, key, event.id))?.status, "delivered");
    assert.equal(ui.messages.length, 1);
    assert.ok(!ui.notices.some((notice) => notice.type === "error"));
  } finally {
    await ui.run("leave");
  }
});

test("refuses dialog actions without a UI", async () => {
  const { run, notices } = harness(false);
  await run("add");
  assert.equal(notices[0].type, "error");
  assert.match(notices[0].message, /交互界面/);
});
