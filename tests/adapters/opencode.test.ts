import assert from "node:assert/strict";
import { stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test, type TestContext } from "node:test";
import type { Plugin } from "@opencode/plugin";
import plugin from "../../src/adapters/opencode/index.ts";
import { listSessions, readReceipt, sendMessage, sessionKey } from "../../src/core/mailbox.ts";
import { repository } from "../../src/core/store.ts";
import { fixture } from "../helpers.ts";

type Prompt = Parameters<Plugin.Context["session"]["prompt"]>[0];
async function waitFor(check: () => Promise<boolean>) {
  const deadline = Date.now() + 3000;
  while (!await check()) {
    assert.ok(Date.now() < deadline, "OpenCode adapter timed out");
    await delay(10);
  }
}

async function harness(t: TestContext, prompt: (input: Prompt, signal?: AbortSignal) => Promise<void>) {
  const f = await fixture(t);
  t.mock.timers.enable({ apis: ["setInterval"] });
  let onPrompt!: (event: { sessionID: string; metadata?: Record<string, unknown> }) => Promise<void>;
  let wake = Promise.withResolvers<void>();
  const events: { type: "session.deleted"; data: { sessionID: string }; handled(): void }[] = [];
  const locations = new Map<string, { location: { directory: string }; parentID?: string }>();
  const context = {
    location: { directory: f.b },
    session: {
      async get({ sessionID }: { sessionID: string }) { return locations.get(sessionID) ?? { location: { directory: f.b } }; },
      async hook(name: string, handler: typeof onPrompt) {
        assert.equal(name, "prompt");
        onPrompt = handler;
        return { async dispose() {} };
      },
      async prompt(input: Prompt, options: { signal?: AbortSignal }) {
        await onPrompt({ sessionID: input.sessionID, metadata: input.metadata });
        await prompt(input, options.signal);
      },
    },
    event: {
      async *subscribe({ signal }: { signal: AbortSignal }) {
        while (!signal.aborted) {
          while (events.length) {
            const event = events.shift()!;
            yield event;
            event.handled();
          }
          const current = wake;
          const stop = () => current.resolve();
          signal.addEventListener("abort", stop, { once: true });
          try { if (!signal.aborted) await current.promise; }
          finally { signal.removeEventListener("abort", stop); }
        }
      },
    },
  };
  const cleanup = await plugin.setup(context as unknown as Plugin.Context);
  t.after(cleanup);
  const id = "ses_receiver";
  const repo = await repository(f.b);
  const key = sessionKey(repo, { adapter: "opencode", session: id }, "refs/heads/main");
  return {
    ...f, id, repo, key, locations, session: context.session,
    enroll: (sessionID = id) => onPrompt({ sessionID }),
    tick: () => t.mock.timers.tick(5000),
    removed() {
      const done = Promise.withResolvers<void>();
      events.push({ type: "session.deleted", data: { sessionID: id }, handled: done.resolve });
      wake.resolve();
      wake = Promise.withResolvers<void>();
      return done.promise;
    },
    async unlocked() { return !await stat(join(repo.directory, "sessions", `${key}.lock`)).catch(() => undefined); },
  };
}

test("OpenCode v2 queues durable input, wakes idle sessions and does not recursively enroll", async (t) => {
  const calls: Prompt[] = [];
  const f = await harness(t, async (input) => { calls.push(input); });
  await writeFile(join(f.b, "shared.txt"), "local\n");
  await f.enroll();
  assert.equal(calls.length, 0);
  await f.commit(f.main, "shared.txt", "upstream\n");
  f.tick();
  await waitFor(async () => calls.length === 1 && await f.unlocked());
  assert.equal(calls[0].sessionID, f.id);
  assert.equal(calls[0].delivery, "queue");
  assert.match(calls[0].text!, /shared.txt/);
  assert.deepEqual(calls[0].metadata, { source: "worktree-relay" });
  assert.equal((await listSessions(f.b)).length, 1);
  const lastSeen = (await listSessions(f.b))[0].lastSeen;
  f.tick();
  await waitFor(async () => (await listSessions(f.b))[0].lastSeen !== lastSeen && await f.unlocked());
  assert.equal(calls.length, 1);
});

