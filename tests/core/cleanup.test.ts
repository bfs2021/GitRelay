import assert from "node:assert/strict";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { collectGarbage } from "../../src/core/cleanup.ts";
import { consumeMailbox } from "../../src/core/consumer.ts";
import { eventsIn, listSessions, sendMessage, sessionKey } from "../../src/core/mailbox.ts";
import { hash, readJson, repository, withLock, writeJson } from "../../src/core/store.ts";
import { fixture } from "../helpers.ts";

const ref = "refs/heads/main";
const receiver = (cwd: string, session: string) => ({ cwd, ref, adapter: "codex", session, async deliver() {} });

test("GC previews by default, keeps any unconfirmed recipient, and only removes event/receipts", async (t) => {
  const f = await fixture(t);
  const b = receiver(f.b, "B");
  const c = receiver(f.c, "C");
  await consumeMailbox(b);
  await consumeMailbox(c);
  const event = await sendMessage({ cwd: f.a, adapter: "cc", session: "A", text: "broadcast" });
  await consumeMailbox(b);
  const partial = await collectGarbage(f.a, { apply: true, retentionDays: 0 });
  assert.ok(partial.kept.some((item) => item.id === event.id && item.reason === "unconfirmed"));
  await consumeMailbox(c);
  const repo = await repository(f.a);
  const sessions = await listSessions(f.a);
  const refBefore = await readJson(join(repo.directory, "refs", `${hash(ref)}.json`));
  const preview = await collectGarbage(f.a, { retentionDays: 0 });
  assert.equal(preview.dryRun, true);
  assert.deepEqual(preview.eligible, [event.id]);
  assert.equal((await eventsIn(repo)).length, 1);
  const applied = await collectGarbage(f.a, { apply: true, retentionDays: 0 });
  assert.deepEqual(applied.removed, [event.id]);
  assert.equal((await eventsIn(repo)).length, 0);
  for (const key of event.recipients) assert.equal(await readJson(join(repo.directory, "receipts", key, `${event.id}.json`)), undefined);
  assert.deepEqual(await listSessions(f.a), sessions);
  assert.deepEqual(await readJson(join(repo.directory, "refs", `${hash(ref)}.json`)), refBefore);
  assert.deepEqual((await collectGarbage(f.a, { apply: true, retentionDays: 0 })).removed, []);
});

test("retention starts after the latest confirmation, not merely an old event timestamp", async (t) => {
  const f = await fixture(t);
  const b = receiver(f.b, "B");
  await consumeMailbox(b);
  const event = await sendMessage({ cwd: f.a, adapter: "cc", session: "A", text: "old event, recent delivery" });
  await consumeMailbox(b);
  const repo = await repository(f.b);
  const eventPath = join(repo.directory, "events", `${event.id}.json`);
  const receiptPath = join(repo.directory, "receipts", event.recipients[0], `${event.id}.json`);
  const old = new Date(Date.now() - 8 * 86_400_000).toISOString();
  await writeJson(eventPath, { ...event, createdAt: old });
  assert.ok((await collectGarbage(f.b, { apply: true })).kept.some((item) => item.reason === "retention"));
  const receipt = await readJson(receiptPath) as object;
  await writeJson(receiptPath, { ...receipt, at: old });
  assert.deepEqual((await collectGarbage(f.b, { apply: true })).removed, [event.id]);
  await assert.rejects(collectGarbage(f.b, { retentionDays: -1 }), /retention-days/);
  await assert.rejects(collectGarbage(f.b, { retentionDays: Infinity }), /retention-days/);
});

