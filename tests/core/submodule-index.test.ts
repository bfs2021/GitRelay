import assert from "node:assert/strict";
import childProcess, { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { worktreeFiles } from "../../src/core/changes.ts";
import { fixture } from "../helpers.ts";

test("gitlink index reader handles chunk boundaries, invalid data and cancellation", { timeout: 30_000, skip: process.platform === "win32" ? "The test wrapper requires POSIX executable scripts" : false }, async (t) => {
  const f = await fixture(t), bin = join(f.root, "fake-bin");
  await mkdir(bin);
  const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  const wrapper = join(bin, "git");
  await writeFile(wrapper, `#!${process.execPath}
const { spawnSync } = require("node:child_process");
const args = process.argv.slice(2), mode = process.env.GIT_RELAY_TEST_INDEX;
if (!args.includes("ls-files") || !args.includes("--stage")) {
  const result = spawnSync(process.env.GIT_RELAY_TEST_REAL_GIT, args, { stdio: "inherit" });
  process.exit(result.status ?? 1);
}
const record = (mode, hash, stage, path) => Buffer.concat([Buffer.from(mode + " " + hash + " " + stage + "\\t"), path, Buffer.from([0])]);
if (mode === "data") {
  const sha1 = "1".repeat(40), sha256 = "2".repeat(64), name = Buffer.from("sub\\tline\\n");
  const data = Buffer.concat([record("100644", sha1, 0, Buffer.from([98, 97, 100, 255])), record("160000", sha1, 1, name), record("160000", sha1, 2, name), record("160000", sha256, 3, name)]);
  for (let i = 0; i < data.length; i += 7) process.stdout.write(data.subarray(i, i + 7));
} else if (mode === "bad-header") {
  process.stdout.write(Buffer.concat([Buffer.from([0xb1]), Buffer.from("60000 " + "1".repeat(40) + " 0\\tname\\0")]));
} else if (mode === "invalid-path") {
  process.stdout.write(record("160000", "1".repeat(40), 0, Buffer.from([255])));
} else if (mode === "exact" || mode === "big") {
  const header = Buffer.from("100644 " + "1".repeat(40) + " 0\\t");
  const bytes = 16 * 1024 * 1024 + (mode === "big" ? 1 : 0);
  process.stdout.write(header);
  const block = Buffer.alloc(4096, 120);
  for (let left = bytes - header.length; left > 0; left -= Math.min(left, block.length)) process.stdout.write(block.subarray(0, Math.min(left, block.length)));
  process.stdout.write(Buffer.from([0]));
} else if (mode === "unterminated") {
  process.stdout.write("100644 " + "1".repeat(40) + " 0\\tfile");
} else if (mode === "fail") {
  process.stderr.write("injected index error"); process.exitCode = 1;
} else if (mode === "wait") {
  setInterval(() => {}, 1000);
}
`);
  await chmod(wrapper, 0o755);
  const oldPath = process.env.PATH, oldReal = process.env.GIT_RELAY_TEST_REAL_GIT, oldMode = process.env.GIT_RELAY_TEST_INDEX;
  t.after(() => {
    if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath;
    if (oldReal === undefined) delete process.env.GIT_RELAY_TEST_REAL_GIT; else process.env.GIT_RELAY_TEST_REAL_GIT = oldReal;
    if (oldMode === undefined) delete process.env.GIT_RELAY_TEST_INDEX; else process.env.GIT_RELAY_TEST_INDEX = oldMode;
  });
  process.env.PATH = `${bin}:${oldPath ?? ""}`;
  process.env.GIT_RELAY_TEST_REAL_GIT = realGit;
  process.env.GIT_RELAY_TEST_INDEX = "data";
  assert.deepEqual([...await worktreeFiles(f.b, f.initial)], ["sub\tline\n"]);
  for (const [mode, error] of [["bad-header", /Invalid Git index/], ["invalid-path", /not valid UTF-8/], ["big", /record exceeds 16 MiB/], ["unterminated", /Unterminated Git index/], ["fail", /injected index error/]] as const) {
    process.env.GIT_RELAY_TEST_INDEX = mode;
    await assert.rejects(worktreeFiles(f.b, f.initial), error);
  }
  process.env.GIT_RELAY_TEST_INDEX = "exact";
  assert.equal((await worktreeFiles(f.b, f.initial)).size, 0);
  process.env.GIT_RELAY_TEST_INDEX = "wait";
  const abort = new AbortController(), reason = new Error("test index cancellation");
  const timer = setTimeout(() => abort.abort(reason), 200);
  try { await assert.rejects(worktreeFiles(f.b, f.initial, abort.signal), (error) => error === reason); }
  finally { clearTimeout(timer); }
});

test("index reader reports pipe errors and waits for the direct child to close", async (t) => {
  const f = await fixture(t), original = childProcess.spawn;
  try {
    for (const stream of ["stdout", "stderr"] as const) {
      let killed = false, closed = false;
      const fake = ((command: string, args: readonly string[], options: unknown) => {
        if (!args.includes("--stage")) return original(command, args, options as Parameters<typeof original>[2]);
        const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; exitCode: number | null; signalCode: NodeJS.Signals | null; kill(): boolean };
        child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.exitCode = null; child.signalCode = null;
        child.kill = () => { killed = true; child.signalCode = "SIGKILL"; setImmediate(() => { closed = true; child.emit("close", null); }); return true; };
        setImmediate(() => child[stream].emit("error", new Error(`injected ${stream} error`)));
        return child;
      }) as unknown as typeof original;
      childProcess.spawn = fake;
      syncBuiltinESMExports();
      await assert.rejects(worktreeFiles(f.b, f.initial), new RegExp(`injected ${stream} error`));
      assert.equal(killed, true);
      assert.equal(closed, true);
    }
  } finally {
    childProcess.spawn = original;
    syncBuiltinESMExports();
  }
});
