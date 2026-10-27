import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { renameSync, writeFileSync } from "node:fs";
import { access, appendFile, chmod, open, readdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createWatcher, WATCH_MESSAGE } from "../../src/adapters/pi/watch.ts";
import { fixture } from "../helpers.ts";
import { eventsIn, formatNotifications, publishUpstream, sendMessage, sessionKey, type Notification } from "../../src/core/mailbox.ts";
import { joinSession } from "../../src/core/sessions.ts";
import { collectGarbage } from "../../src/core/cleanup.ts";
import { consumeMailbox } from "../../src/core/consumer.ts";
import { hash, readJson, repository, withLock, writeJson } from "../../src/core/store.ts";

test("pi confirms an upstream event after recipients are appended, while rejecting other changes", async (t) => {
  const f = await fixture(t), ref = "refs/heads/main";
  await writeFile(join(f.b, "shared.txt"), "local\n");
  const manager = SessionManager.create(f.b, join(f.root, "pi-history"));
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "baseline" }], timestamp: Date.now() });
  const queued: any[] = [], warnings: string[] = [];
  const watcher = createWatcher({ sendMessage(message: unknown) { queued.push(message); } } as unknown as ExtensionAPI, {
    cwd: f.b, hasPendingMessages: () => false, isIdle: () => true, sessionManager: manager,
    ui: { notify(message: string) { warnings.push(message); } },
  } as unknown as ExtensionContext, ref);
  t.after(() => watcher.stop());
  await watcher.tick();
  const repo = await repository(f.b), identity = { adapter: "pi", session: manager.getSessionId() };
  const key = sessionKey(repo, identity, ref);
  const old = await joinSession({ cwd: f.c, ref, adapter: "test", session: "old-recipient" });
  const commit = await f.commit(f.main, "shared.txt", "upstream\n");
  const event = await withLock(join(repo.directory, "publish.lock"), () => publishUpstream(repo, identity, ref, f.initial, commit, [key, old.key]));
  await watcher.tick();
  assert.equal(queued.length, 1);
  assert.deepEqual(queued[0].details.eventIds, [event.id]);
  const added = await joinSession({ cwd: f.c, ref, adapter: "test", session: "new-recipient" });
  const extended = await withLock(join(repo.directory, "publish.lock"), () => publishUpstream(repo, identity, ref, f.initial, commit, [added.key]));
  assert.deepEqual(extended.recipients, [key, old.key, added.key]);
  manager.appendCustomMessageEntry(WATCH_MESSAGE, queued[0].content, true, queued[0].details);
  const path = join(repo.directory, "events", `${event.id}.json`), receipt = join(repo.directory, "receipts", key, `${event.id}.json`);
  for (const changed of [
    { ...extended, recipients: [key, added.key] },
    { ...extended, sender: { ...extended.sender, session: "altered" } },
    { ...extended, recipients: [old.key, added.key] },
  ]) {
    await writeJson(path, changed);
    await watcher.tick();
    assert.equal(await readJson(receipt), undefined);
    assert.equal(queued.length, 1);
  }
  assert.ok(warnings.some((message) => message.includes("Pi delivery record cannot be verified")));
  await writeJson(path, extended);
  await watcher.tick();
  assert.equal((await readJson(receipt) as { status: string }).status, "delivered");
  assert.equal(queued.length, 1);
});

test("pi refuses an upstream snapshot that did not address the current session", async (t) => {
  const f = await fixture(t), ref = "refs/heads/main";
  await writeFile(join(f.b, "shared.txt"), "local\n");
  const manager = SessionManager.create(f.b, join(f.root, "pi-history"));
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "baseline" }], timestamp: Date.now() });
  const queued: any[] = [], warnings: string[] = [];
  const watcher = createWatcher({ sendMessage(message: unknown) { queued.push(message); } } as unknown as ExtensionAPI, {
    cwd: f.b, hasPendingMessages: () => false, isIdle: () => true, sessionManager: manager,
    ui: { notify(message: string) { warnings.push(message); } },
  } as unknown as ExtensionContext, ref);
  t.after(() => watcher.stop());
  await watcher.tick();
  const repo = await repository(f.b), identity = { adapter: "pi", session: manager.getSessionId() };
  const key = sessionKey(repo, identity, ref);
  const other = await joinSession({ cwd: f.c, ref, adapter: "test", session: "other-recipient" });
  const commit = await f.commit(f.main, "shared.txt", "upstream\n");
  const event = await withLock(join(repo.directory, "publish.lock"), () => publishUpstream(repo, identity, ref, f.initial, commit, [key, other.key]));
  await watcher.tick();
  assert.equal(queued.length, 1);
  const recorded = structuredClone(queued[0]);
  recorded.details.notifications[0].event.recipients = [other.key];
  recorded.content = formatNotifications(recorded.details.notifications);
  const digest = hash({ customType: WATCH_MESSAGE, content: recorded.content, display: recorded.display, details: recorded.details });
  await writeJson(join(repo.directory, "receipts", key, `${event.id}.${digest}.pi-proof`), { eventId: event.id, digest });
  manager.appendCustomMessageEntry(WATCH_MESSAGE, recorded.content, true, recorded.details);
  await watcher.tick();
  assert.equal(await readJson(join(repo.directory, "receipts", key, `${event.id}.json`)), undefined);
  assert.equal(queued.length, 1);
  assert.ok(warnings.some((message) => message.includes("Pi delivery record cannot be verified")));
});

test("generic pi consumers cannot acknowledge a queued native event with an unresolved proof", async (t) => {
  const f = await fixture(t);
  const manager = SessionManager.create(f.b, join(f.root, "pi-history"));
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "baseline" }], timestamp: Date.now() });
  const queued: unknown[] = [], warnings: string[] = [];
  const watcher = createWatcher({ sendMessage(message: unknown) { queued.push(message); } } as unknown as ExtensionAPI, {
    cwd: f.b, hasPendingMessages: () => false, isIdle: () => true, sessionManager: manager,
    ui: { notify(message: string) { warnings.push(message); } },
  } as unknown as ExtensionContext, "refs/heads/main");
  t.after(() => watcher.stop());
  await watcher.tick();
  const event = await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: "unconfirmed pi event" });
  await watcher.tick();
  await watcher.tick();
  const repo = await repository(f.b), receiver = { cwd: f.b, ref: "refs/heads/main", adapter: "pi", session: manager.getSessionId() };
  const key = sessionKey(repo, receiver, receiver.ref), dir = join(repo.directory, "receipts", key);
  const proof = (await readdir(dir)).find((name) => name.startsWith(`${event.id}.`) && name.endsWith(".pi-proof"));
  assert.ok(proof);
  assert.equal(queued.length, 1);
  assert.ok(warnings.some((warning) => warning.includes("outcome is unknown")));
  const cli = fileURLToPath(new URL("../../src/cli/main.ts", import.meta.url));
  await assert.rejects(promisify(execFile)(process.execPath, ["--experimental-strip-types", cli, "check", "--cwd", f.b, "--agent", "pi", "--session", receiver.session], { env: process.env, timeout: 5000 }), (error: unknown) => {
    const result = error as { stdout?: string; stderr?: string };
    return !result.stdout && /Pi delivery outcome is unknown/.test(result.stderr ?? "");
  });
  let invoked = false;
  await assert.rejects(consumeMailbox({ ...receiver, isPending: () => false, async deliver() { invoked = true; } }), /Pi delivery outcome is unknown/);
  await assert.rejects(consumeMailbox({ ...receiver, isDelivered: () => true, async deliver() { invoked = true; } }), /Pi delivery outcome is unknown/);
  const late = Promise.withResolvers<void>();
  try {
    await assert.rejects(consumeMailbox({ ...receiver, isDelivered: () => true, async beforeReceipt() { await late.promise; throw new Error("late check failed"); }, async deliver() { invoked = true; } }), /beforeReceipt must be synchronous/);
  } finally { late.resolve(); }
  assert.equal(invoked, false);
  assert.equal(await readJson(join(dir, `${event.id}.json`)), undefined);
  assert.ok((await collectGarbage(f.b, { apply: true, retentionDays: 0 })).kept.some((entry) => entry.id === event.id && entry.reason === "unconfirmed"));
  assert.ok((await readdir(dir)).includes(proof));
});

test("pi refreshes native acknowledgements when the branch advances during a scan or rewinds", async (t) => {
  const f = await fixture(t);
  const manager = SessionManager.create(f.b, join(f.root, "pi-history"));
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "baseline" }], timestamp: Date.now() });
  const messages: any[] = [];
  const warnings: string[] = [];
  const watcher = createWatcher({ sendMessage(message: unknown) { messages.push(message); } } as unknown as ExtensionAPI, {
    cwd: f.b, hasPendingMessages: () => false, isIdle: () => true, sessionManager: manager,
    ui: { notify(message: string) { warnings.push(message); } },
  } as unknown as ExtensionContext, "refs/heads/main");
  t.after(() => watcher.stop());
  await watcher.tick();
  for (const text of ["first", "second"]) await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text });
  const repo = await repository(f.b);
  const [first, second] = await eventsIn(repo);
  if (first.kind !== "message" || second.kind !== "message") throw new Error("Expected messages");
  const key = sessionKey(repo, { adapter: "pi", session: manager.getSessionId() }, "refs/heads/main");
  for (const event of [first, second]) {
    const notifications: Notification[] = [{ kind: "message", event }];
    const message = { customType: WATCH_MESSAGE, content: formatNotifications(notifications), display: true, details: { eventIds: [event.id], notifications } };
    const digest = hash(message);
    await writeJson(join(repo.directory, "receipts", key, `${event.id}.${digest}.pi-proof`), { eventId: event.id, digest });
  }
  const accepted = (event: typeof first) => {
    const notifications: Notification[] = [{ kind: "message", event }];
    return manager.appendCustomMessageEntry(WATCH_MESSAGE, formatNotifications(notifications), true, { eventIds: [event.id], notifications });
  };
  const leaf = accepted(first);
  const getLeafId = manager.getLeafId.bind(manager);
  let calls = 0, secondLeaf = "";
  manager.getLeafId = () => {
    if (++calls === 2) secondLeaf = accepted(second);
    return getLeafId();
  };
  await watcher.tick();
  assert.equal(messages.length, 0);
  assert.ok(warnings.some((message) => message.includes("Pi session file changed before delivery confirmation")));
  assert.equal(await readJson(join(repo.directory, "receipts", key, `${first.id}.json`)), undefined);
  assert.equal(await readJson(join(repo.directory, "receipts", key, `${second.id}.json`)), undefined);
  await watcher.tick();
  assert.equal((await readJson(join(repo.directory, "receipts", key, `${first.id}.json`)) as { status: string }).status, "delivered");
  assert.equal((await readJson(join(repo.directory, "receipts", key, `${second.id}.json`)) as { status: string }).status, "delivered");
  manager.branch(leaf);
  await rm(join(repo.directory, "receipts", key, `${second.id}.json`));
  await watcher.tick();
  assert.equal(messages.length, 0);
  assert.equal(await readJson(join(repo.directory, "receipts", key, `${second.id}.json`)), undefined);
  assert.ok(warnings.some((message) => message.includes("Pi delivery outcome is unknown")));
  manager.branch(secondLeaf);
  await watcher.tick();
  assert.equal((await readJson(join(repo.directory, "receipts", key, `${second.id}.json`)) as { status: string }).status, "delivered");
});

