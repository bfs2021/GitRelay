import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { SessionManager, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createWatcher, WATCH_MESSAGE } from "../../src/adapters/pi/watch.ts";
import { sendMessage, sessionKey } from "../../src/core/mailbox.ts";
import { readJson, repository } from "../../src/core/store.ts";
import { fixture } from "../helpers.ts";

for (const [name, tail] of [
  ["partial JSON", '{"type":"custom","id":"partial'],
  ["valid JSON without a newline", JSON.stringify({ type: "custom", id: "extraneous", parentId: null })],
] as const) {
  test(`pi preserves an active session with ${name} and retries only after repair`, async (t) => {
    const f = await fixture(t), manager = SessionManager.create(f.b, join(f.root, "pi-history"));
    manager.appendMessage({ role: "user", content: [{ type: "text", text: "baseline" }], timestamp: Date.now() });
    const file = manager.getSessionFile()!, warnings: string[] = [], queued: unknown[] = [];
    const watcher = createWatcher({ sendMessage(message: any) {
      queued.push(message);
      manager.appendCustomMessageEntry(WATCH_MESSAGE, message.content, true, message.details);
    } } as unknown as ExtensionAPI, {
      cwd: f.b, sessionManager: manager, hasPendingMessages: () => false, isIdle: () => true,
      ui: { notify(value: string) { warnings.push(value); } },
    } as unknown as ExtensionContext, "refs/heads/main");
    t.after(() => watcher.stop());
    await watcher.tick();
    const event = await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: "marked event" });
    await appendFile(file, tail);
    const corrupted = await readFile(file);
    await watcher.tick();
    const repo = await repository(f.b), key = sessionKey(repo, { adapter: "pi", session: manager.getSessionId() }, "refs/heads/main");
    assert.deepEqual(await readFile(file), corrupted);
    assert.equal(queued.length, 0);
    assert.equal(await readJson(join(repo.directory, "receipts", key, `${event.id}.json`)), undefined);
    assert.ok(warnings.some((w) => w.includes("incomplete final line")));
    await appendFile(file, "\n");
    await watcher.tick();
    await watcher.tick();
    assert.equal(queued.length, 1);
    assert.equal((await readJson(join(repo.directory, "receipts", key, `${event.id}.json`)) as { status: string }).status, "delivered");
    await watcher.tick();
    assert.equal(queued.length, 1);
  });
}

test("complete malformed line with newline does not block pi", async (t) => {
  const f = await fixture(t), manager = SessionManager.create(f.b, join(f.root, "pi-history"));
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "baseline" }], timestamp: Date.now() });
  const file = manager.getSessionFile()!, warnings: string[] = [], queued: unknown[] = [];
  const watcher = createWatcher({ sendMessage(message: any) {
    queued.push(message); manager.appendCustomMessageEntry(WATCH_MESSAGE, message.content, true, message.details);
  } } as unknown as ExtensionAPI, {
    cwd: f.b, sessionManager: manager, hasPendingMessages: () => false, isIdle: () => true,
    ui: { notify(value: string) { warnings.push(value); } },
  } as unknown as ExtensionContext, "refs/heads/main");
  t.after(() => watcher.stop());
  await watcher.tick();
  await appendFile(file, "{malformed}\n");
  const event = await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: "marked event" });
  await watcher.tick(); await watcher.tick();
  const repo = await repository(f.b), key = sessionKey(repo, { adapter: "pi", session: manager.getSessionId() }, "refs/heads/main");
  assert.equal(queued.length, 1);
  assert.equal((await readJson(join(repo.directory, "receipts", key, `${event.id}.json`)) as { status: string }).status, "delivered");
  assert.deepEqual(warnings, []);
  assert.ok((await readFile(file, "utf8")).includes("{malformed}\n"));
});

test("pi keeps UTF-8 decoding across the 64 KiB stream boundary", async (t) => {
  const f = await fixture(t);
  let manager = SessionManager.create(f.b, join(f.root, "pi-history"));
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "baseline" }], timestamp: Date.now() });
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "long-prefix🙂" }], timestamp: Date.now() });
  const file = manager.getSessionFile()!;
  let content = await readFile(file, "utf8");
  const index = Buffer.from(content).indexOf(Buffer.from("🙂"));
  const pad = (65535 - index + 65536) % 65536;
  content = content.replace("long-prefix", `long-prefix${"x".repeat(pad)}`);
  await writeFile(file, content);
  assert.equal(Buffer.from(content).indexOf(Buffer.from("🙂")) % 65536, 65535);
  manager = SessionManager.open(file);
  const warnings: string[] = [], queued: unknown[] = [];
  const watcher = createWatcher({ sendMessage(message: any) {
    queued.push(message); manager.appendCustomMessageEntry(WATCH_MESSAGE, message.content, true, message.details);
  } } as unknown as ExtensionAPI, {
    cwd: f.b, sessionManager: manager, hasPendingMessages: () => false, isIdle: () => true,
    ui: { notify(value: string) { warnings.push(value); } },
  } as unknown as ExtensionContext, "refs/heads/main");
  t.after(() => watcher.stop());
  await watcher.tick();
  const event = await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: "marked event" });
  await watcher.tick(); await watcher.tick();
  const repo = await repository(f.b), key = sessionKey(repo, { adapter: "pi", session: manager.getSessionId() }, "refs/heads/main");
  assert.equal(queued.length, 1);
  assert.equal((await readJson(join(repo.directory, "receipts", key, `${event.id}.json`)) as { status: string }).status, "delivered");
  assert.deepEqual(warnings, []);
});

