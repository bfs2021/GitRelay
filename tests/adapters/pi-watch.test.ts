import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createWatcher, WATCH_MESSAGE } from "../../src/adapters/pi/watch.ts";
import { fixture } from "../helpers.ts";
import { eventsIn, sendMessage, sessionKey } from "../../src/core/mailbox.ts";
import { readJson, repository } from "../../src/core/store.ts";

test("pi refreshes native acknowledgements when the branch advances during a scan or rewinds", async (t) => {
  const f = await fixture(t);
  const manager = SessionManager.inMemory(f.b);
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
  const leaf = manager.appendCustomMessageEntry(WATCH_MESSAGE, "accepted", false, { eventIds: [first.id] });
  const getLeafId = manager.getLeafId.bind(manager);
  let calls = 0;
  manager.getLeafId = () => {
    if (++calls === 2) manager.appendCustomMessageEntry(WATCH_MESSAGE, "accepted during scan", false, { eventIds: [second.id] });
    return getLeafId();
  };
  await watcher.tick();
  assert.equal(messages.length, 0);
  assert.deepEqual(warnings, []);
  const key = sessionKey(repo, { adapter: "pi", session: manager.getSessionId() }, "refs/heads/main");
  for (const event of [first, second]) assert.equal((await readJson(join(repo.directory, "receipts", key, `${event.id}.json`)) as { status: string }).status, "delivered");
  manager.branch(leaf);
  await rm(join(repo.directory, "receipts", key, `${second.id}.json`));
  await watcher.tick();
  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0].details.eventIds, [second.id]);
  assert.deepEqual(warnings, []);
});

test("pi injects a follow-up, does not checkpoint an unpersisted queue, resumes without duplicates", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.b, "shared.txt"), "local\n");
  const entries: any[] = [];
  const messages: any[] = [];
  const warnings: string[] = [];
  let busy = false;
  const pi = {
    appendEntry(customType: string, data: unknown) { entries.push({ type: "custom", customType, data }); },
    sendMessage(message: unknown, options: unknown) { messages.push({ message, options }); busy = true; },
  } as unknown as ExtensionAPI;
  const ctx = {
    // Pi only counts queued user inputs here, not custom follow-ups.
    cwd: f.b, hasPendingMessages: () => false, isIdle: () => !busy, sessionManager: { getBranch: () => entries, getSessionId: () => "pi-B", getLeafId: () => String(entries.length) },
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
  busy = false; // Esc discarded the follow-up and the host settled; keep the same watcher.
  await watcher.tick(); // Lost queued message is re-detected without a reload.
  assert.equal(messages.length, 2);
  entries.push({ type: "custom_message", ...messages[1].message });
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
  entries.push({ type: "custom_message", ...messages[2].message });
  busy = false;
  await watcher.tick();
  assert.equal(messages.length, 3);
  await watcher.stop();
  await f.commit(f.main, "shared.txt", "after stop\n");
  await watcher.tick();
  assert.equal(messages.length, 3);
  assert.deepEqual(warnings, []);
});
