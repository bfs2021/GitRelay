import { piIdentity } from "../../src/adapters/pi/identity.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { listWorktrees } from "../../src/core/git.ts";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import extension from "../../src/adapters/pi/index.ts";
import { fixture } from "../helpers.ts";
import { listSessions, readReceipt, sendMessage, sessionKey } from "../../src/core/mailbox.ts";
import { repository, withLock } from "../../src/core/store.ts";

test("an uncertain pi delivery does not retain its closed session manager", () => {
  const module = new URL("../../src/adapters/pi/index.ts", import.meta.url).href;
  const script = `
    import assert from "node:assert/strict";
    import { sessionDelivery } from ${JSON.stringify(module)};
    let weak;
    (() => {
      const manager = {};
      weak = new WeakRef(manager);
      const lease = sessionDelivery(manager, "session", "cwd", "ref");
      lease.delivery.pending = ["event"];
      lease.delivery.started = true;
      lease.release();
    })();
    for (let i = 0; i < 30; i++) {
      await new Promise(setImmediate);
      global.gc();
      if (!weak.deref()) break;
    }
    assert.equal(weak.deref(), undefined);
    const resumed = sessionDelivery({}, "session", "cwd", "ref");
    assert.deepEqual(resumed.delivery.pending, ["event"]);
    assert.equal(resumed.delivery.started, false);
    resumed.release();
  `;
  execFileSync(process.execPath, ["--expose-gc", "--experimental-strip-types", "--input-type=module", "-e", script], { timeout: 10_000 });
});

function harness(hasUI = true, cwd = process.cwd(), manager?: SessionManager) {
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
    sessionManager: manager ?? { getSessionId: () => "pi-test", getSessionFile: () => undefined, getBranch: () => entries, getLeafId: () => entries.at(-1)?.id ?? null },
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
  assert.match(notices[0].message, /Usage/);
});

test("dialog flow creates, lists and explains unavailable automatic removal", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-worktree-ui-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = join(root, "repo");
  execFileSync("git", ["init", "-b", "main", repo], { stdio: "ignore" });
  execFileSync("git", ["-C", repo, "-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "initial"], { stdio: "ignore" });
  const ui = harness(true, repo);
  const target = join(root, "new tree");
  ui.selections.push("Create a new branch");
  ui.inputs.push("feature/ui", target, "");
  await ui.run("add");
  assert.equal((await listWorktrees(repo)).length, 2);
  assert.match(ui.notices.at(-1)!.message, /Created/);
  await ui.run("list");
  assert.ok(ui.notices.at(-1)!.message.includes(JSON.stringify(await realpath(target))));
  ui.selections.push("FIRST");
  await ui.run("remove");
  assert.equal((await listWorktrees(repo)).length, 2);
  assert.equal(ui.confirmations.length, 0);
  assert.match(ui.notices.at(-1)!.message, /Automatic worktree removal is temporarily unavailable/);
  assert.match(ui.notices.at(-1)!.message, /Git-ignored.*\.env.*build/);
});

test("pi join and leave explicitly control the native session subscription", async (t) => {
  const f = await fixture(t);
  const ui = harness(true, f.b);
  try {
    await ui.run("join");
    assert.equal((await listSessions(f.b))[0].closedAt, undefined);
    assert.match(ui.notices.at(-1)!.message, /Joined/);
  } finally {
    await ui.run("leave");
  }
  assert.ok((await listSessions(f.b))[0].closedAt);
  assert.match(ui.notices.at(-1)!.message, /unread messages are preserved/);
});

test("pi join and leave preserve queued relay IDs until the host persists them", async (t) => {
  const f = await fixture(t);
  const manager = SessionManager.create(f.b, join(f.root, "pi-history"), { id: "pi-test" });
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "baseline" }], timestamp: Date.now() });
  const ui = harness(true, f.b, manager);
  try {
    await ui.run("join");
    const event = await sendMessage({ cwd: f.a, adapter: "cc", session: "A", text: "queued across join" });
    await ui.run("join");
    assert.equal(ui.messages.length, 1);
    assert.deepEqual(ui.messages[0].details.eventIds, [event.id]);
    const repo = await repository(f.b);
    const key = sessionKey(repo, piIdentity(manager), "refs/heads/main");
    assert.equal(await readReceipt(repo, key, event.id), undefined);
    await ui.run("join");
    await ui.run("join");
    assert.equal(ui.messages.length, 1, "join must not duplicate an unpersisted custom follow-up");
    await ui.run("leave");
    await ui.run("join");
    assert.equal(ui.messages.length, 1, "leave/join must not duplicate a host-owned follow-up either");
    manager.appendCustomMessageEntry(ui.messages[0].customType, ui.messages[0].content, true, ui.messages[0].details);
    await ui.run("join");
    assert.equal((await readReceipt(repo, key, event.id))?.status, "delivered");
    assert.equal(ui.messages.length, 1);
    assert.ok(!ui.notices.some((notice) => notice.type === "error"));
  } finally {
    await ui.run("leave");
  }
});