test("pi ignores malformed inactive history lines without skipping active entries", async (t) => {
  const f = await fixture(t);
  let manager = SessionManager.create(f.b, join(f.root, "pi-history"));
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "baseline" }], timestamp: Date.now() });
  const file = manager.getSessionFile()!;
  const queued: string[] = [];
  const warnings: string[] = [];
  const makeWatcher = () => createWatcher({
    sendMessage(message: any) {
      queued.push(...message.details.eventIds);
      manager.appendCustomMessageEntry(WATCH_MESSAGE, message.content, true, message.details);
    },
  } as unknown as ExtensionAPI, {
    cwd: f.b, hasPendingMessages: () => false, isIdle: () => true, sessionManager: manager,
    ui: { notify(message: string) { warnings.push(message); } },
  } as unknown as ExtensionContext, "refs/heads/main");
  let watcher = makeWatcher();
  await watcher.tick();
  await watcher.stop();
  await appendFile(file, "{broken-json}\n");
  manager = SessionManager.open(file);
  watcher = makeWatcher();
  t.after(() => watcher.stop());
  await watcher.tick();
  const event = await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: "after malformed inactive line" });
  await watcher.tick();
  await watcher.tick();
  const repo = await repository(f.b);
  const key = sessionKey(repo, { adapter: "pi", session: manager.getSessionId() }, "refs/heads/main");
  assert.deepEqual(queued, [event.id]);
  assert.equal((await readJson(join(repo.directory, "receipts", key, `${event.id}.json`)) as { status: string }).status, "delivered");
  assert.deepEqual(warnings, []);
});

test("pi ignores inactive entries without IDs but rejects an invalid final entry", async (t) => {
  const f = await fixture(t);
  let manager = SessionManager.create(f.b, join(f.root, "pi-history"));
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "baseline" }], timestamp: Date.now() });
  const file = manager.getSessionFile()!;
  const lines = (await readFile(file, "utf8")).trimEnd().split("\n");
  const invalid = JSON.stringify({ type: "custom", customType: "unrelated", data: "no id" });
  await writeFile(file, `${lines[0]}\n${invalid}\n${lines.slice(1).join("\n")}\n`);
  manager = SessionManager.open(file);
  const queued: string[] = [], warnings: string[] = [];
  const watcher = createWatcher({
    sendMessage(message: any) {
      queued.push(...message.details.eventIds);
      manager.appendCustomMessageEntry(WATCH_MESSAGE, message.content, true, message.details);
    },
  } as unknown as ExtensionAPI, {
    cwd: f.b, hasPendingMessages: () => false, isIdle: () => true, sessionManager: manager,
    ui: { notify(message: string) { warnings.push(message); } },
  } as unknown as ExtensionContext, "refs/heads/main");
  t.after(() => watcher.stop());
  await watcher.tick();
  const first = await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: "after inactive invalid entry" });
  await watcher.tick();
  await watcher.tick();
  assert.deepEqual(queued, [first.id]);
  const repo = await repository(f.b);
  const key = sessionKey(repo, { adapter: "pi", session: manager.getSessionId() }, "refs/heads/main");
  assert.equal((await readJson(join(repo.directory, "receipts", key, `${first.id}.json`)) as { status: string }).status, "delivered");
  await appendFile(file, `${invalid}\n`);
  const second = await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: "after invalid tail" });
  await watcher.tick();
  assert.deepEqual(queued, [first.id]);
  assert.equal(await readJson(join(repo.directory, "receipts", key, `${second.id}.json`)), undefined);
  assert.ok(warnings.some((message) => message.includes("invalid final entry ID")));
  assert.equal(SessionManager.open(file).getLeafId(), undefined);
});

test("pi refuses a FIFO swapped in after stat without hanging or sending", { skip: process.platform === "win32", timeout: 10_000 }, async (t) => {
  const f = await fixture(t);
  const repo = fileURLToPath(new URL("../../", import.meta.url));
  for (const refresh of [true, false]) {
    const script = `
    import assert from "node:assert/strict";
    import fs from "node:fs";
    import { syncBuiltinESMExports } from "node:module";
    import { execFileSync } from "node:child_process";
    import { SessionManager } from "@earendil-works/pi-coding-agent";
    import { createWatcher } from "./src/adapters/pi/watch.ts";
    import { sendMessage } from "./src/core/mailbox.ts";
    const manager = SessionManager.create(${JSON.stringify(f.b)}, ${JSON.stringify(join(f.root, "fifo-history"))} + "-${refresh}");
    manager.appendMessage({ role: "user", content: [{ type: "text", text: "baseline" }], timestamp: Date.now() });
    const file = manager.getSessionFile(); let sent = 0; const warnings = [];
    const watcher = createWatcher({ sendMessage() { sent++; } }, {
      cwd: ${JSON.stringify(f.b)}, hasPendingMessages: () => false, isIdle: () => true, sessionManager: manager,
      ui: { notify(message) { warnings.push(message); } },
    }, "refs/heads/main");
    await watcher.tick();
    await sendMessage({ cwd: ${JSON.stringify(f.a)}, adapter: "test", session: "sender", text: "fifo event" });
    if (${refresh}) await fs.promises.appendFile(file, "\\n");
    const realStat = fs.promises.stat; let swapped = false;
    fs.promises.stat = async (path, options) => {
      const result = await realStat(path, options);
      if (path === file && !swapped) { swapped = true; await fs.promises.unlink(file); execFileSync("mkfifo", [file]); }
      return result;
    };
    syncBuiltinESMExports();
    try {
      await watcher.tick(); await watcher.stop();
      assert.equal(swapped, true); assert.equal(sent, 0);
      assert.ok(warnings.some((message) => message.includes(${JSON.stringify(refresh ? "changed before reading" : "changed before delivery")})));
      process.stdout.write("ok\\n");
    } finally { fs.promises.stat = realStat; syncBuiltinESMExports(); }
    `;
    const { stdout } = await promisify(execFile)(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], { cwd: repo, timeout: 8000, killSignal: "SIGKILL" });
    assert.equal(stdout.trim(), "ok");
  }
});

test("pi closes native session streams after repeated invalid headers and stop", { skip: process.platform === "win32" }, async (t) => {
  try { await readdir("/dev/fd"); } catch { t.skip("/dev/fd is unavailable"); return; }
  const f = await fixture(t);
  const manager = SessionManager.create(f.b, join(f.root, "pi-history"));
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "baseline" }], timestamp: Date.now() });
  const file = manager.getSessionFile()!;
  const warnings: string[] = [];
  const watcher = createWatcher({ sendMessage() {} } as unknown as ExtensionAPI, {
    cwd: f.b, hasPendingMessages: () => false, isIdle: () => true, sessionManager: manager,
    ui: { notify(message: string) { warnings.push(message); } },
  } as unknown as ExtensionContext, "refs/heads/main");
  t.after(() => watcher.stop());
  await watcher.tick();
  const handle = await open(file, "w");
  await handle.write('{"type":"session","id":"another-session"}\n');
  await handle.truncate(16 * 1024 * 1024);
  await handle.close();
  const before = new Set(await readdir("/dev/fd"));
  for (let i = 0; i < 4; i++) await watcher.tick();
  await watcher.stop();
  const added = (await readdir("/dev/fd")).filter((fd) => !before.has(fd));
  assert.ok(added.length <= 1, `native session file descriptors leaked: ${added.join(", ")}`);
  assert.ok(warnings.some((message) => message.includes("does not match the active session")));
});

test("pi monitoring survives a host UI that throws while reporting an error", async (t) => {
  const f = await fixture(t);
  const manager = SessionManager.create(f.b, join(f.root, "pi-history"));
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "baseline" }], timestamp: Date.now() });
  const file = manager.getSessionFile()!;
  const original = await readFile(file);
  await writeFile(file, '{"type":"session","id":"wrong"}\n');
  let notices = 0;
  const watcher = createWatcher({ sendMessage() {} } as unknown as ExtensionAPI, {
    cwd: f.b, hasPendingMessages: () => false, isIdle: () => true, sessionManager: manager,
    ui: { notify() { notices++; throw new Error("stale UI"); } },
  } as unknown as ExtensionContext, "refs/heads/main");
  t.after(() => watcher.stop());
  await watcher.start();
  await watcher.tick();
  assert.equal(notices, 2);
  await writeFile(file, original);
  await watcher.tick();
  await watcher.stop();
});

test("pi preserves unread events when an observed session file disappears", async (t) => {
  const f = await fixture(t);
  const manager = SessionManager.create(f.b, join(f.root, "pi-history"));
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "baseline" }], timestamp: Date.now() });
  const file = manager.getSessionFile()!;
  const original = await readFile(file, "utf8");
  const queued: string[] = [], warnings: string[] = [];
  const watcher = createWatcher({
    sendMessage(message: any) {
      queued.push(...message.details.eventIds);
      manager.appendCustomMessageEntry(WATCH_MESSAGE, message.content, true, message.details);
    },
  } as unknown as ExtensionAPI, {
    cwd: f.b, hasPendingMessages: () => false, isIdle: () => true, sessionManager: manager,
    ui: { notify(message: string) { warnings.push(message); } },
  } as unknown as ExtensionContext, "refs/heads/main");
  t.after(() => watcher.stop());
  await watcher.tick();
  await unlink(file);
  const event = await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: "missing session file" });
  await watcher.tick();
  const repo = await repository(f.b);
  const key = sessionKey(repo, { adapter: "pi", session: manager.getSessionId() }, "refs/heads/main");
  const receipt = join(repo.directory, "receipts", key, `${event.id}.json`);
  assert.deepEqual(queued, []);
  assert.equal(await readJson(receipt), undefined);
  await assert.rejects(access(file), { code: "ENOENT" });
  assert.ok(warnings.some((message) => message.includes("session file disappeared")));
  await writeFile(file, original);
  await watcher.tick();
  await watcher.tick();
  assert.deepEqual(queued, [event.id]);
  assert.equal((await readJson(receipt) as { status: string }).status, "delivered");
});

