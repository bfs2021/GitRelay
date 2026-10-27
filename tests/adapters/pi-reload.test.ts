import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { getModel } from "@earendil-works/pi-ai/compat";
import { AgentSessionRuntime, createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager, type ExtensionAPI, type ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { sendMessage, sessionKey } from "../../src/core/mailbox.ts";
import { readJson, repository } from "../../src/core/store.ts";
import { WATCH_MESSAGE } from "../../src/adapters/pi/watch.ts";
import { fixture } from "../helpers.ts";

const extensionPath = fileURLToPath(new URL("../../src/adapters/pi/index.ts", import.meta.url));

async function host(t: TestContext, extensions: ((pi: ExtensionAPI) => void)[] = []) {
  let cleanup = async () => {};
  t.after(() => cleanup());
  const f = await fixture(t);
  const agentDir = join(f.root, "agent");
  await mkdir(agentDir);
  const manager = SessionManager.create(f.b, join(f.root, "history"));
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "baseline" }], timestamp: Date.now() });
  const settings = SettingsManager.create(f.b, agentDir);
  const loader = new DefaultResourceLoader({
    cwd: f.b, agentDir, settingsManager: settings, noSkills: true, noPromptTemplates: true,
    noThemes: true, noContextFiles: true, disabledBuiltinExtensions: ["mcp"],
    additionalExtensionPaths: [extensionPath], extensionFactories: extensions,
  });
  await loader.reload();
  const { session } = await createAgentSession({
    cwd: f.b, agentDir, model: getModel("openai", "gpt-4o"), sessionManager: manager,
    settingsManager: settings, resourceLoader: loader, noTools: "all",
  });
  const close = async () => {
    await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
    session.dispose();
  };
  cleanup = close;
  const warnings: string[] = [];
  const errors: unknown[] = [];
  await session.bindExtensions({
    mode: "rpc", uiContext: { notify(text, kind) { if (kind === "warning") warnings.push(text); } } as ExtensionUIContext,
    onError(error) { errors.push(error); },
  });
  session.agent.getApiKey = async () => "test-only";
  return { f, manager, session, warnings, errors, close, setCleanup(fn: () => Promise<void>) { cleanup = fn; } };
}

function stream(block?: Promise<void>, onStart?: (signal: AbortSignal) => void): any {
  let count = 0;
  return async (_model: unknown, _context: unknown, options: { signal: AbortSignal }) => {
    const first = ++count === 1;
    if (first) onStart?.(options.signal);
    return {
      async *[Symbol.asyncIterator]() { if (first) await block; yield { type: "done" }; },
      async result() {
        return {
          role: "assistant", content: [{ type: "text", text: "done" }], api: "openai-completions",
          provider: "openai", model: "gpt-4o", stopReason: first && options.signal.aborted ? "aborted" : "stop",
          timestamp: Date.now(), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        };
      },
    };
  };
}

function nativeEventIds(manager: SessionManager): string[] {
  return manager.getBranch().flatMap((entry) => entry.type === "custom_message" && entry.customType === WATCH_MESSAGE
    ? (entry.details as { eventIds: string[] }).eventIds : []);
}

async function assertReceipts(cwd: string, manager: SessionManager, ids: string[]) {
  const repo = await repository(cwd);
  const key = sessionKey(repo, { adapter: "pi", session: manager.getSessionId() }, "refs/heads/main");
  for (const id of ids) {
    assert.equal((await readJson(join(repo.directory, "receipts", key, `${id}.json`)) as { status: string }).status, "delivered");
  }
}

