import assert from "node:assert/strict";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { consumeMailbox } from "../../src/core/consumer.ts";
import { collectGarbage } from "../../src/core/cleanup.ts";
import { eventsIn, listSessions, sendMessage, sessionKey, type Notification } from "../../src/core/mailbox.ts";
import { repository } from "../../src/core/store.ts";
import { fixture, git } from "../helpers.ts";

const ref = "refs/heads/main";

test("Claude Code publishes one message; Codex and OpenCode receive independent copies", async (t) => {
  const f = await fixture(t);
  const b: Notification[] = [];
  const c: Notification[] = [];
  const codex = { cwd: f.b, ref, adapter: "codex", session: "same-native-id", async deliver(batch: Notification[]) { b.push(...batch); } };
  const opencode = { cwd: f.c, ref, adapter: "opencode", session: "same-native-id", async deliver(batch: Notification[]) { c.push(...batch); } };
  await consumeMailbox(codex);
  await consumeMailbox(opencode);
  const event = await sendMessage({ cwd: f.a, adapter: "claude-code", session: "A", text: "The interface has changed; check its callers." });
  assert.equal(event.recipients.length, 2);
  await consumeMailbox(codex);
  assert.equal(b[0].event.id, event.id);
  assert.equal(c.length, 0);
  await consumeMailbox(opencode);
  assert.equal(c[0].event.id, event.id);
  await consumeMailbox(codex);
  await consumeMailbox(opencode);
  assert.equal(b.length, 1);
  assert.equal(c.length, 1);
  const repo = await repository(f.a);
  assert.equal((await eventsIn(repo)).length, 1);
  assert.equal((await readdir(join(repo.directory, "receipts"))).length, 2);
  assert.equal((await listSessions(f.a)).length, 2);
  if (process.platform !== "win32") {
    assert.equal((await stat(repo.directory)).mode & 0o777, 0o700);
    assert.equal((await stat(join(repo.directory, "events", `${event.id}.json`))).mode & 0o777, 0o600);
  }
});

test("a shared main event is published once; one agent's failed delivery does not consume another's message", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.b, "shared.txt"), "B local\n");
  await writeFile(join(f.c, "shared.txt"), "C local\n");
  const deliveries: string[] = [];
  let fail = false;
  const a = { cwd: f.a, ref, adapter: "claude-code", session: "A", async deliver() { assert.fail("clean source should not be notified"); } };
  const b = { cwd: f.b, ref, adapter: "codex", session: "B", async deliver(batch: Notification[]) { if (fail) throw new Error("offline"); deliveries.push(...batch.map((n) => n.event.id)); } };
  const c = { cwd: f.c, ref, adapter: "opencode", session: "C", async deliver(batch: Notification[]) { deliveries.push(...batch.map((n) => n.event.id)); } };
  await consumeMailbox(a);
  await consumeMailbox(b);
  await consumeMailbox(c);
  await f.commit(f.a, "shared.txt", "upstream A\n");
  git(f.main, "merge", "--no-ff", "feature/a", "-m", "merge A");
  await consumeMailbox(a);
  fail = true;
  await assert.rejects(consumeMailbox(b), /offline/);
  await consumeMailbox(c);
  fail = false;
  await consumeMailbox(b);
  assert.equal(deliveries.length, 2);
  assert.equal(deliveries[0], deliveries[1]);
  assert.equal((await eventsIn(await repository(f.main))).length, 1);
});

test("file-scoped messages only reach overlapping worktrees, and new sessions do not replay older broadcasts", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.b, "shared.txt"), "B local\n");
  await writeFile(join(f.c, "other.txt"), "C local\n");
  let b = 0;
  let c = 0;
  const codex = { cwd: f.b, ref, adapter: "codex", session: "B", async deliver() { b++; } };
  const opencode = { cwd: f.c, ref, adapter: "opencode", session: "C", async deliver() { c++; } };
  await consumeMailbox(codex);
  await consumeMailbox(opencode);
  await sendMessage({ cwd: f.a, adapter: "claude-code", session: "A", text: "shared changed", files: ["shared.txt"] });
  await consumeMailbox(codex);
  await consumeMailbox(opencode);
  assert.equal(b, 1);
  assert.equal(c, 0);
  await consumeMailbox({ ...codex, session: "new-conversation", async deliver() { assert.fail("no historical replay"); } });
});