for (const activeConversation of [true, false]) test(`pi stops when a persisted session file is absent before watcher startup (conversation ${activeConversation ? "active" : "on another branch"})`, async (t) => {
  const f = await fixture(t);
  const manager = SessionManager.create(f.b, join(f.root, "pi-history"));
  const root = manager.appendCustomEntry("setup", {});
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "baseline" }], timestamp: Date.now() });
  if (!activeConversation) manager.branch(root);
  assert.equal(manager.getBranch().some((entry) => entry.type === "message"), activeConversation);
  const file = manager.getSessionFile()!;
  const original = await readFile(file, "utf8");
  const options = { cwd: f.b, ref: "refs/heads/main", adapter: "pi", session: manager.getSessionId() };
  await joinSession(options);
  await unlink(file);
  const event = await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: "missing before watcher starts" });
  const queued: string[] = [], warnings: string[] = [];
  const watcher = createWatcher({
    sendMessage(message: any) {
      queued.push(...message.details.eventIds);
      manager.appendCustomMessageEntry(WATCH_MESSAGE, message.content, true, message.details);
    },
  } as unknown as ExtensionAPI, {
    cwd: f.b, hasPendingMessages: () => false, isIdle: () => true, sessionManager: manager,
    ui: { notify(message: string) { warnings.push(message); } },
  } as unknown as ExtensionContext, options.ref);
  t.after(() => watcher.stop());
  await watcher.tick();
  const repo = await repository(f.b), key = sessionKey(repo, options, options.ref);
  assert.deepEqual(queued, []);
  assert.equal(await readJson(join(repo.directory, "receipts", key, `${event.id}.json`)), undefined);
  await assert.rejects(access(file), { code: "ENOENT" });
  assert.ok(warnings.some((message) => message.includes("session file disappeared")));
  await writeFile(file, original);
  await watcher.tick();
  await watcher.tick();
  assert.deepEqual(queued, [event.id]);
  assert.equal((await readJson(join(repo.directory, "receipts", key, `${event.id}.json`)) as { status: string }).status, "delivered");
});

test("pi injects a follow-up, does not checkpoint an unpersisted queue, resumes without duplicates", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.b, "shared.txt"), "local\n");
  const manager = SessionManager.create(f.b, join(f.root, "pi-history"), { id: "pi-B" });
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "baseline" }], timestamp: Date.now() });
  const messages: any[] = [];
  const warnings: string[] = [];
  let busy = false;
  const pi = {
    sendMessage(message: unknown, options: unknown) { messages.push({ message, options }); busy = true; },
  } as unknown as ExtensionAPI;
  const ctx = {
    // Pi only counts queued user inputs here, not custom follow-ups.
    cwd: f.b, hasPendingMessages: () => false, isIdle: () => !busy, sessionManager: manager,
    ui: { notify(message: string) { warnings.push(message); } },
  } as unknown as ExtensionContext;
  let watcher = createWatcher(pi, ctx, "refs/heads/main");
  await watcher.tick();
  await f.commit(f.main, "shared.txt", "upstream 1\n");
  await watcher.tick();
  assert.equal(messages.length, 1);
  assert.equal(messages[0].message.customType, WATCH_MESSAGE);
  assert.deepEqual(messages[0].options, { triggerTurn: true, deliverAs: "followUp" });
  await f.commit(f.main, "shared.txt", "upstream 2\n");
  await watcher.tick();
  assert.equal(messages.length, 1);
  busy = false; // The host outcome is not observable, even if the queue looks empty.
  await watcher.tick();
  assert.equal(messages.length, 1);
  assert.ok(warnings.some((message) => message.includes("Pi delivery outcome is unknown")));
  manager.appendCustomMessageEntry(WATCH_MESSAGE, messages[0].message.content, true, messages[0].message.details);
  busy = false;
  await watcher.tick();
  assert.equal(messages.length, 2);
  manager.appendCustomMessageEntry(WATCH_MESSAGE, messages[1].message.content, true, messages[1].message.details);
  busy = false;
  await watcher.stop();
  watcher = createWatcher(pi, ctx, "refs/heads/main");
  await watcher.tick();
  assert.equal(messages.length, 2);
  const sent = await sendMessage({ cwd: f.a, adapter: "claude-code", session: "CC-A", text: "Coordination message from Claude Code" });
  await watcher.tick();
  assert.equal(messages.length, 3);
  assert.ok(messages[2].message.content.includes("from Claude Code"));
  assert.deepEqual(messages[2].message.details.eventIds, [sent.id]);
  manager.appendCustomMessageEntry(WATCH_MESSAGE, messages[2].message.content, true, messages[2].message.details);
  busy = false;
  await watcher.tick();
  assert.equal(messages.length, 3);
  await watcher.stop();
  await f.commit(f.main, "shared.txt", "after stop\n");
  await watcher.tick();
  assert.equal(messages.length, 3);
  assert.equal(warnings.length, 1);
});

test("pi rejects corrupted UTF-8 in native history before confirming delivery", async (t) => {
  const f = await fixture(t);
  const manager = SessionManager.create(f.b, join(f.root, "pi-history"));
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "baseline" }], timestamp: Date.now() });
  let queued: any;
  const warnings: string[] = [];
  const context = (sessionManager: SessionManager) => ({
    cwd: f.b, hasPendingMessages: () => false, isIdle: () => true, sessionManager,
    ui: { notify(message: string) { warnings.push(message); } },
  } as unknown as ExtensionContext);
  let watcher = createWatcher({ sendMessage(message: unknown) { queued = message; } } as unknown as ExtensionAPI, context(manager), "refs/heads/main");
  await watcher.tick();
  const event = await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: "UNIQUE_Z_CORRUPT_MARKER" });
  await watcher.tick();
  assert.ok(queued);
  manager.appendCustomMessageEntry(WATCH_MESSAGE, queued.content, true, queued.details);
  await watcher.stop();

  const file = manager.getSessionFile()!;
  const intact = await readFile(file);
  const corrupt = Buffer.from(intact);
  const offset = corrupt.indexOf("UNIQUE_Z_CORRUPT_MARKER");
  assert.notEqual(offset, -1);
  corrupt[offset + 7] = 0xff;
  await writeFile(file, corrupt);
  const reopened = SessionManager.open(file);
  let resent = 0;
  watcher = createWatcher({ sendMessage() { resent++; } } as unknown as ExtensionAPI, context(reopened), "refs/heads/main");
  await watcher.tick();
  await watcher.stop();
  const repo = await repository(f.b);
  const key = sessionKey(repo, { adapter: "pi", session: manager.getSessionId() }, "refs/heads/main");
  const receipt = join(repo.directory, "receipts", key, `${event.id}.json`);
  assert.equal(await readJson(receipt), undefined);
  assert.equal(resent, 0);
  assert.ok(warnings.some((message) => message.includes("Invalid UTF-8 in Pi session file")));
  assert.deepEqual(await readFile(file), corrupt);

  const truncated = Buffer.concat([intact, Buffer.from([0xf0, 0x9f])]);
  await writeFile(file, intact);
  const truncatedManager = SessionManager.open(file);
  await writeFile(file, truncated);
  const beforeWarnings = warnings.length;
  watcher = createWatcher({ sendMessage() { resent++; } } as unknown as ExtensionAPI, context(truncatedManager), "refs/heads/main");
  await watcher.tick();
  await watcher.stop();
  assert.equal(await readJson(receipt), undefined);
  assert.ok(warnings.slice(beforeWarnings).some((message) => message.includes("Invalid UTF-8 in Pi session file")));
  assert.deepEqual(await readFile(file), truncated);

  await writeFile(file, intact);
  watcher = createWatcher({ sendMessage() { resent++; } } as unknown as ExtensionAPI, context(SessionManager.open(file)), "refs/heads/main");
  await watcher.tick();
  await watcher.stop();
  assert.equal((await readJson(receipt) as { status: string }).status, "delivered");
  assert.equal(resent, 0);
});

test("pi reads valid UTF-8 split across native history stream chunks", async (t) => {
  const f = await fixture(t);
  const manager = SessionManager.create(f.b, join(f.root, "pi-history"));
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "prefix-🧪-suffix" }], timestamp: Date.now() });
  const file = manager.getSessionFile()!;
  const original = await readFile(file);
  const offset = original.indexOf(Buffer.from("🧪"));
  assert.notEqual(offset, -1);
  const padding = (65535 - offset % 65536 + 65536) % 65536;
  const shifted = Buffer.concat([original.subarray(0, offset), Buffer.alloc(padding, 0x61), original.subarray(offset)]);
  assert.equal(shifted.indexOf(Buffer.from("🧪")) % 65536, 65535);
  await writeFile(file, shifted);
  const reopened = SessionManager.open(file);
  const warnings: string[] = [];
  let queued: any;
  const watcher = createWatcher({ sendMessage(message: unknown) { queued = message; } } as unknown as ExtensionAPI, {
    cwd: f.b, hasPendingMessages: () => false, isIdle: () => true, sessionManager: reopened,
    ui: { notify(message: string) { warnings.push(message); } },
  } as unknown as ExtensionContext, "refs/heads/main");
  t.after(() => watcher.stop());
  await watcher.tick();
  const event = await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: "valid-🧪" });
  await watcher.tick();
  assert.deepEqual(queued.details.eventIds, [event.id]);
  reopened.appendCustomMessageEntry(WATCH_MESSAGE, queued.content, true, queued.details);
  await watcher.tick();
  const repo = await repository(f.b);
  const key = sessionKey(repo, { adapter: "pi", session: reopened.getSessionId() }, "refs/heads/main");
  assert.equal((await readJson(join(repo.directory, "receipts", key, `${event.id}.json`)) as { status: string }).status, "delivered");
  assert.deepEqual(warnings, []);
});