test("pi reload keeps user queues and delivers busy messages once after abort", { timeout: 30_000 }, async (t) => {
  const { f, manager, session, warnings, errors, close, setCleanup } = await host(t);
  let release!: () => void, ready!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { ready = resolve; });
  session.agent.streamFunction = stream(blocked, (signal) => { signal.addEventListener("abort", release, { once: true }); ready(); });
  const run = session.sendCustomMessage({ customType: "test-start", content: "begin", display: true }, { triggerTurn: true });
  void run.catch(() => {});
  setCleanup(async () => { session.agent.clearAllQueues(); release(); await run.catch(() => {}); await close(); });
  await started;
  assert.equal(session.isIdle, false);
  const first = await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: "busy-one" });
  await delay(5_300);
  await session.followUp("user-queued-marker");
  session.agent.followUpMode = "all";
  assert.equal(session.agent.peekQueuedMessages().length, 1);
  await session.reload();
  session.agent.followUpMode = "all";
  assert.equal(session.agent.peekQueuedMessages().length, 1);
  const second = await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: "busy-two" });
  assert.equal(session.agent.peekQueuedMessages().length, 1);
  session.clearQueue(); // Simulates the user explicitly clearing their queue.
  await session.abort();
  await run;
  assert.equal(session.isIdle, true);
  await delay(10_500);
  const ids = nativeEventIds(manager);
  assert.deepEqual(new Set(ids), new Set([first.id, second.id]));
  assert.equal(ids.length, 2);
  await assertReceipts(f.b, manager, [first.id, second.id]);
  assert.deepEqual(warnings, []);
  assert.deepEqual(errors, []);
});

test("pi reload does not duplicate delivery deferred by agent_settled", { timeout: 30_000 }, async (t) => {
  let ready!: () => void, release!: () => void;
  const settling = new Promise<void>((resolve) => { ready = resolve; });
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  let first = true;
  const { f, manager, session, warnings, errors, close, setCleanup } = await host(t, [(pi) => {
    pi.on("agent_settled", async () => { if (first) { first = false; ready(); await blocked; } });
  }]);
  session.agent.streamFunction = stream();
  const run = session.sendCustomMessage({ customType: "test-start", content: "begin", display: true }, { triggerTurn: true });
  void run.catch(() => {});
  setCleanup(async () => { release(); await run.catch(() => {}); await close(); });
  await settling;
  assert.equal(session.isIdle, true);
  const event = await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: "during-settled" });
  await delay(5_500);
  await session.reload();
  await delay(6_000);
  assert.equal((session as any)._deferredSettledActions.length, 1);
  assert.deepEqual(nativeEventIds(manager), []);
  assert.ok(warnings.some((text) => text.includes("Pi delivery outcome is unknown")));
  release();
  await run;
  assert.deepEqual(nativeEventIds(manager), [event.id]);
  await delay(6_000);
  await assertReceipts(f.b, manager, [event.id]);
  assert.deepEqual(nativeEventIds(manager), [event.id]);
  assert.deepEqual(errors, []);
});

test("pi retains a deferred delivery when a manager switches away and back", { timeout: 30_000 }, async (t) => {
  let ready!: () => void, release!: () => void;
  const settling = new Promise<void>((resolve) => { ready = resolve; });
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  let first = true;
  const { f, manager, session, errors, close, setCleanup } = await host(t, [(pi) => {
    pi.on("agent_settled", async () => { if (first) { first = false; ready(); await blocked; } });
  }]);
  session.agent.streamFunction = stream();
  const run = session.sendCustomMessage({ customType: "test-start", content: "begin", display: true }, { triggerTurn: true });
  void run.catch(() => {});
  setCleanup(async () => { release(); await run.catch(() => {}); await close(); });
  await settling;
  const event = await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: "switch-deferred" });
  await delay(5_500);
  const original = manager.getSessionFile()!;
  const other = SessionManager.create(f.b, join(f.root, "other-history"));
  other.appendMessage({ role: "user", content: [{ type: "text", text: "other" }], timestamp: Date.now() });
  manager.setSessionFile(other.getSessionFile()!);
  await session.reload();
  manager.setSessionFile(original);
  await session.reload();
  await delay(6_000);
  assert.equal((session as any)._deferredSettledActions.length, 1);
  assert.deepEqual(nativeEventIds(manager), []);
  release();
  await run;
  assert.deepEqual(nativeEventIds(manager), [event.id]);
  await delay(6_000);
  await assertReceipts(f.b, manager, [event.id]);
  assert.deepEqual(errors, []);
});