test("file aliases normalize before deduplication and delivery, including retained events", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.b, "shared.txt"), "local\n");
  const received: Notification[] = [];
  const options = { cwd: f.b, ref, adapter: "codex", session: "B", async deliver(batch: Notification[]) { received.push(...batch); } };
  await consumeMailbox(options);
  const event = await sendMessage({ cwd: f.a, adapter: "cc", session: "A", text: "aliases", files: ["./shared.txt", "shared.txt", ".//./shared.txt"] });
  assert.deepEqual(event.files, ["shared.txt"]);
  // Old producers may have persisted aliases before normalization was introduced.
  const repo = await repository(f.a);
  await writeFile(join(repo.directory, "events", `${event.id}.json`), JSON.stringify({ ...event, files: ["./shared.txt"] }));
  await consumeMailbox(options);
  assert.equal(received[0]?.event.id, event.id);
  await consumeMailbox(options);
  assert.equal(received.length, 1);
  for (const file of [".", "./", "src/", "./../secret", "src/../shared.txt", "/shared.txt", "C:\\shared.txt", "./C:/shared.txt"]) {
    await assert.rejects(sendMessage({ cwd: f.a, adapter: "cc", session: "A", text: "invalid", files: [file] }), /repository-relative/);
  }
});

test("Unix backslashes in filenames remain literal", { skip: process.platform === "win32" }, async (t) => {
  const f = await fixture(t);
  const file = "literal\\name.txt";
  await writeFile(join(f.b, file), "local\n");
  const options = { cwd: f.b, ref, adapter: "codex", session: "B", async deliver() {} };
  await consumeMailbox(options);
  const event = await sendMessage({ cwd: f.a, adapter: "cc", session: "A", text: "literal", files: [`./${file}`] });
  assert.deepEqual(event.files, [file]);
  assert.equal((await consumeMailbox(options))[0]?.event.id, event.id);
});

test("bounded batches leave remaining messages for the next check", async (t) => {
  const f = await fixture(t);
  const received: string[] = [];
  const options = { cwd: f.b, ref, adapter: "codex", session: "B", async deliver(batch: Notification[]) { received.push(...batch.map((n) => n.event.id)); } };
  await consumeMailbox(options);
  for (let i = 0; i < 41; i++) await sendMessage({ cwd: f.a, adapter: "claude-code", session: "A", text: `message ${i}` });
  const expected = (await eventsIn(await repository(f.b))).map((event) => event.id);
  for (const count of [8, 16, 24, 32, 40, 41]) {
    await consumeMailbox(options);
    assert.equal(received.length, count);
  }
  await consumeMailbox(options);
  assert.deepEqual(received, expected);
});

test("confirmed event payloads are skipped per session, but unread scans and GC still validate them", async (t) => {
  const f = await fixture(t);
  let delivered = 0;
  const b = { cwd: f.b, ref, adapter: "codex", session: "B", async deliver() { delivered++; } };
  const c = { ...b, cwd: f.c, session: "C" };
  await consumeMailbox(b);
  await consumeMailbox(c);
  const event = await sendMessage({ cwd: f.a, adapter: "cc", session: "A", text: "pending" });
  await consumeMailbox(b);
  const repo = await repository(f.b);
  const path = join(repo.directory, "events", `${event.id}.json`);
  await writeFile(path, "{}");
  assert.deepEqual(await consumeMailbox(b), []);
  await assert.rejects(consumeMailbox(c), /Invalid shared event/);
  await assert.rejects(eventsIn(repo), /Invalid shared event/);
  await assert.rejects(collectGarbage(f.b, { apply: true, retentionDays: 0 }), /Invalid shared event/);
  assert.equal(await readFile(path, "utf8"), "{}");
  await writeFile(path, JSON.stringify(event));
  await consumeMailbox(c);
  assert.equal(delivered, 2);
});

