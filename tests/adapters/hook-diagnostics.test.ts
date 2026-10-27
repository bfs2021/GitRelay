import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { runHook } from "../../src/adapters/hooks.ts";
import { fixture } from "../helpers.ts";

const exec = promisify(execFile);
const ref = "refs/heads/main";

test("missing Git is reported without acknowledging hook messages", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "gitrelay-hook-diagnostic-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const before = process.env.PATH;
  process.env.PATH = root;
  t.after(() => { if (before === undefined) delete process.env.PATH; else process.env.PATH = before; });
  for (const agent of ["claude-code", "codex", "cursor"] as const) {
    const responses: object[] = [];
    const input = { hook_event_name: agent === "cursor" ? "postToolUse" : "SessionStart", session_id: "S", conversation_id: "S", cwd: root };
    await assert.rejects(runHook(agent, input, ref, async (value) => { responses.push(value); }), (error: unknown) => (error as Error & { cause?: NodeJS.ErrnoException }).cause?.code === "ENOENT");
    assert.deepEqual(responses, []);
  }
});

test("an unexecutable or signalled Git process is reported", { skip: process.platform === "win32" }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "gitrelay-hook-diagnostic-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const before = process.env.PATH;
  process.env.PATH = root;
  t.after(() => { if (before === undefined) delete process.env.PATH; else process.env.PATH = before; });
  const git = join(root, "git"), input = { hook_event_name: "SessionStart", session_id: "S", cwd: root };
  await writeFile(git, "#!/bin/sh\nexit 0\n");
  await chmod(git, 0o644);
  await assert.rejects(runHook("codex", input, ref, async () => assert.fail("unexpected hook response")), (error: unknown) => (error as Error & { cause?: NodeJS.ErrnoException }).cause?.code === "EACCES");
  await writeFile(git, "#!/bin/sh\nkill -TERM $$\n");
  await chmod(git, 0o755);
  await assert.rejects(runHook("codex", input, ref, async () => assert.fail("unexpected hook response")), (error: unknown) => (error as Error & { cause?: { signal?: string } }).cause?.signal === "SIGTERM");
});

test("cancelling a running Git probe propagates the abort", { skip: process.platform === "win32" }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "gitrelay-hook-abort-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const before = { path: process.env.PATH, marker: process.env.GIT_RELAY_TEST_PID };
  process.env.PATH = root;
  process.env.GIT_RELAY_TEST_PID = join(root, "pid");
  t.after(() => {
    for (const [key, value] of Object.entries({ PATH: before.path, GIT_RELAY_TEST_PID: before.marker })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const git = join(root, "git");
  await writeFile(git, "#!/bin/sh\nprintf '%s' \"$$\" > \"$GIT_RELAY_TEST_PID.tmp\"\n/bin/mv \"$GIT_RELAY_TEST_PID.tmp\" \"$GIT_RELAY_TEST_PID\"\nexec /bin/sleep 30\n");
  await chmod(git, 0o755);
  const abort = new AbortController(), reason = new Error("cancelled Git probe");
  const pending = runHook("codex", { hook_event_name: "SessionStart", session_id: "S", cwd: root }, ref, async () => assert.fail("unexpected hook response"), abort.signal);
  void pending.catch(() => {});
  t.after(() => abort.abort(reason));
  const deadline = Date.now() + 3000;
  let pid: number | undefined;
  while (Date.now() < deadline && pid === undefined) {
    const value = await readFile(join(root, "pid"), "utf8").catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return undefined; throw error; });
    if (value !== undefined) pid = Number(value); else await delay(10);
  }
  assert.ok(Number.isInteger(pid) && pid! > 0, "the Git test subprocess did not start");
  abort.abort(reason);
  await assert.rejects(pending, (error: unknown) => error === reason);
  const exitDeadline = Date.now() + 3000;
  let exited = false;
  while (Date.now() < exitDeadline && !exited) {
    try { process.kill(pid!, 0); await delay(20); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") exited = true; else throw error; }
  }
  assert.ok(exited, "the Git test subprocess did not exit after cancellation");
});

test("explicit Git environment still resolves an existing worktree", async (t) => {
  const before = { dir: process.env.GIT_DIR, tree: process.env.GIT_WORK_TREE, global: process.env.GIT_CONFIG_GLOBAL, system: process.env.GIT_CONFIG_NOSYSTEM };
  process.env.GIT_CONFIG_GLOBAL = process.platform === "win32" ? "NUL" : "/dev/null";
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  const f = await fixture(t);
  process.env.GIT_DIR = join(f.main, ".git");
  process.env.GIT_WORK_TREE = f.main;
  t.after(() => {
    for (const [key, value] of Object.entries({ GIT_DIR: before.dir, GIT_WORK_TREE: before.tree, GIT_CONFIG_GLOBAL: before.global, GIT_CONFIG_NOSYSTEM: before.system })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const responses: object[] = [];
  await runHook("codex", { hook_event_name: "SessionStart", session_id: "S", cwd: f.root }, ref, async (value) => { responses.push(value); });
  assert.deepEqual(responses, [{}]);
});

test("CLI hook reports missing Git as a nonzero diagnostic", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "gitrelay-hook-diagnostic-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, "empty-bin"); await mkdir(bin);
  const input = { hook_event_name: "SessionStart", session_id: "S", cwd: root };
  const env: NodeJS.ProcessEnv = { HOME: root, PATH: bin, TMPDIR: root };
  if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
  const child = exec(process.execPath, ["dist/cli/main.js", "hook", "codex"], { cwd: process.cwd(), env, timeout: 5000 });
  child.child.stdin!.end(JSON.stringify(input));
  await assert.rejects(child, (error: unknown) => {
    const result = error as Error & { code?: number; stdout?: string; stderr?: string };
    return result.code === 1 && result.stdout === "" && Boolean(result.stderr?.includes("ENOENT"));
  });
});
