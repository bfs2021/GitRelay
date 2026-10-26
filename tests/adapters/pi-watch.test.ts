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
  let busy = false;
  const pi = {
    appendEntry(customType: string, data: unknown) { entries.push({ type: "custom", customType, data }); },
    sendMessage(message: unknown, options: unknown) { messages.push({ message, options }); busy = true; },
  } as unknown as ExtensionAPI;
  const ctx = {
    // Pi only counts queued user inputs here, not custom follow-ups.
    cwd: f.b, hasPendingMessages: () => false, isIdle: () => !busy, sessionManager: { getBranch: () => entries, getSessionId: () => "pi-B" },
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