test("GC skips a busy consumer instead of deleting a cached event or deadlocking", async (t) => {
  const f = await fixture(t);
  const b = receiver(f.b, "B");
  await consumeMailbox(b);
  const event = await sendMessage({ cwd: f.a, adapter: "cc", session: "A", text: "confirmed" });
  await consumeMailbox(b);
  const repo = await repository(f.b);
  await withLock(join(repo.directory, "sessions", `${event.recipients[0]}.lock`), async () => {
    const report = await collectGarbage(f.b, { apply: true, retentionDays: 0 });
    assert.ok(report.kept.some((item) => item.id === event.id && item.reason === "busy"));
    assert.equal((await eventsIn(repo)).length, 1);
  });
  assert.deepEqual((await collectGarbage(f.b, { apply: true, retentionDays: 0 })).removed, [event.id]);
});

test("GC resumes its committed trash journal after a partial deletion", async (t) => {
  const f = await fixture(t);
  const b = receiver(f.b, "B");
  const c = receiver(f.c, "C");
  await consumeMailbox(b);
  await consumeMailbox(c);
  const event = await sendMessage({ cwd: f.a, adapter: "cc", session: "A", text: "fully confirmed" });
  await consumeMailbox(b);
  await consumeMailbox(c);
  const repo = await repository(f.b);
  await rename(join(repo.directory, "events", `${event.id}.json`), join(repo.directory, "trash", `${event.id}.json`));
  await rm(join(repo.directory, "receipts", event.recipients[0], `${event.id}.json`));
  const preview = await collectGarbage(f.b);
  assert.deepEqual(preview.eligible, [event.id]);
  assert.deepEqual((await collectGarbage(f.b, { apply: true })).removed, [event.id]);
  assert.equal(await readJson(join(repo.directory, "trash", `${event.id}.json`)), undefined);
  for (const key of event.recipients) assert.equal(await readJson(join(repo.directory, "receipts", key, `${event.id}.json`)), undefined);
});

test("GC fails closed on malformed receipts and honors cancellation", async (t) => {
  const f = await fixture(t);
  const b = receiver(f.b, "B");
  await consumeMailbox(b);
  const event = await sendMessage({ cwd: f.a, adapter: "cc", session: "A", text: "must survive" });
  await consumeMailbox(b);
  const repo = await repository(f.b);
  await writeJson(join(repo.directory, "receipts", event.recipients[0], `${event.id}.json`), { eventId: event.id, status: "unknown", at: new Date().toISOString() });
  await assert.rejects(collectGarbage(f.b, { apply: true, retentionDays: 0 }), /Invalid receipt/);
  await assert.rejects(collectGarbage(f.b, { apply: true, retentionDays: 0, signal: AbortSignal.abort() }), /abort/i);
  assert.equal((await eventsIn(repo)).length, 1);
});

test("migrated legacy events do not resurrect after cleanup, and unmigrated old sessions are protected", async (t) => {
  const f = await fixture(t);
  const b = receiver(f.b, "legacy");
  const repo = await repository(f.b);
  const key = sessionKey(repo, b, ref);
  await mkdir(join(repo.common, "worktree-agent-sync"));
  await writeJson(join(repo.common, "worktree-agent-sync", `${key}.json`), { root: f.b, ref, commit: f.initial });
  await writeFile(join(f.b, "shared.txt"), "local\n");
  await f.commit(f.main, "shared.txt", "upstream\n");
  await consumeMailbox(b);
  const migration = (await eventsIn(repo))[0];
  const event = await sendMessage({ cwd: f.a, adapter: "cc", session: "A", text: "legacy participant" });
  await consumeMailbox(b);
  const sessionPath = join(repo.directory, "sessions", `${key}.json`);
  const session = JSON.parse(await readFile(sessionPath, "utf8"));
  await writeJson(sessionPath, { ...session, migrated: undefined });
  assert.ok((await collectGarbage(f.b, { apply: true, retentionDays: 0 })).kept.some((item) => item.reason === "migration"));
  await consumeMailbox(b);
  assert.deepEqual(new Set((await collectGarbage(f.b, { apply: true, retentionDays: 0 })).removed), new Set([event.id, migration.id]));
  await consumeMailbox(b);
  assert.equal((await eventsIn(repo)).length, 0);
});