test("pi keeps delivery pending when the runtime switches away and resumes during settlement", { timeout: 35_000 }, async (t) => {
  let cleanup = async () => {};
  t.after(() => cleanup());
  const f = await fixture(t);
  const agentDir = join(f.root, "agent");
  await mkdir(agentDir);
  const settings = SettingsManager.create(f.b, agentDir);
  const manager = SessionManager.create(f.b, join(f.root, "history"));
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "baseline A" }], timestamp: Date.now() });
  const originalFile = manager.getSessionFile()!;
  const other = SessionManager.create(f.b, join(f.root, "history"));
  other.appendMessage({ role: "user", content: [{ type: "text", text: "baseline B" }], timestamp: Date.now() });
  let ready!: () => void, release!: () => void;
  const settling = new Promise<void>((resolve) => { ready = resolve; });
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  let first = true;
  const blocker = (pi: ExtensionAPI) => {
    pi.on("agent_settled", async () => { if (first) { first = false; ready(); await blocked; } });
  };
  const warnings: string[] = [];
  const errors: unknown[] = [];
  const streams: unknown[] = [];
  const mockStream = stream();
  const build = async ({ cwd, sessionManager, sessionStartEvent }: any): Promise<any> => {
    const loader = new DefaultResourceLoader({
      cwd, agentDir, settingsManager: settings, noSkills: true, noPromptTemplates: true,
      noThemes: true, noContextFiles: true, disabledBuiltinExtensions: ["mcp"],
      additionalExtensionPaths: [extensionPath], extensionFactories: [blocker],
    });
    await loader.reload();
    const result = await createAgentSession({
      cwd, agentDir, model: getModel("openai", "gpt-4o"), sessionManager,
      settingsManager: settings, resourceLoader: loader, noTools: "all", sessionStartEvent,
    });
    result.session.agent.getApiKey = async () => "test-only";
    result.session.agent.streamFunction = ((model: unknown, context: any, options: unknown) => {
      streams.push(context.messages);
      return mockStream(model, context, options);
    }) as any;
    return { ...result, services: { cwd, agentDir }, diagnostics: [] };
  };
  const bind = async (session: any) => session.bindExtensions({
    mode: "rpc", uiContext: { notify(text: string, kind: string) { if (kind === "warning") warnings.push(text); } },
    onError(error: unknown) { errors.push(error); },
  });
  const initial = await build({ cwd: f.b, sessionManager: manager });
  await bind(initial.session);
  const runtime = new AgentSessionRuntime(initial.session, initial.services, build);
  runtime.setRebindSession(bind);
  const old = runtime.session;
  const run = old.sendCustomMessage({ customType: "test-start", content: "begin", display: true }, { triggerTurn: true });
  void run.catch(() => {});
  cleanup = async () => { release(); await run.catch(() => {}); await runtime.dispose(); };
  await settling;
  assert.equal(old.isIdle, true);
  const event = await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: "switch-event" });
  await delay(5_300);
  assert.equal((old as any)._deferredSettledActions.length, 1);
  assert.equal((await runtime.switchSession(other.getSessionFile()!)).cancelled, false);
  assert.equal((await runtime.switchSession(originalFile)).cancelled, false);
  const resumed = runtime.session.sessionManager;
  assert.notEqual(resumed, manager);
  await delay(5_300);
  assert.deepEqual(nativeEventIds(resumed), []);
  assert.equal(streams.length, 1);
  assert.ok(warnings.some((text) => text.includes("Pi delivery outcome is unknown")));
  release();
  await run;
  await delay(5_300);
  assert.deepEqual(nativeEventIds(resumed), []);
  assert.equal(streams.length, 2); // The disposed SDK session still executes its deferred action.
  assert.ok(!JSON.stringify(streams[1]).includes(event.id));
  assert.deepEqual(nativeEventIds(SessionManager.open(originalFile)), []);
  const repo = await repository(f.b);
  const key = sessionKey(repo, { adapter: "pi", session: resumed.getSessionId() }, "refs/heads/main");
  assert.equal(await readJson(join(repo.directory, "receipts", key, `${event.id}.json`)), undefined);
  assert.deepEqual(errors, []);
});