test("pi validates saved delivery contents against the pending event before confirming", async (t) => {
  const f = await fixture(t);
  const manager = SessionManager.create(f.b, join(f.root, "pi-history"));
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "baseline" }], timestamp: Date.now() });
  const warnings: string[] = [];
  const context = (sessionManager: SessionManager) => ({
    cwd: f.b, hasPendingMessages: () => false, isIdle: () => true, sessionManager,
    ui: { notify(message: string) { warnings.push(message); } },
  } as unknown as ExtensionContext);
  let queued: any;
  let watcher = createWatcher({ sendMessage(message: unknown) { queued = message; } } as unknown as ExtensionAPI, context(manager), "refs/heads/main");
  await watcher.tick();
  const event = await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: "UNIQUE_Z_CORRUPT_MARKER" });
  await watcher.tick();
  manager.appendCustomMessageEntry(WATCH_MESSAGE, queued.content, true, queued.details);
  await watcher.stop();
  const file = manager.getSessionFile()!;
  const intact = await readFile(file, "utf8");
  const repo = await repository(f.b);
  const key = sessionKey(repo, { adapter: "pi", session: manager.getSessionId() }, "refs/heads/main");
  const receipt = join(repo.directory, "receipts", key, `${event.id}.json`);
  for (const variant of ["content", "content-and-event", "ids-only", "recipients"] as const) {
    const lines = intact.trimEnd().split("\n");
    const entry = JSON.parse(lines[lines.length - 1]);
    if (variant === "content" || variant === "content-and-event") entry.content = entry.content.replace("UNIQUE_Z_CORRUPT_MARKER", "UNIQUE_Y_CORRUPT_MARKER");
    if (variant === "content-and-event") entry.details.notifications[0].event.text = "UNIQUE_Y_CORRUPT_MARKER";
    if (variant === "ids-only") delete entry.details.notifications;
    if (variant === "recipients") entry.details.notifications[0].event.recipients.push("a".repeat(64));
    lines[lines.length - 1] = JSON.stringify(entry);
    await writeFile(file, `${lines.join("\n")}\n`);
    const before = warnings.length;
    let resent = 0;
    watcher = createWatcher({ sendMessage() { resent++; } } as unknown as ExtensionAPI, context(SessionManager.open(file)), "refs/heads/main");
    await watcher.tick();
    await watcher.stop();
    assert.equal(await readJson(receipt), undefined, variant);
    assert.equal(resent, 0, variant);
    assert.ok(warnings.slice(before).some((message) => message.includes("Pi delivery record cannot be verified")), variant);
  }
  await writeFile(file, intact);
  const proofName = (await readdir(join(repo.directory, "receipts", key))).find((name) => name.endsWith(".pi-proof"));
  assert.ok(proofName);
  const proof = join(repo.directory, "receipts", key, proofName);
  const validProof = await readFile(proof);
  await rm(proof);
  const beforeMissing = warnings.length;
  watcher = createWatcher({ sendMessage() { assert.fail("unproven delivery must not be sent automatically"); } } as unknown as ExtensionAPI, context(SessionManager.open(file)), "refs/heads/main");
  await watcher.tick();
  await watcher.stop();
  assert.equal(await readJson(receipt), undefined);
  assert.ok(warnings.slice(beforeMissing).some((message) => message.includes("Pi delivery proof is missing or invalid")));
  await writeFile(proof, "{");
  const beforeCorrupt = warnings.length;
  watcher = createWatcher({ sendMessage() { assert.fail("corrupt proof must not be sent automatically"); } } as unknown as ExtensionAPI, context(SessionManager.open(file)), "refs/heads/main");
  await watcher.tick();
  await watcher.stop();
  assert.equal(await readJson(receipt), undefined);
  assert.equal(await readFile(proof, "utf8"), "{");
  assert.ok(warnings.slice(beforeCorrupt).some((message) => message.includes("Pi delivery proof is invalid or unreadable")));
  await writeFile(proof, validProof);
  watcher = createWatcher({ sendMessage() { assert.fail("intact delivery must not be sent twice"); } } as unknown as ExtensionAPI, context(SessionManager.open(file)), "refs/heads/main");
  await watcher.tick();
  await watcher.stop();
  assert.equal((await readJson(receipt) as { status: string }).status, "delivered");
});

test("pi verifies multi-event records while retaining existing receipts", async (t) => {
  const f = await fixture(t);
  const manager = SessionManager.create(f.b, join(f.root, "pi-history"));
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "baseline" }], timestamp: Date.now() });
  const warnings: string[] = [];
  const context = (sessionManager: SessionManager) => ({
    cwd: f.b, hasPendingMessages: () => false, isIdle: () => true, sessionManager,
    ui: { notify(message: string) { warnings.push(message); } },
  } as unknown as ExtensionContext);
  let queued: any;
  let watcher = createWatcher({ sendMessage(message: unknown) { queued = message; } } as unknown as ExtensionAPI, context(manager), "refs/heads/main");
  await watcher.tick();
  await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: "first" });
  await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: "second-original" });
  await watcher.tick();
  assert.equal(queued.details.eventIds.length, 2);
  manager.appendCustomMessageEntry(WATCH_MESSAGE, queued.content, true, queued.details);
  await watcher.tick();
  const repo = await repository(f.b);
  const key = sessionKey(repo, { adapter: "pi", session: manager.getSessionId() }, "refs/heads/main");
  const receipts = queued.details.eventIds.map((id: string) => join(repo.directory, "receipts", key, `${id}.json`));
  const firstReceipt = await readFile(receipts[0]);
  await unlink(receipts[1]);
  await watcher.stop();
  const file = manager.getSessionFile()!;
  const lines = (await readFile(file, "utf8")).trimEnd().split("\n");
  const entry = JSON.parse(lines[lines.length - 1]);
  const second = entry.details.notifications[1];
  second.event.text = "second-corrupt";
  entry.content = formatNotifications(entry.details.notifications);
  lines[lines.length - 1] = JSON.stringify(entry);
  await writeFile(file, `${lines.join("\n")}\n`);
  watcher = createWatcher({ sendMessage() { assert.fail("corrupt batch must not be sent"); } } as unknown as ExtensionAPI, context(SessionManager.open(file)), "refs/heads/main");
  await watcher.tick();
  await watcher.stop();
  assert.deepEqual(await readFile(receipts[0]), firstReceipt);
  assert.equal(await readJson(receipts[1]), undefined);
  assert.ok(warnings.some((message) => message.includes("Pi delivery record cannot be verified")));
});

test("pi proves a message before sending and preserves an unknown host failure", async (t) => {
  const f = await fixture(t);
  const manager = SessionManager.create(f.b, join(f.root, "pi-history"));
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "baseline" }], timestamp: Date.now() });
  const context = { cwd: f.b, hasPendingMessages: () => false, isIdle: () => true, sessionManager: manager, ui: { notify() {} } } as unknown as ExtensionContext;
  let queued: any;
  let calls = 0;
  let watcher = createWatcher({ sendMessage(message: unknown) { calls++; queued = message; throw new Error("host refused before enqueue"); } } as unknown as ExtensionAPI, context, "refs/heads/main");
  await watcher.tick();
  const event = await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: "retry after host failure" });
  await watcher.tick();
  assert.equal(calls, 1);
  const repo = await repository(f.b);
  const key = sessionKey(repo, { adapter: "pi", session: manager.getSessionId() }, "refs/heads/main");
  const dir = join(repo.directory, "receipts", key);
  const digest = hash(queued);
  const proof = join(dir, `${event.id}.${digest}.pi-proof`);
  assert.deepEqual(await readJson(proof), { eventId: event.id, digest });
  assert.equal(await readJson(join(dir, `${event.id}.json`)), undefined);
  await watcher.stop();
  watcher = createWatcher({ sendMessage(message: any) { calls++; manager.appendCustomMessageEntry(WATCH_MESSAGE, message.content, true, message.details); } } as unknown as ExtensionAPI, context, "refs/heads/main");
  await watcher.tick();
  assert.equal(calls, 1);
  assert.equal(await readJson(join(dir, `${event.id}.json`)), undefined);
  manager.appendCustomMessageEntry(WATCH_MESSAGE, queued.content, true, queued.details);
  await watcher.tick();
  await watcher.stop();
  assert.equal(calls, 1);
  assert.equal((await readJson(join(dir, `${event.id}.json`)) as { status: string }).status, "delivered");
});

test("pi preserves an uncertain scoped delivery across relevance changes and restart", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.b, "shared.txt"), "local change\n");
  const manager = SessionManager.create(f.b, join(f.root, "pi-history"));
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "baseline" }], timestamp: Date.now() });
  const warnings: string[] = [];
  let queued: any, sends = 0, busy = false;
  const context = (sessionManager: SessionManager) => ({ cwd: f.b, hasPendingMessages: () => false, isIdle: () => !busy, sessionManager, ui: { notify(message: string) { warnings.push(message); } } } as unknown as ExtensionContext);
  let watcher = createWatcher({ sendMessage(message: unknown) { sends++; queued = message; } } as unknown as ExtensionAPI, context(manager), "refs/heads/main");
  await watcher.tick();
  const event = await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: "scoped", files: ["shared.txt"] });
  await watcher.tick();
  assert.deepEqual(queued.details.eventIds, [event.id]);
  const repo = await repository(f.b), key = sessionKey(repo, { adapter: "pi", session: manager.getSessionId() }, "refs/heads/main");
  const directory = join(repo.directory, "receipts", key), receipt = join(directory, `${event.id}.json`);
  await writeFile(join(f.b, "shared.txt"), "base\n");
  busy = true;
  await watcher.tick();
  assert.equal(await readJson(receipt), undefined);
  assert.equal(warnings.length, 0);
  busy = false;
  await watcher.tick();
  assert.equal(await readJson(receipt), undefined);
  assert.ok(warnings.some((message) => message.includes("Pi delivery outcome is unknown")));
  const gc = await collectGarbage(f.b, { apply: true, retentionDays: 0 });
  assert.ok(gc.kept.some((item) => item.id === event.id && item.reason === "unconfirmed"));
  assert.ok((await readdir(directory)).some((name) => name.startsWith(`${event.id}.`) && name.endsWith(".pi-proof")));
  await watcher.stop();

  const resumed = SessionManager.open(manager.getSessionFile()!);
  watcher = createWatcher({ sendMessage() { sends++; } } as unknown as ExtensionAPI, context(resumed), "refs/heads/main");
  await watcher.tick();
  assert.equal(await readJson(receipt), undefined);
  assert.equal(sends, 1, "a retained proof does not establish that resending is safe");
  resumed.appendCustomMessageEntry(WATCH_MESSAGE, queued.content, true, queued.details);
  await watcher.tick();
  await watcher.stop();
  assert.equal((await readJson(receipt) as { status: string }).status, "delivered");
  assert.equal(sends, 1);
});