for (const phase of ["send", "confirm"] as const) {
  test(`pi rejects an unterminated tail introduced during ${phase}`, async (t) => {
    const f = await fixture(t), manager = SessionManager.create(f.b, join(f.root, "pi-history"));
    manager.appendMessage({ role: "user", content: [{ type: "text", text: "baseline" }], timestamp: Date.now() });
    const file = manager.getSessionFile()!, warnings: string[] = [], queued: any[] = [];
    const watcher = createWatcher({ sendMessage(message: any) { queued.push(message); } } as unknown as ExtensionAPI, {
      cwd: f.b, sessionManager: manager, hasPendingMessages: () => false, isIdle: () => true,
      ui: { notify(value: string) { warnings.push(value); } },
    } as unknown as ExtensionContext, "refs/heads/main");
    t.after(() => watcher.stop());
    await watcher.tick();
    const event = await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: "marked event" });
    if (phase === "confirm") {
      await watcher.tick();
      assert.equal(queued.length, 1);
      manager.appendCustomMessageEntry(WATCH_MESSAGE, queued[0].content, true, queued[0].details);
    }
    let injected = false;
    const origLink = fs.promises.link, origOpen = fs.promises.open;
    const patch = phase === "send"
      ? t.mock.method(fs.promises, "link", async (...args: Parameters<typeof origLink>) => {
          await origLink(...args);
          if (String(args[1]).endsWith(".pi-proof") && !injected) { injected = true; await appendFile(file, '{"partial'); }
        })
      : t.mock.method(fs.promises, "open", async (...args: Parameters<typeof origOpen>) => {
          const handle = await origOpen(...args);
          if (String(args[0]).endsWith(".pi-proof") && !injected) { injected = true; await appendFile(file, '{"partial'); }
          return handle;
        });
    syncBuiltinESMExports();
    try { await watcher.tick(); }
    finally { patch.mock.restore(); syncBuiltinESMExports(); }
    assert.ok(injected);
    assert.equal(queued.length, phase === "send" ? 0 : 1);
    assert.ok(warnings.some((warning) => warning.includes(`changed before delivery${phase === "confirm" ? " confirmation" : ""}`)), warnings.join("\n"));
    const repo = await repository(f.b), key = sessionKey(repo, { adapter: "pi", session: manager.getSessionId() }, "refs/heads/main");
    assert.equal(await readJson(join(repo.directory, "receipts", key, `${event.id}.json`)), undefined);
    assert.ok((await readFile(file, "utf8")).endsWith('{"partial'));
  });
}

test("pi keeps a persisted message unconfirmed when its final newline is missing", async (t) => {
  const f = await fixture(t), manager = SessionManager.create(f.b, join(f.root, "pi-history"));
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "baseline" }], timestamp: Date.now() });
  const file = manager.getSessionFile()!, warnings: string[] = [], queued: any[] = [];
  const watcher = createWatcher({ sendMessage(message: any) { queued.push(message); } } as unknown as ExtensionAPI, {
    cwd: f.b, sessionManager: manager, hasPendingMessages: () => false, isIdle: () => true,
    ui: { notify(value: string) { warnings.push(value); } },
  } as unknown as ExtensionContext, "refs/heads/main");
  t.after(() => watcher.stop());
  await watcher.tick();
  const event = await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: "marked event" });
  await watcher.tick();
  assert.equal(queued.length, 1);
  manager.appendCustomMessageEntry(WATCH_MESSAGE, queued[0].content, true, queued[0].details);
  const complete = await readFile(file);
  assert.equal(complete.at(-1), 10);
  const partial = complete.subarray(0, -1);
  await writeFile(file, partial);
  await watcher.tick();
  const repo = await repository(f.b), key = sessionKey(repo, { adapter: "pi", session: manager.getSessionId() }, "refs/heads/main");
  assert.equal(await readJson(join(repo.directory, "receipts", key, `${event.id}.json`)), undefined);
  assert.deepEqual(await readFile(file), partial);
  assert.equal(queued.length, 1);
  assert.ok(warnings.some((w) => w.includes("incomplete final line")));
  await appendFile(file, "\n");
  await watcher.tick();
  assert.equal((await readJson(join(repo.directory, "receipts", key, `${event.id}.json`)) as { status: string }).status, "delivered");
  assert.equal(queued.length, 1);
});
