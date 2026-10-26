import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { consumeMailbox } from "../../src/core/consumer.ts";
import { daemonStatus } from "../../src/core/daemon-state.ts";
import { runDaemon } from "../../src/core/daemon.ts";
import { eventsIn, registerSession, sendMessage } from "../../src/core/mailbox.ts";
import { hash, readJson, repository, stateDirectory, writeJson } from "../../src/core/store.ts";
import { fixture, git } from "../helpers.ts";

async function waitFor(check: () => Promise<boolean>) {
  const deadline = Date.now() + 5000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("daemon condition timed out");
    await delay(20);
  }
}

test("clients delegate only to a fresh matching daemon and fall back when its heartbeat expires", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.b, "shared.txt"), "local\n");
  let count = 0;
  const receiver = { cwd: f.b, ref: "refs/heads/main", adapter: "codex", session: "B", async deliver() { count++; } };
  await consumeMailbox(receiver);
  await f.commit(f.main, "shared.txt", "upstream\n");
  const root = stateDirectory();
  const token = hash("daemon-test");
  const state = { pid: process.pid, token, intervalMs: 5000, heartbeatAt: new Date().toISOString() };
  await writeJson(join(root, "daemon.lock"), { pid: process.pid, token });
  await writeJson(join(root, "daemon.json"), state);
  assert.equal((await daemonStatus()).running, true);
  await consumeMailbox(receiver);
  assert.equal(count, 0); // Cached ref has not advanced; the daemon owns that work.
  const repo = await repository(f.b);
  const refPath = join(repo.directory, "refs", `${hash(receiver.ref)}.json`);
  const cached = await readJson(refPath) as object;
  await writeJson(refPath, { ...cached, checkedAt: "2000-01-01T00:00:00.000Z" });
  await consumeMailbox(receiver);
  assert.equal(count, 1); // A fresh daemon heartbeat cannot mask a stale individual ref.
  await f.commit(f.main, "shared.txt", "upstream again\n");
  await writeJson(join(root, "daemon.json"), { ...state, heartbeatAt: "2000-01-01T00:00:00.000Z" });
  assert.equal((await daemonStatus()).running, false);
  await consumeMailbox(receiver);
  assert.equal(count, 2);
  await writeJson(join(root, "daemon.json"), { ...state, token: hash("other-owner") });
  assert.equal((await daemonStatus()).running, false);
  await rm(join(root, "daemon.lock"));
  await rm(join(root, "daemon.json"));
});

test("one daemon discovers multiple repositories and isolates a failing subscription", async (t) => {
  const abort = new AbortController();
  let running: Promise<void> | undefined;
  t.after(async () => { abort.abort(); await running; }); // Stop before the fixture removes its store.
  const f = await fixture(t);
  const clone = join(f.root, "clone");
  git(f.root, "clone", f.main, clone);
  await consumeMailbox({ cwd: f.b, ref: "refs/heads/main", adapter: "codex", session: "B", async deliver() {} });
  await consumeMailbox({ cwd: clone, ref: "refs/heads/main", adapter: "pi", session: "clone", async deliver() {} });
  // A legacy/corrupt subscription must remain isolated; send no longer creates subscriptions.
  await registerSession(await repository(f.a), { adapter: "cc", session: "bad-ref" }, "refs/heads/missing");
  const a = await repository(f.b);
  const b = await repository(clone);
  const errors: string[] = [];
  const ready = Promise.withResolvers<void>();
  running = runDaemon({
    signal: abort.signal, intervalMs: 50,
    onEvent(event: any) {
      if (event.type === "daemon.ready") ready.resolve();
      if (event.type === "daemon.error") errors.push(`${event.ref ?? ""}: ${event.message}`);
    },
  });
  running.catch(ready.reject);
  await ready.promise;
  await f.commit(f.main, "shared.txt", "main updated\n");
  await f.commit(clone, "shared.txt", "clone updated\n");
  await waitFor(async () => (await eventsIn(a)).some((e) => e.kind === "upstream") && (await eventsIn(b)).some((e) => e.kind === "upstream") && errors.length > 0);
  assert.ok(errors.some((message) => message.includes("missing")));
  abort.abort();
  await running;
  assert.equal((await daemonStatus()).running, false);
});

test("daemon cleans newly confirmed events again at the hourly maintenance interval", async (t) => {
  const abort = new AbortController();
  let running: Promise<void> | undefined;
  t.after(async () => { abort.abort(); await running; });
  const f = await fixture(t);
  let confirmed = false;
  const receiver = { cwd: f.b, ref: "refs/heads/main", adapter: "codex", session: "B", async deliver() { confirmed = true; } };
  await consumeMailbox(receiver);
  const event = await sendMessage({ cwd: f.a, adapter: "cc", session: "A", text: "initially unread" });
  const repo = await repository(f.b);
  let clock = Date.now();
  t.mock.method(Date, "now", () => clock);
  const reports: any[] = [];
  running = runDaemon({ signal: abort.signal, intervalMs: 50, retentionDays: 0, onEvent(event: any) { if (event.type === "daemon.cleanup") reports.push(event); } });
  await waitFor(async () => reports.length >= 1);
  assert.equal(reports[0].removed, 0);
  await waitFor(async () => { await consumeMailbox(receiver); return confirmed; });
  clock += 60 * 60 * 1000 + 1;
  await waitFor(async () => reports.some((report) => report.removed === 1));
  assert.equal((await eventsIn(repo)).some((item) => item.id === event.id), false);
  abort.abort();
  await running;
});

test("blocked daemon output releases publish.lock and remains abortable", async (t) => {
  const abort = new AbortController();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let running: Promise<void> | undefined;
  t.after(async () => { abort.abort(); release.resolve(); await running; });
  const f = await fixture(t);
  const receiver = { cwd: f.b, ref: "refs/heads/main", adapter: "codex", session: "B", async deliver() {} };
  await consumeMailbox(receiver);
  await registerSession(await repository(f.a), { adapter: "cc", session: "bad" }, "refs/heads/missing");
  const repo = await repository(f.b);
  running = runDaemon({
    signal: abort.signal, intervalMs: 50,
    onEvent(event: any) {
      if (event.type === "daemon.error") { entered.resolve(); return release.promise; }
    },
  });
  running.catch(entered.reject);
  await entered.promise;
  assert.equal(await readJson(join(repo.directory, "publish.lock")), undefined);
  const event = await sendMessage({ cwd: f.a, adapter: "cc", session: "A", text: "not blocked" });
  assert.ok((await consumeMailbox(receiver)).some((notification) => notification.event.id === event.id));
  abort.abort();
  await Promise.race([running, delay(2000).then(() => { throw new Error("blocked output prevented daemon shutdown"); })]);
  assert.equal(await readJson(join(stateDirectory(), "daemon.lock")), undefined);
  assert.equal(await readJson(join(stateDirectory(), "daemon.json")), undefined);
  assert.equal(await readJson(join(repo.directory, "publish.lock")), undefined);
});

test("daemon validates limits and supports cancellation before acquiring its lock", async () => {
  await assert.rejects(runDaemon({ signal: AbortSignal.abort() }), /abort/i);
  await assert.rejects(runDaemon({ signal: new AbortController().signal, intervalMs: 0 }), /interval-ms/);
  await assert.rejects(runDaemon({ signal: new AbortController().signal, retentionDays: NaN }), /retention-days/);
});