test("OpenCode v2 retries failed admission and acknowledges only durable acceptance", async (t) => {
  const warnings: unknown[] = [];
  t.mock.method(console, "warn", (message: unknown) => { warnings.push(message); });
  let attempts = 0;
  const f = await harness(t, async () => { if (++attempts === 1) throw new Error("admission failed"); });
  await f.enroll();
  const event = await sendMessage({ cwd: f.a, adapter: "pi", session: "sender", text: "retry" });
  f.tick();
  await waitFor(async () => attempts === 1 && await f.unlocked());
  assert.equal(await readReceipt(f.repo, f.key, event.id), undefined);
  f.tick();
  await waitFor(async () => (await readReceipt(f.repo, f.key, event.id))?.status === "delivered");
  assert.equal(attempts, 2);
  assert.equal(warnings.length, 1);
});

test("OpenCode v2 deletion aborts in-flight admission without acknowledging it", async (t) => {
  let attempts = 0;
  const f = await harness(t, async (_input, signal) => {
    attempts++;
    await new Promise<void>((_resolve, reject) => signal!.addEventListener("abort", () => reject(signal!.reason), { once: true }));
  });
  await f.enroll();
  const event = await sendMessage({ cwd: f.a, adapter: "pi", session: "sender", text: "cancel" });
  f.tick();
  await waitFor(async () => attempts === 1);
  f.removed();
  await waitFor(f.unlocked);
  assert.equal(await readReceipt(f.repo, f.key, event.id), undefined);
  f.tick();
  assert.equal(attempts, 1);
});

test("OpenCode v2 lookup failures warn without failing the user's prompt", async (t) => {
  const warnings: unknown[] = [];
  t.mock.method(console, "warn", (message: unknown) => { warnings.push(message); });
  const f = await harness(t, async () => { assert.fail("lookup failed"); });
  const lookup = t.mock.method(f.session, "get", async () => { throw new Error("Session.NotFoundError"); });
  await assert.doesNotReject(f.enroll());
  assert.equal(warnings.length, 1);
  assert.match(String(warnings[0]), /Session.NotFoundError/);
  assert.equal((await listSessions(f.b)).length, 0);
  f.tick();
  assert.equal(lookup.mock.callCount(), 1);
  lookup.mock.restore();
  await f.enroll();
  assert.equal((await listSessions(f.b)).length, 1, "a transient lookup failure remains retryable");
});

test("OpenCode v2 deletion during lookup cannot enroll or poll a ghost session", async (t) => {
  const warnings: unknown[] = [];
  t.mock.method(console, "warn", (message: unknown) => { warnings.push(message); });
  const f = await harness(t, async () => { assert.fail("deleted session"); });
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const originalGet = f.session.get;
  const lookup = t.mock.method(f.session, "get", async (input: { sessionID: string }) => {
    entered.resolve();
    await release.promise;
    return originalGet(input);
  });
  const enrolling = f.enroll();
  await entered.promise;
  await f.removed();
  release.resolve();
  await enrolling;
  await f.enroll(); // A late prompt for the deleted ID must not re-enroll it.
  f.tick();
  f.tick();
  assert.equal(lookup.mock.callCount(), 1);
  assert.equal((await listSessions(f.b)).length, 0);
  assert.deepEqual(warnings, []);
});

test("OpenCode v2 does not enroll child sessions or sessions in other directories", async (t) => {
  const f = await harness(t, async () => { assert.fail("unrelated session"); });
  f.locations.set("child", { location: { directory: f.b }, parentID: "parent" });
  f.locations.set("foreign", { location: { directory: f.c } });
  await f.enroll("child");
  await f.enroll("foreign");
  assert.equal((await listSessions(f.b)).length, 0);
});