test("failed leave or join restores the active watcher", async (t) => {
  const f = await fixture(t);
  const ui = harness(true, f.b);
  const repo = await repository(f.b);
  const key = sessionKey(repo, { adapter: "pi", session: "pi-test" }, "refs/heads/main");
  try {
    await ui.run("join");
    for (const action of ["leave", "join"]) {
      await withLock(join(repo.directory, "sessions", `${key}.lock`), () => ui.run(action));
      assert.match(ui.notices.at(-1)!.message, /busy/);
    }
    await sendMessage({ cwd: f.a, adapter: "cli", session: "sender", text: "watcher recovered" });
    const deadline = Date.now() + 8000;
    while (!ui.messages.length && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(ui.messages.length, 1);
    assert.match(ui.messages[0].content, /watcher recovered/);
  } finally {
    await ui.run("leave");
  }
});

test("refuses dialog actions without a UI", async () => {
  const { run, notices } = harness(false);
  await run("add");
  assert.equal(notices[0].type, "error");
  assert.match(notices[0].message, /interactive UI/);
});

test("pi add preserves Unicode whitespace in a chosen existing branch", async (t) => {
  const f = await fixture(t);
  const branch = "topic\u00a0";
  execFileSync("git", ["-C", f.main, "branch", branch]);
  execFileSync("git", ["-C", f.main, "branch", "topic"]);
  const ui = harness(true, f.main);
  const target = join(f.root, "unicode-worktree");
  ui.selections.push("Use an existing local branch");
  ui.inputs.push(`  ${branch}  `, target);
  await ui.run("add");
  assert.match(ui.notices.at(-1)!.message, /Created/);
  const tree = (await listWorktrees(f.main)).find((item) => item.path === target);
  assert.equal(tree?.branch, branch);
});

test("pi add preserves a Unicode whitespace-only worktree path", async (t) => {
  const f = await fixture(t);
  const ui = harness(true, f.main);
  ui.selections.push("Create a new branch");
  ui.inputs.push("feature-unicode-path", "\u00a0", "");
  await ui.run("add");
  assert.match(ui.notices.at(-1)!.message, /Created/);
  const tree = (await listWorktrees(f.main)).find((item) => item.path === join(f.main, "\u00a0"));
  assert.equal(tree?.branch, "feature-unicode-path");
});

test("pi add strips only ASCII input margins and preserves a Unicode starting point", async (t) => {
  const f = await fixture(t), start = "start\u00a0";
  execFileSync("git", ["-C", f.main, "branch", start]);
  await f.commit(f.main, "shared.txt", "new main commit\n");
  const ui = harness(true, f.main), target = join(f.root, "startpoint-worktree");
  ui.selections.push("Create a new branch");
  ui.inputs.push("  feature-start  ", target, `  ${start}  `);
  await ui.run("add");
  assert.match(ui.notices.at(-1)!.message, /Created/);
  const tree = (await listWorktrees(f.main)).find((item) => item.path === target);
  assert.equal(tree?.branch, "feature-start");
  assert.equal(tree?.head, f.initial);
});