test("pi does not confirm a record after the active branch changes during proof reading", async (t) => {
  const f = await fixture(t);
  const manager = SessionManager.create(f.b, join(f.root, "pi-history"));
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "baseline" }], timestamp: Date.now() });
  const previous = manager.getLeafId()!;
  let queued: any;
  let sends = 0;
  const watcher = createWatcher({ sendMessage(message: unknown) { sends++; queued = message; } } as unknown as ExtensionAPI, {
    cwd: f.b, hasPendingMessages: () => false, isIdle: () => true, sessionManager: manager, ui: { notify() {} },
  } as unknown as ExtensionContext, "refs/heads/main");
  t.after(() => watcher.stop());
  await watcher.tick();
  const event = await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: "branch race" });
  await watcher.tick();
  const recorded = manager.appendCustomMessageEntry(WATCH_MESSAGE, queued.content, true, queued.details);
  const repo = await repository(f.b);
  const key = sessionKey(repo, { adapter: "pi", session: manager.getSessionId() }, "refs/heads/main");
  const receipt = join(repo.directory, "receipts", key, `${event.id}.json`);
  const probe = await open(manager.getSessionFile()!, "r");
  const prototype = Object.getPrototypeOf(probe);
  const originalRead = prototype.read;
  await probe.close();
  let switched = false;
  prototype.read = async function (...args: any[]) {
    const result = await originalRead.apply(this, args);
    if (!switched && result.bytesRead && args[0].subarray(0, result.bytesRead).toString().includes('"digest"')) {
      switched = true;
      manager.branch(previous);
    }
    return result;
  };
  try { await watcher.tick(); } finally { prototype.read = originalRead; }
  assert.equal(switched, true);
  assert.equal(manager.getLeafId(), previous);
  assert.equal(await readJson(receipt), undefined);
  assert.equal(sends, 1);
  manager.branch(recorded);
  await watcher.tick();
  assert.equal((await readJson(receipt) as { status: string }).status, "delivered");
});

test("pi rechecks the active branch immediately before publishing a receipt", async (t) => {
  const f = await fixture(t);
  const manager = SessionManager.create(f.b, join(f.root, "pi-history"));
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "baseline" }], timestamp: Date.now() });
  const previous = manager.getLeafId()!;
  let queued: any, sends = 0;
  const watcher = createWatcher({ sendMessage(message: unknown) { sends++; queued = message; } } as unknown as ExtensionAPI, {
    cwd: f.b, hasPendingMessages: () => false, isIdle: () => true, sessionManager: manager, ui: { notify() {} },
  } as unknown as ExtensionContext, "refs/heads/main");
  t.after(() => watcher.stop());
  await watcher.tick();
  const event = await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: "branch before receipt" });
  await watcher.tick();
  const recorded = manager.appendCustomMessageEntry(WATCH_MESSAGE, queued.content, true, queued.details);
  const repo = await repository(f.b), key = sessionKey(repo, { adapter: "pi", session: manager.getSessionId() }, "refs/heads/main");
  const dir = join(repo.directory, "receipts", key), receipt = join(dir, `${event.id}.json`);
  const originalOpen = fs.promises.open;
  let switched = false;
  fs.promises.open = (async (path: any, ...args: any[]) => {
    const handle = await (originalOpen as any)(path, ...args);
    if (String(path).startsWith(`${receipt}.`)) {
      const originalWrite = handle.writeFile.bind(handle);
      handle.writeFile = async (...writeArgs: any[]) => {
        const result = await originalWrite(...writeArgs);
        if (!switched) { switched = true; manager.branch(previous); }
        return result;
      };
    }
    return handle;
  }) as typeof fs.promises.open;
  syncBuiltinESMExports();
  try { await watcher.tick(); } finally { fs.promises.open = originalOpen; syncBuiltinESMExports(); }
  assert.equal(switched, true);
  assert.equal(manager.getLeafId(), previous);
  assert.equal(await readJson(receipt), undefined);
  assert.ok(!(await readdir(dir)).some((name) => name.startsWith(`${event.id}.json.`) && name.endsWith(".tmp")));
  assert.equal(sends, 1);
  manager.branch(recorded);
  await watcher.tick();
  assert.equal((await readJson(receipt) as { status: string }).status, "delivered");
  assert.equal(sends, 1);
});

test("pi cancellation during receipt preparation preserves the event and proof", async (t) => {
  const f = await fixture(t);
  const manager = SessionManager.create(f.b, join(f.root, "pi-history"));
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "baseline" }], timestamp: Date.now() });
  let queued: any;
  const context = { cwd: f.b, hasPendingMessages: () => false, isIdle: () => true, sessionManager: manager, ui: { notify() {} } } as unknown as ExtensionContext;
  let watcher = createWatcher({ sendMessage(message: unknown) { queued = message; } } as unknown as ExtensionAPI, context, "refs/heads/main");
  await watcher.tick();
  const event = await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: "cancel before receipt" });
  await watcher.tick();
  manager.appendCustomMessageEntry(WATCH_MESSAGE, queued.content, true, queued.details);
  const repo = await repository(f.b), key = sessionKey(repo, { adapter: "pi", session: manager.getSessionId() }, "refs/heads/main");
  const dir = join(repo.directory, "receipts", key), receipt = join(dir, `${event.id}.json`);
  const originalOpen = fs.promises.open;
  let stopped: Promise<void> | undefined;
  fs.promises.open = (async (path: any, ...args: any[]) => {
    const handle = await (originalOpen as any)(path, ...args);
    if (String(path).startsWith(`${receipt}.`)) {
      const originalWrite = handle.writeFile.bind(handle);
      handle.writeFile = async (...writeArgs: any[]) => {
        const result = await originalWrite(...writeArgs);
        if (!stopped) stopped = watcher.stop();
        return result;
      };
    }
    return handle;
  }) as typeof fs.promises.open;
  syncBuiltinESMExports();
  try { await watcher.tick(); } finally { fs.promises.open = originalOpen; syncBuiltinESMExports(); }
  assert.ok(stopped);
  await stopped;
  assert.equal(await readJson(receipt), undefined);
  assert.ok(!(await readdir(dir)).some((name) => name.startsWith(`${event.id}.json.`) && name.endsWith(".tmp")));
  assert.ok((await readdir(dir)).some((name) => name.startsWith(`${event.id}.`) && name.endsWith(".pi-proof")));
  watcher = createWatcher({ sendMessage() { assert.fail("persisted delivery must not be sent again"); } } as unknown as ExtensionAPI, context, "refs/heads/main");
  await watcher.tick(); await watcher.stop();
  assert.equal((await readJson(receipt) as { status: string }).status, "delivered");
});

test("pi does not send after cancellation while publishing a proof", async (t) => {
  const f = await fixture(t);
  const manager = SessionManager.create(f.b, join(f.root, "pi-history"));
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "baseline" }], timestamp: Date.now() });
  let sent = 0;
  const context = { cwd: f.b, hasPendingMessages: () => false, isIdle: () => true, sessionManager: manager, ui: { notify() {} } } as unknown as ExtensionContext;
  let watcher = createWatcher({ sendMessage() { sent++; } } as unknown as ExtensionAPI, context, "refs/heads/main");
  await watcher.tick();
  const event = await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: "abort before send" });
  const probe = await open(manager.getSessionFile()!, "r");
  const prototype = Object.getPrototypeOf(probe), originalRead = prototype.read;
  await probe.close();
  let stopped: Promise<void> | undefined;
  prototype.read = async function (...args: any[]) {
    const result = await originalRead.apply(this, args);
    if (!stopped && result.bytesRead && args[0].subarray(0, result.bytesRead).toString().includes('"digest"')) stopped = watcher.stop();
    return result;
  };
  try { await watcher.tick(); } finally { prototype.read = originalRead; }
  assert.ok(stopped);
  await stopped;
  assert.equal(sent, 0);
  const repo = await repository(f.b);
  const key = sessionKey(repo, { adapter: "pi", session: manager.getSessionId() }, "refs/heads/main");
  const dir = join(repo.directory, "receipts", key);
  assert.equal(await readJson(join(dir, `${event.id}.json`)), undefined);
  assert.ok(!(await readdir(dir)).some((name) => name.startsWith(`${event.id}.`) && name.endsWith(".pi-proof")));
  watcher = createWatcher({ sendMessage(message: any) { sent++; manager.appendCustomMessageEntry(WATCH_MESSAGE, message.content, true, message.details); } } as unknown as ExtensionAPI, context, "refs/heads/main");
  await watcher.tick(); await watcher.tick(); await watcher.stop();
  assert.equal(sent, 1);
  assert.equal((await readJson(join(dir, `${event.id}.json`)) as { status: string }).status, "delivered");
});

test("pi removes its own pre-send proof when proof validation fails", async (t) => {
  const f = await fixture(t);
  const manager = SessionManager.create(f.b, join(f.root, "pi-history"));
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "baseline" }], timestamp: Date.now() });
  let sends = 0;
  const warnings: string[] = [];
  const watcher = createWatcher({ sendMessage(message: any) { sends++; manager.appendCustomMessageEntry(WATCH_MESSAGE, message.content, true, message.details); } } as unknown as ExtensionAPI, {
    cwd: f.b, hasPendingMessages: () => false, isIdle: () => true, sessionManager: manager,
    ui: { notify(message: string) { warnings.push(message); } },
  } as unknown as ExtensionContext, "refs/heads/main");
  t.after(() => watcher.stop());
  await watcher.tick();
  const event = await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: "proof read failure" });
  const originalOpen = fs.promises.open;
  let injected = false;
  fs.promises.open = (async (path: any, ...args: any[]) => {
    if (!injected && String(path).endsWith(".pi-proof")) { injected = true; throw Object.assign(new Error("injected I/O error"), { code: "EIO" }); }
    return (originalOpen as any)(path, ...args);
  }) as typeof fs.promises.open;
  syncBuiltinESMExports();
  try { await watcher.tick(); } finally { fs.promises.open = originalOpen; syncBuiltinESMExports(); }
  const repo = await repository(f.b), key = sessionKey(repo, { adapter: "pi", session: manager.getSessionId() }, "refs/heads/main");
  const directory = join(repo.directory, "receipts", key);
  assert.equal(injected, true);
  assert.equal(sends, 0);
  assert.equal(await readJson(join(directory, `${event.id}.json`)), undefined);
  assert.ok(!(await readdir(directory)).some((name) => name.startsWith(`${event.id}.`) && name.endsWith(".pi-proof")));
  assert.ok(warnings.some((message) => message.includes("Pi delivery proof is invalid or unreadable")));
  await watcher.tick(); await watcher.tick();
  assert.equal(sends, 1);
  assert.equal((await readJson(join(directory, `${event.id}.json`)) as { status: string }).status, "delivered");
});

