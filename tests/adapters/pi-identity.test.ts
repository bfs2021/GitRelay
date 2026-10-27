import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { SessionManager, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { piIdentity } from "../../src/adapters/pi/identity.ts";
import { createWatcher } from "../../src/adapters/pi/watch.ts";
import { readReceipt, sendMessage, sessionKey } from "../../src/core/mailbox.ts";
import { repository } from "../../src/core/store.ts";
import { fixture } from "../helpers.ts";

test("pi cannot deliver an old inbox to a different native history with the same ID", async (t) => {
  const f = await fixture(t), ref = "refs/heads/main";
  const managers = ["old", "new"].map((name) => {
    const manager = SessionManager.create(f.b, join(f.root, name), { id: "same-native-id" });
    manager.appendMessage({ role: "user", content: [{ type: "text", text: "baseline" }], timestamp: Date.now() });
    return manager;
  });
  const messages: unknown[][] = [[], []];
  const watchers = managers.map((manager, i) => createWatcher({ sendMessage(message: unknown) { messages[i].push(message); } } as ExtensionAPI, {
    cwd: f.b, sessionManager: manager, isIdle: () => true, hasPendingMessages: () => false,
    ui: { notify() {} },
  } as unknown as ExtensionContext, ref));
  t.after(async () => { await Promise.all(watchers.map((watcher) => watcher.stop())); });
  await watchers[0].tick();
  const old = await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: "old private context" });
  await watchers[1].tick();
  assert.deepEqual(messages[1], []);
  const repo = await repository(f.b), key = sessionKey(repo, piIdentity(managers[0]), ref);
  assert.equal(await readReceipt(repo, key, old.id), undefined);
  const fresh = await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: "new shared context" });
  await watchers[1].tick();
  assert.equal(messages[1].length, 1);
  assert.match(JSON.stringify(messages[1]), new RegExp(fresh.id));
  assert.ok(!JSON.stringify(messages[1]).includes(old.id));
  const resumed = SessionManager.open(managers[0].getSessionFile()!);
  assert.deepEqual(piIdentity(resumed), piIdentity(managers[0]));
});