test("receipt filtering validates contents and notices deletion without a process restart", async (t) => {
  const f = await fixture(t);
  let delivered = 0;
  const options = { cwd: f.b, ref, adapter: "codex", session: "B", async deliver() { delivered++; } };
  await consumeMailbox(options);
  const event = await sendMessage({ cwd: f.a, adapter: "cc", session: "A", text: "pending" });
  await consumeMailbox(options);
  const repo = await repository(f.b);
  const key = sessionKey(repo, options, ref);
  const path = join(repo.directory, "receipts", key, `${event.id}.json`);
  const receipt = JSON.parse(await readFile(path, "utf8"));
  for (const invalid of [{ ...receipt, eventId: "wrong" }, { ...receipt, status: "unknown" }, { ...receipt, at: "invalid" }]) {
    await writeFile(path, JSON.stringify(invalid));
    await assert.rejects(consumeMailbox(options), /Invalid receipt/);
    assert.equal(delivered, 1);
  }
  await rm(path);
  await consumeMailbox(options);
  await consumeMailbox(options);
  assert.equal(delivered, 2);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(eventsIn(repo, key, abort.signal), /abort/i);
  await assert.rejects(eventsIn(repo, "../outside"), /Invalid receipt key/);
});

test("repo identity is shared across worktrees but not across separate clones", async (t) => {
  const f = await fixture(t);
  const a = await repository(f.a);
  const b = await repository(f.b);
  assert.equal(a.id, b.id);
  git(f.root, "clone", f.main, join(f.root, "clone"));
  const clone = await repository(join(f.root, "clone"));
  assert.notEqual(a.id, clone.id);
  await consumeMailbox({ cwd: f.b, ref, adapter: "codex", session: "B", async deliver() {} });
  const message = await sendMessage({ cwd: clone.root, adapter: "claude-code", session: "clone", text: "must not cross clones" });
  assert.equal(message.recipients.length, 0);
});

test("legacy cursors migrate without being deleted and queued delivery is acknowledged only after acceptance", async (t) => {
  const f = await fixture(t);
  const repo = await repository(f.b);
  const identity = { adapter: "codex", session: "legacy" };
  const key = sessionKey(repo, identity, ref);
  const legacyDirectory = join(repo.common, "worktree-agent-sync");
  await mkdir(legacyDirectory);
  const legacyPath = join(legacyDirectory, `${key}.json`);
  await writeFile(legacyPath, JSON.stringify({ root: f.b, ref, commit: f.initial }));
  await writeFile(join(f.b, "shared.txt"), "local\n");
  await f.commit(f.main, "shared.txt", "upstream\n");
  let received = 0;
  let accepted = false;
  const options = { cwd: f.b, ref, ...identity, async deliver() { received++; return accepted; } };
  await consumeMailbox(options);
  await consumeMailbox(options);
  assert.equal(received, 2);
  accepted = true;
  await consumeMailbox(options);
  await consumeMailbox(options);
  assert.equal(received, 3);
  assert.equal(JSON.parse(await readFile(legacyPath, "utf8")).commit, f.initial);
  assert.equal((await eventsIn(repo)).length, 1);
});

test("rewind followed by the same forward update creates a new event rather than reusing an old receipt", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.b, "shared.txt"), "local\n");
  const received: string[] = [];
  const options = { cwd: f.b, ref, adapter: "codex", session: "B", async deliver(batch: Notification[]) { received.push(...batch.map((n) => n.event.id)); } };
  await consumeMailbox(options);
  const next = await f.commit(f.main, "shared.txt", "upstream\n");
  await consumeMailbox(options);
  git(f.main, "update-ref", ref, f.initial);
  await consumeMailbox(options);
  git(f.main, "update-ref", ref, next);
  await consumeMailbox(options);
  assert.equal(received.length, 3);
  assert.equal(new Set(received).size, 3);
});

test("message validation and cancellation do not advance receipts", async (t) => {
  const f = await fixture(t);
  await assert.rejects(sendMessage({ cwd: f.a, adapter: "cc", session: "A", text: "bad", files: ["../secret"] }), /repository-relative/);
  await assert.rejects(sendMessage({ cwd: f.a, adapter: "cc", session: "A", text: "x".repeat(65 * 1024) }), /64 KiB/);
  const options = { cwd: f.b, ref, adapter: "codex", session: "B", async deliver() {} };
  await consumeMailbox(options);
  await sendMessage({ cwd: f.a, adapter: "cc", session: "A", text: "pending" });
  const abort = new AbortController();
  await assert.rejects(consumeMailbox({ ...options, signal: abort.signal, async deliver() { abort.abort(); } }), /abort/i);
  let count = 0;
  await consumeMailbox({ ...options, async deliver() { count++; } });
  assert.equal(count, 1);
});