test("pi preserves proof temporaries and permits retry when temporary cleanup fails before sending", async (t) => {
  const f = await fixture(t);
  const manager = SessionManager.create(f.b, join(f.root, "pi-history"));
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "baseline" }], timestamp: Date.now() });
  let sends = 0;
  const warnings: string[] = [];
  const watcher = createWatcher({ sendMessage(message: any) { sends++; manager.appendCustomMessageEntry(WATCH_MESSAGE, message.content, true, message.details); } } as unknown as ExtensionAPI, {
    cwd: f.b, hasPendingMessages: () => false, isIdle: () => true, sessionManager: manager,
    ui: { notify(message: string) { warnings.push(message); } },
  } as unknown as ExtensionContext, "refs/heads/main");
  t.after(() => watcher.stop());
  await watcher.tick();
  const event = await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: "temporary cleanup failure" });
  const originalRm = fs.promises.rm;
  let injected = false;
  fs.promises.rm = (async (path: any, ...args: any[]) => {
    if (!injected && String(path).includes(".pi-proof.") && String(path).endsWith(".tmp")) { injected = true; throw Object.assign(new Error("injected cleanup error"), { code: "EIO" }); }
    return (originalRm as any)(path, ...args);
  }) as typeof fs.promises.rm;
  syncBuiltinESMExports();
  try { await watcher.tick(); } finally { fs.promises.rm = originalRm; syncBuiltinESMExports(); }
  const repo = await repository(f.b), key = sessionKey(repo, { adapter: "pi", session: manager.getSessionId() }, "refs/heads/main");
  const directory = join(repo.directory, "receipts", key), names = await readdir(directory);
  assert.equal(injected, true);
  assert.equal(sends, 0);
  assert.ok(names.some((name) => name.startsWith(`${event.id}.`) && name.endsWith(".tmp")));
  assert.ok(!names.some((name) => name.startsWith(`${event.id}.`) && name.endsWith(".pi-proof")));
  assert.equal(await readJson(join(directory, `${event.id}.json`)), undefined);
  assert.ok(warnings.some((message) => message.includes("Pi pre-send proof could not be safely removed")));
  await watcher.tick(); await watcher.tick();
  assert.equal(sends, 1);
  assert.equal((await readJson(join(directory, `${event.id}.json`)) as { status: string }).status, "delivered");
  assert.ok((await readdir(directory)).some((name) => name.startsWith(`${event.id}.`) && name.endsWith(".tmp")));
});

test("pi preserves an existing temporary proof after an exclusive-create collision", async (t) => {
  const f = await fixture(t);
  const manager = SessionManager.create(f.b, join(f.root, "pi-history"));
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "baseline" }], timestamp: Date.now() });
  let sends = 0;
  const watcher = createWatcher({ sendMessage(message: any) { sends++; manager.appendCustomMessageEntry(WATCH_MESSAGE, message.content, true, message.details); } } as unknown as ExtensionAPI, {
    cwd: f.b, hasPendingMessages: () => false, isIdle: () => true, sessionManager: manager, ui: { notify() {} },
  } as unknown as ExtensionContext, "refs/heads/main");
  t.after(() => watcher.stop());
  await watcher.tick();
  const event = await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: "temporary collision" });
  const originalWrite = fs.promises.writeFile;
  let occupied = "";
  fs.promises.writeFile = (async (path: any, ...args: any[]) => {
    if (!occupied && String(path).includes(".pi-proof.") && String(path).endsWith(".tmp")) {
      occupied = String(path);
      await (originalWrite as any)(path, "unrelated existing data", { flag: "wx" });
      throw Object.assign(new Error("injected collision"), { code: "EEXIST" });
    }
    return (originalWrite as any)(path, ...args);
  }) as typeof fs.promises.writeFile;
  syncBuiltinESMExports();
  try { await watcher.tick(); } finally { fs.promises.writeFile = originalWrite; syncBuiltinESMExports(); }
  assert.ok(occupied);
  assert.equal(await readFile(occupied, "utf8"), "unrelated existing data");
  assert.equal(sends, 0);
  const repo = await repository(f.b), key = sessionKey(repo, { adapter: "pi", session: manager.getSessionId() }, "refs/heads/main");
  assert.equal(await readJson(join(repo.directory, "receipts", key, `${event.id}.json`)), undefined);
  await watcher.tick(); await watcher.tick();
  assert.equal(sends, 1);
  assert.equal(await readFile(occupied, "utf8"), "unrelated existing data");
});

test("pi preserves a newly created proof whose contents change before cancellation", async (t) => {
  const f = await fixture(t);
  const manager = SessionManager.create(f.b, join(f.root, "pi-history"));
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "baseline" }], timestamp: Date.now() });
  let sends = 0;
  const watcher = createWatcher({ sendMessage() { sends++; } } as unknown as ExtensionAPI, {
    cwd: f.b, hasPendingMessages: () => false, isIdle: () => true, sessionManager: manager, ui: { notify() {} },
  } as unknown as ExtensionContext, "refs/heads/main");
  await watcher.tick();
  const event = await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: "proof externally modified" });
  const notifications: Notification[] = [{ kind: "message", event }];
  const message = { customType: WATCH_MESSAGE, content: formatNotifications(notifications), display: true, details: { eventIds: [event.id], notifications } };
  const repo = await repository(f.b), key = sessionKey(repo, { adapter: "pi", session: manager.getSessionId() }, "refs/heads/main");
  const proof = join(repo.directory, "receipts", key, `${event.id}.${hash(message)}.pi-proof`);
  const probe = await open(manager.getSessionFile()!, "r"), prototype = Object.getPrototypeOf(probe), originalRead = prototype.read;
  await probe.close();
  let stopped: Promise<void> | undefined;
  prototype.read = async function (...args: any[]) {
    const result = await originalRead.apply(this, args);
    if (!stopped && result.bytesRead && args[0].subarray(0, result.bytesRead).toString().includes('"digest"')) {
      await writeFile(proof, "changed externally");
      stopped = watcher.stop();
    }
    return result;
  };
  try { await watcher.tick(); } finally { prototype.read = originalRead; }
  assert.ok(stopped);
  await stopped;
  assert.equal(sends, 0);
  assert.equal(await readFile(proof, "utf8"), "changed externally");
  assert.equal(await readJson(join(repo.directory, "receipts", key, `${event.id}.json`)), undefined);
});

test("pi does not remove an existing proof when publication races cancellation", async (t) => {
  const f = await fixture(t);
  const manager = SessionManager.create(f.b, join(f.root, "pi-history"));
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "baseline" }], timestamp: Date.now() });
  let sends = 0;
  const watcher = createWatcher({ sendMessage() { sends++; } } as unknown as ExtensionAPI, {
    cwd: f.b, hasPendingMessages: () => false, isIdle: () => true, sessionManager: manager, ui: { notify() {} },
  } as unknown as ExtensionContext, "refs/heads/main");
  await watcher.tick();
  const event = await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: "existing proof race" });
  const originalLink = fs.promises.link;
  let otherProof = "", stopped: Promise<void> | undefined;
  fs.promises.link = (async (source: any, target: any) => {
    if (!otherProof && String(target).endsWith(".pi-proof")) {
      otherProof = String(target);
      await fs.promises.copyFile(source, target);
      stopped = watcher.stop();
      throw Object.assign(new Error("simulated competing publication"), { code: "EEXIST" });
    }
    return originalLink(source, target);
  }) as typeof fs.promises.link;
  syncBuiltinESMExports();
  try { await watcher.tick(); } finally { fs.promises.link = originalLink; syncBuiltinESMExports(); }
  assert.ok(stopped);
  await stopped;
  assert.equal(sends, 0);
  assert.ok(otherProof);
  assert.equal((await readJson(otherProof) as { eventId: string }).eventId, event.id);
});

test("pi preserves a conflicting proof and does not send", async (t) => {
  const f = await fixture(t);
  const manager = SessionManager.create(f.b, join(f.root, "pi-history"));
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "baseline" }], timestamp: Date.now() });
  const warnings: string[] = [];
  let sent = 0;
  const watcher = createWatcher({ sendMessage() { sent++; } } as unknown as ExtensionAPI, {
    cwd: f.b, hasPendingMessages: () => false, isIdle: () => true, sessionManager: manager,
    ui: { notify(message: string) { warnings.push(message); } },
  } as unknown as ExtensionContext, "refs/heads/main");
  t.after(() => watcher.stop());
  await watcher.tick();
  const event = await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: "conflicting proof" });
  const notifications: Notification[] = [{ kind: "message", event }];
  const message = { customType: WATCH_MESSAGE, content: formatNotifications(notifications), display: true, details: { eventIds: [event.id], notifications } };
  const repo = await repository(f.b);
  const key = sessionKey(repo, { adapter: "pi", session: manager.getSessionId() }, "refs/heads/main");
  const path = join(repo.directory, "receipts", key, `${event.id}.${hash(message)}.pi-proof`);
  await writeFile(path, "existing data");
  await watcher.tick();
  assert.equal(sent, 0);
  assert.equal(await readFile(path, "utf8"), "existing data");
  assert.equal(await readJson(join(repo.directory, "receipts", key, `${event.id}.json`)), undefined);
  assert.ok(warnings.some((message) => message.includes("Pi delivery outcome is unknown")));
});

test("pi preserves existing proofs, avoids repeated sends, and confirms an existing proof at the limit", async (t) => {
  const f = await fixture(t);
  const manager = SessionManager.create(f.b, join(f.root, "pi-history"));
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "baseline" }], timestamp: Date.now() });
  let attempts = 0, queued: any;
  const warnings: string[] = [];
  const watcher = createWatcher({ sendMessage(message: unknown) { attempts++; queued = message; throw new Error("unknown host outcome"); } } as unknown as ExtensionAPI, {
    cwd: f.b, hasPendingMessages: () => false, isIdle: () => true, sessionManager: manager,
    ui: { notify(message: string) { warnings.push(message); } },
  } as unknown as ExtensionContext, "refs/heads/main");
  t.after(() => watcher.stop());
  await watcher.tick();
  const first = await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: "same proof" });
  await watcher.tick(); await watcher.tick();
  assert.equal(attempts, 1);
  const repo = await repository(f.b), key = sessionKey(repo, { adapter: "pi", session: manager.getSessionId() }, "refs/heads/main");
  const directory = join(repo.directory, "receipts", key);
  assert.equal((await readdir(directory)).filter((name) => name.startsWith(`${first.id}.`) && name.endsWith(".pi-proof")).length, 1);
  for (let i = 0; i < 15; i++) await writeFile(join(directory, `${first.id}.${i.toString(16).padStart(64, "0")}.pi-proof`), "preserve");
  await watcher.tick();
  assert.equal(attempts, 1, "an uncertain host outcome must not trigger a repeat");
  manager.appendCustomMessageEntry(WATCH_MESSAGE, queued.content, true, queued.details);
  await watcher.tick();
  assert.equal((await readJson(join(directory, `${first.id}.json`)) as { status: string }).status, "delivered");

  const second = await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: "new proof at limit" });
  for (let i = 0; i < 16; i++) await writeFile(join(directory, `${second.id}.${i.toString(16).padStart(64, "0")}.pi-proof`), "preserve");
  await watcher.tick();
  assert.equal(attempts, 1, "a seventeenth distinct proof must not be sent");
  assert.equal(await readJson(join(directory, `${second.id}.json`)), undefined);
  assert.equal((await readdir(directory)).filter((name) => name.startsWith(`${second.id}.`) && name.endsWith(".pi-proof")).length, 16);
  assert.ok(warnings.some((message) => message.includes("Pi delivery outcome is unknown")));
});

