import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createWatcher, WATCH_MESSAGE } from "../../src/adapters/pi/watch.ts";
import { fixture } from "../helpers.ts";
import { sendMessage } from "../../src/core/mailbox.ts";

test("pi injects a follow-up, does not checkpoint an unpersisted queue, resumes without duplicates", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.b, "shared.txt"), "local\n");
  const entries: any[] = [];
  const messages: any[] = [];
  const warnings: string[] = [];
  const pi = {
    appendEntry(customType: string, data: unknown) { entries.push({ type: "custom", customType, data }); },
    sendMessage(message: unknown, options: unknown) { messages.push({ message, options }); },
  } as unknown as ExtensionAPI;
  const ctx = {
    cwd: f.b, sessionManager: { getBranch: () => entries, getSessionId: () => "pi-B" },
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
  await watcher.stop();
  watcher = createWatcher(pi, ctx, "refs/heads/main");
  await watcher.tick(); // Lost queued message is re-detected; the checkpoint was not advanced.
  assert.equal(messages.length, 2);
  entries.push({ type: "custom_message", ...messages[1].message });
  await watcher.stop();
  watcher = createWatcher(pi, ctx, "refs/heads/main");
  await watcher.tick();
  assert.equal(messages.length, 2);
  const sent = await sendMessage({ cwd: f.a, adapter: "claude-code", session: "CC-A", text: "来自 Claude Code 的协调消息" });
  await watcher.tick();
  assert.equal(messages.length, 3);
  assert.ok(messages[2].message.content.includes("来自 Claude Code"));
  assert.deepEqual(messages[2].message.details.eventIds, [sent.id]);
  entries.push({ type: "custom_message", ...messages[2].message });
  await watcher.tick();
  assert.equal(messages.length, 3);
  await watcher.stop();
  await f.commit(f.main, "shared.txt", "after stop\n");
  await watcher.tick();
  assert.equal(messages.length, 3);
  assert.deepEqual(warnings, []);
});
