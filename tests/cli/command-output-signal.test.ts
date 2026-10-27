import assert from "node:assert/strict";
import { test } from "node:test";
import { commandOutputs } from "../../src/cli/command-output.ts";

const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR };
const run = (script: string, timeout = 3000, signal?: AbortSignal) =>
  commandOutputs(process.execPath, ["-e", script], env, timeout, 4096, signal);

test("reports a terminating signal with stderr", { skip: process.platform === "win32" }, async () => {
  await assert.rejects(run("process.stderr.write('synthetic detail', () => process.kill(process.pid, 'SIGTERM'))"), /Command failed \(signal SIGTERM\): synthetic detail/);
});

test("preserves nonzero exit diagnostics", async () => {
  await assert.rejects(run("process.stderr.write('bad version', () => process.exit(17))"), /Command failed: bad version/);
});

test("preserves timeout rather than reporting its termination signal", async () => {
  await assert.rejects(run("setInterval(() => {}, 1000)", 25), /Command timed out/);
});

test("preserves an explicit cancellation reason", async () => {
  const controller = new AbortController();
  const pending = run("setInterval(() => {}, 1000)", 3000, controller.signal);
  setTimeout(() => controller.abort(new Error("synthetic cancel")), 25);
  await assert.rejects(pending, /synthetic cancel/);
});

test("preserves both successful output streams", async () => {
  assert.deepEqual(await run("process.stdout.write('2.1.2'); process.stderr.write('notice')"), { stdout: "2.1.2", stderr: "notice" });
});