test("pi delivery proofs are isolated by receiving session", async (t) => {
  const f = await fixture(t);
  const managers = ["one", "two"].map((id) => SessionManager.create(f.b, join(f.root, `pi-${id}`), { id }));
  for (const manager of managers) manager.appendMessage({ role: "user", content: [{ type: "text", text: "baseline" }], timestamp: Date.now() });
  const warnings: string[] = [];
  const context = (sessionManager: SessionManager) => ({ cwd: f.b, hasPendingMessages: () => false, isIdle: () => true, sessionManager, ui: { notify(message: string) { warnings.push(message); } } } as unknown as ExtensionContext);
  let queued: any;
  const first = createWatcher({ sendMessage(message: unknown) { queued = message; } } as unknown as ExtensionAPI, context(managers[0]), "refs/heads/main");
  const second = createWatcher({ sendMessage() { assert.fail("unproven native record must not be acknowledged"); } } as unknown as ExtensionAPI, context(managers[1]), "refs/heads/main");
  t.after(async () => { await first.stop(); await second.stop(); });
  await first.tick(); await second.tick();
  const event = await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: "for both sessions" });
  await first.tick();
  managers[1].appendCustomMessageEntry(WATCH_MESSAGE, queued.content, true, queued.details);
  await second.tick();
  const repo = await repository(f.b);
  const secondKey = sessionKey(repo, { adapter: "pi", session: managers[1].getSessionId() }, "refs/heads/main");
  assert.equal(await readJson(join(repo.directory, "receipts", secondKey, `${event.id}.json`)), undefined);
  assert.ok(warnings.some((message) => message.includes("Pi delivery proof is missing or invalid")));
});

test("pi rejects a jointly altered upstream patch and formatted message", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.b, "shared.txt"), "local\n");
  const manager = SessionManager.create(f.b, join(f.root, "pi-history"));
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "baseline" }], timestamp: Date.now() });
  const warnings: string[] = [];
  const context = (sessionManager: SessionManager) => ({ cwd: f.b, hasPendingMessages: () => false, isIdle: () => true, sessionManager, ui: { notify(message: string) { warnings.push(message); } } } as unknown as ExtensionContext);
  let queued: any;
  let watcher = createWatcher({ sendMessage(message: unknown) { queued = message; } } as unknown as ExtensionAPI, context(manager), "refs/heads/main");
  await watcher.tick();
  await f.commit(f.main, "shared.txt", "upstream changed\n");
  await watcher.tick();
  assert.equal(queued.details.notifications[0].kind, "upstream");
  const id = queued.details.eventIds[0];
  manager.appendCustomMessageEntry(WATCH_MESSAGE, queued.content, true, queued.details);
  await watcher.stop();
  const file = manager.getSessionFile()!;
  const lines = (await readFile(file, "utf8")).trimEnd().split("\n");
  const entry = JSON.parse(lines[lines.length - 1]);
  entry.details.notifications[0].change.patch = "forged patch";
  entry.content = formatNotifications(entry.details.notifications);
  lines[lines.length - 1] = JSON.stringify(entry);
  await writeFile(file, `${lines.join("\n")}\n`);
  watcher = createWatcher({ sendMessage() { assert.fail("unproven upstream message must not be sent automatically"); } } as unknown as ExtensionAPI, context(SessionManager.open(file)), "refs/heads/main");
  await watcher.tick();
  await watcher.stop();
  const repo = await repository(f.b);
  const key = sessionKey(repo, { adapter: "pi", session: manager.getSessionId() }, "refs/heads/main");
  assert.equal(await readJson(join(repo.directory, "receipts", key, `${id}.json`)), undefined);
  assert.ok(warnings.some((message) => message.includes("Pi delivery proof is missing or invalid")));
});

test("GC removes confirmed pi proofs and preserves unrelated files", async (t) => {
  const f = await fixture(t);
  const manager = SessionManager.create(f.b, join(f.root, "pi-history"));
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "baseline" }], timestamp: Date.now() });
  const watcher = createWatcher({ sendMessage(message: any) { manager.appendCustomMessageEntry(WATCH_MESSAGE, message.content, true, message.details); } } as unknown as ExtensionAPI, {
    cwd: f.b, hasPendingMessages: () => false, isIdle: () => true, sessionManager: manager, ui: { notify() {} },
  } as unknown as ExtensionContext, "refs/heads/main");
  t.after(() => watcher.stop());
  await watcher.tick();
  const event = await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: "gc proof" });
  await watcher.tick(); await watcher.tick();
  const repo = await repository(f.b);
  const key = sessionKey(repo, { adapter: "pi", session: manager.getSessionId() }, "refs/heads/main");
  const dir = join(repo.directory, "receipts", key);
  const proofs = (await readdir(dir)).filter((name) => name.startsWith(`${event.id}.`) && name.endsWith(".pi-proof"));
  assert.equal(proofs.length, 1);
  const extra = `${event.id}.${"f".repeat(64)}.pi-proof`;
  await writeFile(join(dir, extra), "old attempt");
  await writeFile(join(dir, "unrelated.txt"), "preserve");
  const result = await collectGarbage(f.b, { apply: true, retentionDays: 0 });
  assert.ok(result.removed.includes(event.id));
  assert.equal(await readJson(join(dir, `${event.id}.json`)), undefined);
  assert.ok(!(await readdir(dir)).includes(proofs[0]));
  assert.ok(!(await readdir(dir)).includes(extra));
  assert.equal(await readFile(join(dir, "unrelated.txt"), "utf8"), "preserve");
});

test("pi keeps busy events unread until the host is idle", async (t) => {
  const f = await fixture(t);
  const manager = SessionManager.create(f.b, join(f.root, "pi-history"));
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "baseline" }], timestamp: Date.now() });
  let busy = true;
  const queued: string[] = [];
  const watcher = createWatcher({
    sendMessage(message: any) {
      queued.push(...message.details.eventIds);
      manager.appendCustomMessageEntry(WATCH_MESSAGE, message.content, true, message.details);
    },
  } as unknown as ExtensionAPI, {
    cwd: f.b, hasPendingMessages: () => false, isIdle: () => !busy, sessionManager: manager, ui: { notify() {} },
  } as unknown as ExtensionContext, "refs/heads/main");
  t.after(() => watcher.stop());
  await watcher.tick();
  const event = await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: "while busy" });
  await watcher.tick();
  await watcher.tick();
  const repo = await repository(f.b), key = sessionKey(repo, { adapter: "pi", session: manager.getSessionId() }, "refs/heads/main");
  const receipt = join(repo.directory, "receipts", key, `${event.id}.json`);
  assert.deepEqual(queued, []);
  assert.equal(await readJson(receipt), undefined);
  busy = false;
  await watcher.tick();
  await watcher.tick();
  assert.deepEqual(queued, [event.id]);
  assert.equal((await readJson(receipt) as { status: string }).status, "delivered");
});

test("pi does not resend an unobservable idle deferred action across watcher replacement", async (t) => {
  const f = await fixture(t);
  const manager = SessionManager.create(f.b, join(f.root, "pi-history"));
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "baseline" }], timestamp: Date.now() });
  const queued: any[] = [], warnings: string[] = [];
  const delivery: { pending?: string[]; started?: boolean } = {};
  const pi = { sendMessage(message: any) { queued.push(message); } } as unknown as ExtensionAPI;
  const ctx = {
    cwd: f.b, hasPendingMessages: () => false, isIdle: () => true, sessionManager: manager,
    ui: { notify(message: string) { warnings.push(message); } },
  } as unknown as ExtensionContext;
  let watcher = createWatcher(pi, ctx, "refs/heads/main", delivery);
  await watcher.tick();
  const event = await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: "deferred while idle" });
  await watcher.tick();
  await watcher.stop();
  watcher = createWatcher(pi, ctx, "refs/heads/main", delivery);
  t.after(() => watcher.stop());
  await watcher.tick();
  await watcher.tick();
  assert.equal(queued.length, 1);
  assert.ok(warnings.some((message) => message.includes("Pi delivery outcome is unknown")));
  const repo = await repository(f.b), key = sessionKey(repo, { adapter: "pi", session: manager.getSessionId() }, "refs/heads/main");
  const receipt = join(repo.directory, "receipts", key, `${event.id}.json`);
  assert.equal(await readJson(receipt), undefined);
  manager.appendCustomMessageEntry(WATCH_MESSAGE, queued[0].content, true, queued[0].details);
  await watcher.tick();
  assert.equal((await readJson(receipt) as { status: string }).status, "delivered");
  assert.equal(queued.length, 1);
});

test("pi does not acknowledge an in-memory entry when native persistence fails", { skip: process.platform === "win32" }, async (t) => {
  const f = await fixture(t);
  const manager = SessionManager.create(f.b, join(f.root, "pi-history"));
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "baseline" }], timestamp: Date.now() });
  const file = manager.getSessionFile()!;
  const queued: string[] = [];
  const warnings: string[] = [];
  let failedMessage: any;
  let failures = 0;
  const watcher = createWatcher({
    sendMessage(message: any) {
      failedMessage = message;
      queued.push(...message.details.eventIds);
      try { manager.appendCustomMessageEntry(WATCH_MESSAGE, message.content, true, message.details); }
      catch (error) { assert.equal((error as NodeJS.ErrnoException).code, "EACCES"); failures++; }
    },
  } as unknown as ExtensionAPI, {
    cwd: f.b, hasPendingMessages: () => false, isIdle: () => true, sessionManager: manager, ui: { notify(message: string) { warnings.push(message); } },
  } as unknown as ExtensionContext, "refs/heads/main");
  t.after(() => watcher.stop());
  await watcher.tick();
  const events = [];
  for (let i = 0; i < 10; i++) events.push(await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: `lost-write-${i}` }));
  await chmod(file, 0o400);
  t.after(() => chmod(file, 0o600).catch(() => {}));
  await watcher.tick();
  await watcher.tick();
  await watcher.tick();
  assert.equal(failures, 1);
  assert.equal(queued.length, 8, "a broken persisted session must not accept further batches");
  assert.equal(new Set(queued).size, queued.length);
  assert.ok(warnings.some((message) => message.includes("session history is not fully persisted")));
  const repo = await repository(f.b);
  const key = sessionKey(repo, { adapter: "pi", session: manager.getSessionId() }, "refs/heads/main");
  for (const event of events) assert.equal(await readJson(join(repo.directory, "receipts", key, `${event.id}.json`)), undefined);
  assert.ok(!(await readFile(file, "utf8")).includes("lost-write-"));
  await watcher.stop();
  await chmod(file, 0o600);
  const resumed = SessionManager.open(file);
  const delivered: string[] = [];
  const recoveryWarnings: string[] = [];
  const recovery = createWatcher({
    sendMessage(message: any) {
      delivered.push(...message.details.eventIds);
      resumed.appendCustomMessageEntry(WATCH_MESSAGE, message.content, true, message.details);
    },
  } as unknown as ExtensionAPI, {
    cwd: f.b, hasPendingMessages: () => false, isIdle: () => true, sessionManager: resumed, ui: { notify(message: string) { recoveryWarnings.push(message); } },
  } as unknown as ExtensionContext, "refs/heads/main");
  t.after(() => recovery.stop());
  await recovery.tick();
  assert.deepEqual(delivered, []);
  assert.ok(recoveryWarnings.some((message) => message.includes("Pi delivery outcome is unknown")));
  resumed.appendCustomMessageEntry(WATCH_MESSAGE, failedMessage.content, true, failedMessage.details);
  for (let i = 0; i < 4; i++) await recovery.tick();
  assert.deepEqual(new Set(delivered), new Set(events.filter((event) => !queued.includes(event.id)).map((event) => event.id)));
  assert.equal(delivered.length, events.length - queued.length);
  for (const event of events) assert.equal((await readJson(join(repo.directory, "receipts", key, `${event.id}.json`)) as { status: string }).status, "delivered");
});

