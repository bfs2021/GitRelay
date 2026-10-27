import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") throw new Error("This benchmark requires macOS and clang.");
const dist = fileURLToPath(new URL("../dist", import.meta.url));
const cli = join(dist, "cli", "main.js");
const source = fileURLToPath(new URL("./benchmark-darwin-io.c", import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), "git-relay-io-bench-"));
const main = join(temporary, "main");
const receiver = join(temporary, "receiver");
const helper = join(temporary, "measure");
const env = { ...process.env, WORKTREE_SYNC_STATE_DIR: join(temporary, "state"), GIT_CONFIG_GLOBAL: join(temporary, "gitconfig"), GIT_CONFIG_NOSYSTEM: "1" };
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, "-c", "user.name=Benchmark", "-c", "user.email=benchmark@example.test", "-c", "commit.gpgsign=false", "-c", `core.hooksPath=${join(temporary, "no-hooks")}`, ...args], { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] }).trim();
const run = (command, args) => {
  const child = spawnSync(helper, [command, ...args], { encoding: "utf8", env, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(child.status, 0, `${command}: ${child.stderr}`);
  return { stdout: child.stdout, metrics: JSON.parse(child.stderr.trim().split("\n").at(-1)) };
};
const cliRun = (args) => run(process.execPath, [cli, ...args]);
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const summarize = (values) => Object.fromEntries(Object.keys(values[0]).map((key) => [key, median(values.map((value) => value[key]))]));
const fingerprint = () => {
  const files = [];
  const walk = (relative = "") => {
    for (const item of readdirSync(join(dist, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(relative, item.name);
      if (item.isDirectory()) walk(path);
      else if (item.isFile() && item.name.endsWith(".js")) files.push([path, createHash("sha256").update(readFileSync(join(dist, path))).digest("hex")]);
      else if (item.isSymbolicLink()) throw new Error(`Unexpected symlink in compiled output: ${path}`);
    }
  };
  walk();
  return createHash("sha256").update(JSON.stringify(files)).digest("hex");
};
try {
  const buildHash = fingerprint();
  execFileSync("clang", ["-Wall", "-Wextra", "-o", helper, source], { stdio: "pipe" });
  const control = run(process.execPath, ["-e", "const fs=require('fs'); const fd=fs.openSync(process.argv[1],'w'); fs.writeFileSync(fd,Buffer.alloc(1048576)); fs.fsyncSync(fd); fs.closeSync(fd)", join(temporary, "control")]);
  assert.ok(control.metrics.logical_write_bytes >= 1048576, "I/O counter positive control failed");
  assert.ok(control.metrics.disk_write_bytes > 0, "Disk I/O accounting positive control failed");
  git(temporary, "init", "-b", "main", main);
  writeFileSync(join(main, "shared.txt"), "baseline\n");
  git(main, "add", "shared.txt");
  git(main, "commit", "-m", "baseline");
  git(main, "worktree", "add", "-b", "receiver", receiver);
  const check = ["check", "--cwd", receiver, "--agent", "benchmark-receiver", "--session", "receiver"];
  assert.equal(cliRun(check).stdout.trim(), "");
  const startup = [];
  for (let i = 0; i < 6; i++) startup.push(cliRun(["--help"]).metrics);
  const samples = [];
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    const sent = cliRun(["send", "--cwd", main, "--agent", "benchmark-sender", "--session", "sender", "--message", `IOBENCH_${i}`]);
    const event = JSON.parse(sent.stdout);
    assert.equal(event.recipients, 1);
    const received = cliRun(check);
    const endToEndMs = Math.round((performance.now() - start) * 100) / 100;
    assert.ok(received.stdout.includes(`IOBENCH_${i}`));
    const repos = join(temporary, "state", "repos");
    const ids = readdirSync(repos);
    assert.equal(ids.length, 1);
    const receipts = join(repos, ids[0], "receipts");
    const receipt = readdirSync(receipts).flatMap((key) => readdirSync(join(receipts, key)).map((name) => join(receipts, key, name))).find((path) => path.endsWith(`${event.eventId}.json`));
    assert.ok(receipt);
    assert.equal(JSON.parse(readFileSync(receipt, "utf8")).status, "delivered");
    samples.push({ send: sent.metrics, check: received.metrics, endToEndMs });
  }
  assert.equal(cliRun(check).stdout.trim(), "");
  assert.equal(fingerprint(), buildHash, "Compiled JavaScript changed during the benchmark");
  console.log(JSON.stringify({ node: process.version, git: git(main, "--version"), platform: process.platform, arch: process.arch, buildHash, control: control.metrics, startupMedian: summarize(startup.slice(1)), sendMedian: summarize(samples.map((sample) => sample.send)), checkMedian: summarize(samples.map((sample) => sample.check)), endToEndMedianMs: median(samples.map((sample) => sample.endToEndMs)), samples, workload: "one sender and receiver in linked worktrees; direct Node process only; warm cache; no daemon; setup excluded" }, null, 2));
} finally {
  rmSync(temporary, { recursive: true, force: true, maxRetries: 3 });
}
