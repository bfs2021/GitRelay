import assert from "node:assert/strict";
import { readFile, stat, utimes } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { consumeMailbox } from "../../src/core/consumer.ts";
import { collectGarbage } from "../../src/core/cleanup.ts";
import { sendMessage, sessionKey } from "../../src/core/mailbox.ts";
import { BusyError, repository, withLock } from "../../src/core/store.ts";
import { fixture } from "../helpers.ts";

const ref = "refs/heads/main";

test("publish contention waits for send and GC instead of dropping an operation", async (t) => {
  const f = await fixture(t);
  const repo = await repository(f.b);
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const holder = withLock(join(repo.directory, "publish.lock"), async () => { entered.resolve(); await release.promise; });
  t.after(() => { release.resolve(); });
  await entered.promise;
  const sent = sendMessage({ cwd: f.a, adapter: "cli", session: "A", text: "wait for publication" });
  const gc = collectGarbage(f.b);
  // Give both requests time to observe the occupied lock.
  await new Promise((resolve) => setTimeout(resolve, 100));
  release.resolve();
  await holder;
  await Promise.all([sent, gc]);
  assert.equal(await stat(join(repo.directory, "publish.lock")).catch(() => undefined), undefined);
});

test("lock waits are cancellable and time out visibly without stealing the owner lock", async (t) => {
  const f = await fixture(t);
  const path = join(f.root, "test.lock");
  await withLock(path, async () => {
    const before = await readFile(path, "utf8");
    await assert.rejects(withLock(path, async () => assert.fail("must not acquire"), { waitMs: 1000, signal: AbortSignal.timeout(30) }), /abort/i);
    await assert.rejects(withLock(path, async () => assert.fail("must not acquire"), { waitMs: 30 }), (error: unknown) => error instanceof Error && !(error instanceof BusyError) && /PID reused|PID.*reused/.test(error.message));
    assert.equal(await readFile(path, "utf8"), before);
  });
  assert.equal(await stat(path).catch(() => undefined), undefined);
});

test("long-held session locks with live or reused PIDs no longer silently skip delivery", async (t) => {
  const f = await fixture(t);
  const receiver = { cwd: f.b, ref, adapter: "test", session: "B", async deliver() {} };
  await consumeMailbox(receiver);
  const repo = await repository(f.b);
  const path = join(repo.directory, "sessions", `${sessionKey(repo, receiver, ref)}.lock`);
  await withLock(path, async () => {
    const old = new Date(Date.now() - 61_000);
    await utimes(path, old, old);
    await assert.rejects(consumeMailbox(receiver), /lock remains busy.*PID/);
    assert.ok(await stat(path));
  });
});