test("pi waits for a first session flush, validates its parent chain and retries a truncated file", async (t) => {
  const f = await fixture(t);
  const manager = SessionManager.create(f.b, join(f.root, "pi-history"));
  const queued: string[] = [];
  const warnings: string[] = [];
  const watcher = createWatcher({
    sendMessage(message: any) {
      queued.push(...message.details.eventIds);
      manager.appendCustomMessageEntry(WATCH_MESSAGE, message.content, true, message.details);
    },
  } as unknown as ExtensionAPI, {
    cwd: f.b, hasPendingMessages: () => false, isIdle: () => true, sessionManager: manager,
    ui: { notify(message: string) { warnings.push(message); } },
  } as unknown as ExtensionContext, "refs/heads/main");
  t.after(() => watcher.stop());
  await watcher.tick();
  const event = await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: "unflushed" });
  await watcher.tick();
  await watcher.tick();
  assert.deepEqual(queued, [event.id]);
  const repo = await repository(f.b);
  const key = sessionKey(repo, { adapter: "pi", session: manager.getSessionId() }, "refs/heads/main");
  const receipt = join(repo.directory, "receipts", key, `${event.id}.json`);
  assert.equal(await readJson(receipt), undefined);
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "flush" }], timestamp: Date.now() });
  const file = manager.getSessionFile()!;
  const original = await readFile(file, "utf8");
  await writeFile(file, `\n  \n${original.replace("\n", "\n  \n")}`);
  assert.equal(SessionManager.open(file).getSessionId(), manager.getSessionId());
  await watcher.tick();
  assert.equal((await readJson(receipt) as { status: string }).status, "delivered");
  await rm(receipt);
  const lines = original.trimEnd().split("\n");
  const record = JSON.parse(lines[1]);
  record.content = "different content";
  lines[1] = JSON.stringify(record);
  await writeFile(file, `${lines.join("\n")}\n`);
  await watcher.tick();
  assert.equal(await readJson(receipt), undefined, "a mismatched payload is not durable acknowledgement");
  Object.assign(record, JSON.parse(original.trimEnd().split("\n")[1]));
  record.parentId = "invalid-parent";
  lines[1] = JSON.stringify(record);
  await writeFile(file, `${lines.join("\n")}\n`);
  await watcher.tick();
  assert.equal(await readJson(receipt), undefined, "an entry with a mismatched parent is not durable acknowledgement");
  await writeFile(file, original.slice(0, -5));
  await watcher.tick();
  assert.equal(await readJson(receipt), undefined);
  assert.ok(warnings.length > 0);
  await writeFile(file, original);
  await watcher.tick();
  assert.equal((await readJson(receipt) as { status: string }).status, "delivered");
  assert.deepEqual(queued, [event.id]);
});

test("pi volatile sessions can receive more than one batch without false receipts", async (t) => {
  const f = await fixture(t);
  const manager = SessionManager.inMemory(f.b);
  const queued: string[] = [];
  const watcher = createWatcher({
    sendMessage(message: any) {
      queued.push(...message.details.eventIds);
      manager.appendCustomMessageEntry(WATCH_MESSAGE, message.content, true, message.details);
    },
  } as unknown as ExtensionAPI, {
    cwd: f.b, hasPendingMessages: () => false, isIdle: () => true, sessionManager: manager, ui: { notify() {} },
  } as unknown as ExtensionContext, "refs/heads/main");
  t.after(() => watcher.stop());
  await watcher.tick();
  const events = [];
  for (let i = 0; i < 10; i++) events.push(await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: `volatile-${i}` }));
  for (let i = 0; i < 3; i++) await watcher.tick();
  assert.deepEqual(new Set(queued), new Set(events.map((event) => event.id)));
  assert.equal(queued.length, events.length);
  const repo = await repository(f.b);
  const key = sessionKey(repo, { adapter: "pi", session: manager.getSessionId() }, "refs/heads/main");
  for (const event of events) assert.equal(await readJson(join(repo.directory, "receipts", key, `${event.id}.json`)), undefined);
});

test("pi detects an orphaned native parent after a failed write and restart", { skip: process.platform === "win32" }, async (t) => {
  const f = await fixture(t);
  const manager = SessionManager.create(f.b, join(f.root, "pi-history"));
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "baseline" }], timestamp: Date.now() });
  const file = manager.getSessionFile()!;
  const warnings: string[] = [];
  const watcher = createWatcher({
    sendMessage(message: any) {
      try { manager.appendCustomMessageEntry(WATCH_MESSAGE, message.content, true, message.details); }
      catch (error) { assert.equal((error as NodeJS.ErrnoException).code, "EACCES"); }
    },
  } as unknown as ExtensionAPI, {
    cwd: f.b, hasPendingMessages: () => false, isIdle: () => true, sessionManager: manager,
    ui: { notify(message: string) { warnings.push(message); } },
  } as unknown as ExtensionContext, "refs/heads/main");
  t.after(() => watcher.stop());
  t.after(() => chmod(file, 0o600).catch(() => {}));
  await watcher.tick();
  const first = await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: "missing-parent" });
  await chmod(file, 0o400);
  await watcher.tick();
  await chmod(file, 0o600);
  const second = await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: "orphan" });
  manager.appendCustomMessageEntry(WATCH_MESSAGE, "orphan", true, { eventIds: [second.id] });
  await watcher.tick();
  assert.ok(warnings.some((message) => message.includes("not fully persisted")));
  const repo = await repository(f.b);
  const key = sessionKey(repo, { adapter: "pi", session: manager.getSessionId() }, "refs/heads/main");
  for (const event of [first, second]) assert.equal(await readJson(join(repo.directory, "receipts", key, `${event.id}.json`)), undefined);
  await watcher.stop();
  const resumed = SessionManager.open(file);
  const resumedWarnings: string[] = [];
  let sent = 0;
  const recovery = createWatcher({ sendMessage() { sent++; } } as unknown as ExtensionAPI, {
    cwd: f.b, hasPendingMessages: () => false, isIdle: () => true, sessionManager: resumed,
    ui: { notify(message: string) { resumedWarnings.push(message); } },
  } as unknown as ExtensionContext, "refs/heads/main");
  t.after(() => recovery.stop());
  await recovery.tick();
  assert.equal(sent, 0);
  assert.ok(resumedWarnings.some((message) => message.includes("missing parent")));
  for (const event of [first, second]) assert.equal(await readJson(join(repo.directory, "receipts", key, `${event.id}.json`)), undefined);
});

test("pi never acknowledges or queues an old session's event after a session switch", async (t) => {
  const f = await fixture(t);
  const manager = SessionManager.create(f.b, join(f.root, "pi-history"));
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "baseline" }], timestamp: Date.now() });
  let sent = 0;
  const warnings: string[] = [];
  const watcher = createWatcher({ sendMessage() { sent++; } } as unknown as ExtensionAPI, {
    cwd: f.b, hasPendingMessages: () => false, isIdle: () => true, sessionManager: manager,
    ui: { notify(message: string) { warnings.push(message); } },
  } as unknown as ExtensionContext, "refs/heads/main");
  t.after(() => watcher.stop());
  await watcher.tick();
  const event = await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: "old-session" });
  const session = manager.getSessionId();
  const original = manager.getSessionId.bind(manager);
  let calls = 0;
  manager.getSessionId = () => ++calls === 1 ? session : "other-session";
  await watcher.tick();
  const repo = await repository(f.b);
  const key = sessionKey(repo, { adapter: "pi", session }, "refs/heads/main");
  assert.equal(await readJson(join(repo.directory, "receipts", key, `${event.id}.json`)), undefined);
  assert.equal(sent, 0);
  assert.ok(warnings.some((message) => message.includes("session changed")));
  manager.getSessionId = original;
  await watcher.tick();
  assert.equal(sent, 1);
});

test("pi rechecks native session identity immediately before confirming delivery", async (t) => {
  const f = await fixture(t);
  const manager = SessionManager.create(f.b, join(f.root, "pi-history"));
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "baseline" }], timestamp: Date.now() });
  const file = manager.getSessionFile()!;
  const before = await readFile(file, "utf8");
  const warnings: string[] = [];
  const watcher = createWatcher({
    sendMessage(message: any) { manager.appendCustomMessageEntry(WATCH_MESSAGE, message.content, true, message.details); },
  } as unknown as ExtensionAPI, {
    cwd: f.b, hasPendingMessages: () => false, isIdle: () => true, sessionManager: manager,
    ui: { notify(message: string) { warnings.push(message); } },
  } as unknown as ExtensionContext, "refs/heads/main");
  t.after(() => watcher.stop());
  await watcher.tick();
  const event = await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: "native-replaced" });
  await watcher.tick();
  const persisted = await readFile(file, "utf8");
  const original = manager.getLeafId.bind(manager);
  let swapped = false;
  manager.getLeafId = () => {
    if (!swapped) {
      const temporary = `${file}.replacement`;
      writeFileSync(temporary, before);
      renameSync(temporary, file);
      swapped = true;
    }
    return original();
  };
  await watcher.tick();
  const repo = await repository(f.b);
  const key = sessionKey(repo, { adapter: "pi", session: manager.getSessionId() }, "refs/heads/main");
  const receipt = join(repo.directory, "receipts", key, `${event.id}.json`);
  assert.equal(await readJson(receipt), undefined);
  assert.ok(warnings.some((message) => message.includes("changed before delivery confirmation")));
  manager.getLeafId = original;
  await writeFile(file, persisted);
  await watcher.tick();
  assert.equal((await readJson(receipt) as { status: string }).status, "delivered");
});
