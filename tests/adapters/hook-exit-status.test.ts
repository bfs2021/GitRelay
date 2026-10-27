import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runHook, type HookAgent } from "../../src/adapters/hooks.ts";

const agents: HookAgent[] = ["claude-code", "codex", "cursor"];
const ref = "refs/heads/main";
const input = (agent: HookAgent, cwd: string) => ({
  hook_event_name: agent === "cursor" ? "postToolUse" : "UserPromptSubmit", session_id: "probe", conversation_id: "probe", cwd,
});

test("hook reports unexpected numeric Git exits and signalled children for all agents", { skip: process.platform === "win32" }, async t => {
  const root = await mkdtemp(join(tmpdir(), "hook-exit-")), bin = join(root, "bin"), template = join(root, "template"), repo = join(root, "repo");
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(bin); await mkdir(template);
  execFileSync("git", ["init", "--template", template, repo], { stdio: "ignore" });
  const previous = process.env.PATH; t.after(() => { process.env.PATH = previous; });
  const wrapper = join(bin, "git");
  for (const [name, script, expected] of [["exit-1", "exit 1", 1], ["exit-77", "exit 77", 77], ["exit-129", "exit 129", 129], ["signal", "kill -TERM $$", "SIGTERM"]] as const) {
    await writeFile(wrapper, `#!/bin/sh\nprintf 'fatal: ${name}\\n' >&2\n${script}\n`); await chmod(wrapper, 0o755);
    process.env.PATH = `${bin}:${previous ?? ""}`;
    for (const agent of agents) {
      const responses: object[] = [];
      await assert.rejects(runHook(agent, input(agent, repo), ref, async value => { responses.push(value); }), (error: unknown) => {
        const cause = (error as Error & { cause?: { code?: unknown; signal?: unknown } }).cause;
        return expected === "SIGTERM" ? cause?.signal === expected : cause?.code === expected;
      });
      assert.deepEqual(responses, [], `${agent} ${name} wrote output despite the error`);
    }
  }
});

test("actual non-repository and numeric 128 retain the existing quiet behavior", { skip: process.platform === "win32" }, async t => {
  const root = await mkdtemp(join(tmpdir(), "hook-nonrepo-")), bin = join(root, "bin"), repo = join(root, "repo"), template = join(root, "template");
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(bin); await mkdir(template);
  execFileSync("git", ["init", "--template", template, repo], { stdio: "ignore" });
  const previous = process.env.PATH; t.after(() => { process.env.PATH = previous; });
  for (const agent of agents) {
    const responses: object[] = [];
    await runHook(agent, input(agent, root), ref, async value => { responses.push(value); });
    assert.deepEqual(responses, [{}]);
  }
  await writeFile(join(bin, "git"), "#!/bin/sh\nprintf 'fatal: injected 128 failure\\n' >&2\nexit 128\n"); await chmod(join(bin, "git"), 0o755);
  process.env.PATH = `${bin}:${previous ?? ""}`;
  for (const agent of agents) {
    const responses: object[] = [];
    await runHook(agent, input(agent, repo), ref, async value => { responses.push(value); });
    assert.deepEqual(responses, [{}]);
  }
});

test("healthy repository hooks still initialize and produce normal output", async t => {
  const root = await mkdtemp(join(tmpdir(), "hook-healthy-")), repo = join(root, "repo"), template = join(root, "template");
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(template); execFileSync("git", ["init", "--template", template, "-b", "main", repo], { stdio: "ignore" });
  execFileSync("git", ["-C", repo, "-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "test"], { stdio: "ignore" });
  const previous = process.env.WORKTREE_SYNC_STATE_DIR;
  t.after(() => { if (previous === undefined) delete process.env.WORKTREE_SYNC_STATE_DIR; else process.env.WORKTREE_SYNC_STATE_DIR = previous; });
  for (const agent of agents) {
    process.env.WORKTREE_SYNC_STATE_DIR = join(root, `state-${agent}`);
    const responses: object[] = [];
    await runHook(agent, input(agent, repo), ref, async value => { responses.push(value); });
    assert.deepEqual(responses, [{}]);
  }
});

test("numeric 128 with killed timeout is not silently treated as non-repository", async () => {
  const script = `import cp from 'node:child_process'; import { syncBuiltinESMExports } from 'node:module'; cp.execFile = (_file,_args,_opts,cb) => { queueMicrotask(() => cb(Object.assign(new Error('timeout'), {code:128, killed:true, signal:'SIGTERM', stderr:Buffer.from('injected timeout')}))); return {}; }; syncBuiltinESMExports(); const {runHook} = await import('./src/adapters/hooks.ts'); for (const agent of ['claude-code','codex','cursor']) { let wrote=false; try { await runHook(agent, {hook_event_name:agent==='cursor'?'postToolUse':'UserPromptSubmit', session_id:'probe', conversation_id:'probe', cwd:'/tmp'}, 'refs/heads/main', async()=>{wrote=true}); process.exitCode=1; } catch (error) { if (!error.message.includes('injected timeout') || wrote) process.exitCode=1; } }`;
  const result = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", "--experimental-strip-types", "--input-type=module", "-e", script], { cwd: process.cwd(), env: process.env, encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
});
