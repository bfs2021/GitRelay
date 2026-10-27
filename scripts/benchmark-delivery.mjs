import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../dist/cli/main.js", import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), "git-relay-delivery-bench-"));
const main = join(temporary, "main");
const receiver = join(temporary, "receiver");
const env = { ...process.env, WORKTREE_SYNC_STATE_DIR: join(temporary, "state"), GIT_CONFIG_GLOBAL: join(temporary, "gitconfig"), GIT_CONFIG_NOSYSTEM: "1" };
const resourceTool = process.platform === "darwin" && existsSync("/usr/bin/time");
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, "-c", "user.name=Benchmark", "-c", "user.email=benchmark@example.test", "-c", "commit.gpgsign=false", "-c", `core.hooksPath=${join(temporary, "no-hooks")}`, ...args], { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] }).trim();
const round = (value) => Math.round(value * 10) / 10;
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const run = (args, resources = false) => {
  const timed = resources && resourceTool;
  const start = performance.now();
  const result = spawnSync(timed ? "/usr/bin/time" : process.execPath, timed ? ["-l", process.execPath, cli, ...args] : [cli, ...args], { encoding: "utf8", env, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 0, `${args.join(" ")}: ${result.stderr}`);
  return { ms: round(performance.now() - start), stdout: result.stdout, resources: timed ? result.stderr : null };
};
try {
  git(temporary, "init", "-b", "main", main);
  writeFileSync(join(main, "shared.txt"), "baseline\n");
  git(main, "add", "shared.txt");
  git(main, "commit", "-m", "baseline");
  git(main, "worktree", "add", "-b", "receiver", receiver);
  const check = ["check", "--cwd", receiver, "--agent", "benchmark-receiver", "--session", "receiver"];
  assert.equal(run(check).stdout.trim(), "");
  const startup = [];
  for (let i = 0; i < 6; i++) startup.push(run(["--help"]).ms);
  const samples = [];
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    const sent = run(["send", "--cwd", main, "--agent", "benchmark-sender", "--session", "sender", "--message", `BENCH_EVENT_${i}`]);
    const event = JSON.parse(sent.stdout);
    assert.equal(event.recipients, 1);
    const delivered = run(check, true);
    const total = round(performance.now() - start);
    assert.ok(delivered.stdout.includes(`BENCH_EVENT_${i}`));
    const repos = join(temporary, "state", "repos");
    const repositoryIds = readdirSync(repos);
    assert.equal(repositoryIds.length, 1);
    const receipts = join(repos, repositoryIds[0], "receipts");
    const paths = readdirSync(receipts).flatMap((key) => readdirSync(join(receipts, key)).map((name) => join(receipts, key, name)));
    const receipt = paths.find((path) => path.endsWith(`${event.eventId}.json`));
    assert.ok(receipt);
    assert.equal(JSON.parse(readFileSync(receipt, "utf8")).status, "delivered");
    samples.push({ sendMs: sent.ms, checkMs: delivered.ms, endToEndMs: total, resources: delivered.resources });
  }
  assert.equal(run(check).stdout.trim(), "");
  console.log(JSON.stringify({ node: process.version, git: git(main, "--version"), platform: process.platform, arch: process.arch, startupMedianMs: median(startup.slice(1)), samples, medians: { sendMs: median(samples.map((sample) => sample.sendMs)), checkMs: median(samples.map((sample) => sample.checkMs)), endToEndMs: median(samples.map((sample) => sample.endToEndMs)) }, resourceTool: resourceTool ? "/usr/bin/time -l" : "unavailable", workload: "one sender and receiver in linked worktrees; CLI messages; warm caches; no daemon; setup excluded" }, null, 2));
} finally {
  rmSync(temporary, { recursive: true, force: true, maxRetries: 3 });
}
