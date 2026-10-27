import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { detectPlatform } from "../../src/cli/platform-detection.ts";

test("detects installed, incompatible, missing and uninspectable clients independently", { skip: process.platform === "win32" }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "git-relay-detect-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const write = async (name: string, script: string) => {
    const path = join(dir, name);
    await writeFile(path, `#!/bin/sh\n${script}\n`);
    await chmod(path, 0o755);
  };
  const env = { ...process.env, PATH: dir };
  await write("codex", "printf 'codex-cli 0.164.0\\n'");
  await write("opencode", "printf 'opencode v1.2.3\\n'");
  await write("claude", "printf 'client failed\\n' >&2; exit 3");
  assert.deepEqual(await detectPlatform("codex", env), { platform: "codex", status: "installed", version: "0.164.0", previouslyTested: true });
  assert.deepEqual(await detectPlatform("opencode", env), { platform: "opencode", status: "incompatible", version: "1.2.3", previouslyTested: false });
  await write("opencode", "printf 'opencode v0.8.0\\n'");
  assert.equal((await detectPlatform("opencode", env)).status, "incompatible");
  const failed = await detectPlatform("claude-code", env);
  assert.equal(failed.status, "unavailable");
  assert.match("reason" in failed ? failed.reason : "", /client failed/);
  assert.deepEqual(await detectPlatform("pi", env), { platform: "pi", status: "missing" });
  await write("pi", "printf 'unexpected version\\n'");
  assert.equal((await detectPlatform("pi", env)).status, "unavailable");
  await write("pi", "printf '1.5.0\\n'");
  assert.deepEqual(await detectPlatform("pi", env), { platform: "pi", status: "unverified", version: "1.5.0", previouslyTested: false });
  assert.equal((await detectPlatform("pi", {})).status, "unavailable");
  const earlier = join(dir, "earlier");
  await mkdir(earlier);
  await writeFile(join(earlier, "pi"), "not executable", { mode: 0o644 });
  assert.equal((await detectPlatform("pi", { ...env, PATH: `${earlier}${delimiter}${dir}` })).status, "unverified");
  assert.equal((await detectPlatform("pi", { ...env, PATH: earlier })).status, "unavailable");
  await mkdir(join(earlier, "opencode"));
  assert.equal((await detectPlatform("opencode", { ...env, PATH: earlier })).status, "unavailable");
  await write("opencode", "printf 'opencode v3.0.0\\n'");
  assert.equal((await detectPlatform("opencode", env)).status, "unverified");
  await write("opencode", "printf 'opencode v2.1.3\\n'");
  assert.deepEqual(await detectPlatform("opencode", env), { platform: "opencode", status: "installed", version: "2.1.3", previouslyTested: false });
  await write("opencode", "printf 'opencode v2.1.2+build-123\\n'");
  assert.deepEqual(await detectPlatform("opencode", env), { platform: "opencode", status: "installed", version: "2.1.2+build-123", previouslyTested: false });
  await write("opencode", "printf 'opencode v2.1.2-rc.1+build-123\\n'");
  assert.deepEqual(await detectPlatform("opencode", env), { platform: "opencode", status: "unverified", version: "2.1.2-rc.1+build-123", previouslyTested: false });
  for (const malformed of ["2.1.2-", "2.1.2+", "2.1.2.9", "2.1.2junk", "2.1.2+_bad", "2.1.2-01", "02.1.2"]) {
    await write("opencode", `printf 'opencode ${malformed}\\n'`);
    assert.equal((await detectPlatform("opencode", env)).status, "unavailable");
  }
});

test("pi detection distinguishes its necessary API floor from tested support", { skip: process.platform === "win32" }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "git-relay-pi-version-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const executable = join(dir, "pi");
  const env = { ...process.env, PATH: dir };
  const cases = [
    ["0.77.9", "incompatible"],
    ["0.78.0", "incompatible"],
    ["0.78.0+build-123", "incompatible"],
    ["0.78.1", "unverified"],
    ["0.78.1+build-123", "unverified"],
    ["0.79.0", "unverified"],
    ["1.3.9", "unverified"],
    ["1.4.0", "installed"],
    ["1.4.1", "unverified"],
    ["0.77.9-rc.1", "unverified"],
    ["0.78.1-rc.1", "unverified"],
    ["0.78.1-rc.1+build-123", "unverified"],
  ] as const;
  for (const [version, status] of cases) {
    await writeFile(executable, `#!/bin/sh\nprintf '%s\\n' '${version}'\n`, { mode: 0o755 });
    assert.deepEqual(await detectPlatform("pi", env), { platform: "pi", status, version, previouslyTested: version === "1.4.0" });
  }
});

test("installer refuses an incompatible pi even when unverified versions are allowed", { skip: process.platform === "win32" }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "git-relay-pi-floor-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, "pi"), "#!/bin/sh\nprintf '0.78.0\\n'\n", { mode: 0o755 });
  const env = { ...process.env, PATH: dir, HOME: dir, XDG_DATA_HOME: join(dir, "data"), XDG_CONFIG_HOME: join(dir, "config"), PI_CODING_AGENT_DIR: join(dir, "agent") };
  const cli = fileURLToPath(new URL("../../src/cli/main.ts", import.meta.url));
  const failure = await promisify(execFile)(process.execPath, ["--experimental-strip-types", cli, "install", "--platform", "pi", "--allow-unverified"], { env }).then(() => null, (error) => error);
  assert.equal(failure?.code, 1);
  const result = JSON.parse(failure.stdout);
  assert.equal(result.failed, true);
  assert.deepEqual(result.results.find((entry: { platform: string }) => entry.platform === "pi"), { platform: "pi", status: "incompatible", version: "0.78.0", previouslyTested: false });
  await assert.rejects(stat(join(dir, "data")), { code: "ENOENT" });
  await assert.rejects(stat(join(dir, "agent")), { code: "ENOENT" });
});

test("version detection bounds and cancels a client that ignores termination", { skip: process.platform === "win32" }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "git-relay-detect-hung-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const executable = join(dir, "pi");
  await writeFile(executable, "#!/bin/sh\ntrap '' TERM\n/bin/sleep 30 &\nwait\n", { mode: 0o755 });
  const env = { ...process.env, PATH: dir };
  const started = Date.now();
  const result = await detectPlatform("pi", env);
  assert.equal(result.status, "unavailable");
  assert.match("reason" in result ? result.reason : "", /timed out/);
  assert.ok(Date.now() - started < 8000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 100);
  t.after(() => clearTimeout(timer));
  await assert.rejects(detectPlatform("pi", env, controller.signal), { name: "AbortError" });
});
