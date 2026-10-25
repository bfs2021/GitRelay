import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";
import { fixture } from "../helpers.ts";

const exec = promisify(execFile);
const cli = fileURLToPath(new URL("../../dist/cli/main.js", import.meta.url));
const run = (...args: string[]) => exec(process.execPath, [cli, ...args]);

test("separate CLI processes share messages across coding agents", async (t) => {
  const f = await fixture(t);
  const b = ["check", "--cwd", f.b, "--agent", "codex", "--session", "B"];
  const c = ["check", "--cwd", f.c, "--agent", "opencode", "--session", "C"];
  await run(...b);
  await run(...c);
  const sent = JSON.parse((await run("send", "--cwd", f.a, "--agent", "claude-code", "--session", "A", "--message", "跨进程共享消息")).stdout);
  assert.equal(sent.recipients, 2);
  for (const args of [b, c]) {
    const received = JSON.parse((await run(...args)).stdout);
    assert.equal(received.type, "worktree.agent-message");
    assert.equal(received.eventId, sent.eventId);
    assert.equal(received.text, "跨进程共享消息");
    assert.equal((await run(...args)).stdout, "");
  }
  assert.equal(JSON.parse((await run("sessions", "--cwd", f.main)).stdout).sessions.length, 3);
});

test("CLI emits portable JSON once, persists its cursor, and rejects invalid invocation", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.b, "shared.txt"), "local\n");
  const args = ["check", "--cwd", f.b, "--session", "CLI-B"];
  assert.equal((await run(...args)).stdout, "");
  await f.commit(f.main, "shared.txt", "upstream\n");
  const result = JSON.parse((await run(...args)).stdout);
  assert.equal(result.type, "worktree.upstream-change");
  assert.deepEqual(result.files, ["shared.txt"]);
  assert.match(result.message, /未自动同步/);
  assert.equal((await run(...args)).stdout, "");
  await assert.rejects(run("check"), /--session ID/);
  await assert.rejects(run("hook", "unknown"), /Choose hook/);
  assert.match((await run("--help")).stdout, /claude-code\|codex\|cursor/);
});
