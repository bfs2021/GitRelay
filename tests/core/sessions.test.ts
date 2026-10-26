import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { consumeMailbox } from "../../src/core/consumer.ts";
import { collectGarbage } from "../../src/core/cleanup.ts";
import { listSessions, sendMessage, type Notification } from "../../src/core/mailbox.ts";
import { joinSession, leaveSession } from "../../src/core/sessions.ts";
import { repository, withLock, writeJson } from "../../src/core/store.ts";
import { fixture } from "../helpers.ts";

const ref = "refs/heads/main";

test("explicit leave excludes future messages but keeps the old inbox for an explicit rejoin", async (t) => {
  const f = await fixture(t);
  const received: string[] = [];
  const receiver = { cwd: f.b, ref, adapter: "codex", session: "B", async deliver(batch: Notification[]) { received.push(...batch.map((n) => n.event.id)); } };
  const sender = { cwd: f.a, adapter: "claude-code", session: "A" };
  await consumeMailbox(receiver);
  const pending = await sendMessage({ ...sender, text: "before leave" });
  const left = await leaveSession(receiver);
  assert.ok(left?.closedAt);
  assert.equal((await leaveSession(receiver))?.closedAt, left.closedAt);
  await consumeMailbox(receiver); // Polling must not silently re-open a closed session.
  assert.deepEqual(received, []);
  assert.equal((await sendMessage({ ...sender, text: "while closed" })).recipients.length, 0);
  assert.ok((await listSessions(f.b)).find((s) => s.session === "B")?.closedAt);
  const report = await collectGarbage(f.b, { apply: true, retentionDays: 0 });
  assert.ok(report.kept.some((entry) => entry.id === pending.id && entry.reason === "unconfirmed"));
  await assert.rejects(sendMessage({ ...receiver, text: "cannot send while closed" }), /use join/);
  await joinSession(receiver);
  await consumeMailbox(receiver);
  assert.deepEqual(received, [pending.id]);
  const next = await sendMessage({ ...sender, text: "after rejoin" });
  await consumeMailbox(receiver);
  assert.deepEqual(received, [pending.id, next.id]);
});

test("lastSeen alone does not retire an offline session, and unknown leave does not register a ghost", async (t) => {
  const f = await fixture(t);
  const receiver = { cwd: f.b, ref, adapter: "opencode", session: "B", async deliver() {} };
  await consumeMailbox(receiver);
  const repo = await repository(f.b);
  const session = (await listSessions(f.b))[0];
  await writeJson(join(repo.directory, "sessions", `${session.key}.json`), { ...session, lastSeen: "2000-01-01T00:00:00.000Z" });
  assert.equal((await sendMessage({ cwd: f.a, adapter: "cc", session: "A", text: "offline still subscribed" })).recipients.length, 1);
  assert.equal(await leaveSession({ ...receiver, session: "not-registered" }), undefined);
  assert.equal((await listSessions(f.b)).length, 1);
});

test("leave cannot race an in-flight receive and never overwrites its session lock", async (t) => {
  const f = await fixture(t);
  const receiver = { cwd: f.b, ref, adapter: "pi", session: "B", async deliver() {} };
  await consumeMailbox(receiver);
  const repo = await repository(f.b);
  const session = (await listSessions(f.b))[0];
  await withLock(join(repo.directory, "sessions", `${session.key}.lock`), async () => {
    await assert.rejects(leaveSession(receiver), /busy/);
    assert.equal((await listSessions(f.b))[0].closedAt, undefined);
  });
  assert.ok((await leaveSession(receiver))?.closedAt);
});
