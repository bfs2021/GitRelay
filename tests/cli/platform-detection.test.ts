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
  assert.deepEqual(await detectPlatform("codex", env), { platform: "codex", status: "installed", version: "0.164.0", previouslyTested: true });
  assert.deepEqual(await detectPlatform("opencode", env), { platform: "opencode", status: "incompatible", version: "1.2.3", previouslyTested: false });
  await write("opencode", "printf 'opencode v0.8.0\\n'");
  assert.equal((await detectPlatform("opencode", env)).status, "incompatible");
  await write("codex", "printf 'client failed\\n' >&2; exit 3");
  const failed = await detectPlatform("codex", env);
  assert.equal(failed.status, "unavailable");
  assert.match("reason" in failed ? failed.reason : "", /client failed/);
  await rm(join(dir, "codex"));
  assert.deepEqual(await detectPlatform("codex", env), { platform: "codex", status: "missing" });
  await write("codex", "printf 'unexpected version\\n'");
  assert.equal((await detectPlatform("codex", env)).status, "unavailable");
  await write("codex", "printf '0.165.0\\n'");
  assert.deepEqual(await detectPlatform("codex", env), { platform: "codex", status: "unverified", version: "0.165.0", previouslyTested: false });
  assert.equal((await detectPlatform("codex", {})).status, "unavailable");
  const earlier = join(dir, "earlier");
  await mkdir(earlier);
  await writeFile(join(earlier, "codex"), "not executable", { mode: 0o644 });
  assert.equal((await detectPlatform("codex", { ...env, PATH: `${earlier}${delimiter}${dir}` })).status, "unverified");
  assert.equal((await detectPlatform("codex", { ...env, PATH: earlier })).status, "unavailable");
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

test("version detection bounds and cancels a client that ignores termination", { skip: process.platform === "win32" }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "git-relay-detect-hung-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const executable = join(dir, "codex");
  await writeFile(executable, "#!/bin/sh\ntrap '' TERM\n/bin/sleep 30 &\nwait\n", { mode: 0o755 });
  const env = { ...process.env, PATH: dir };
  const started = Date.now();
  const result = await detectPlatform("codex", env);
  assert.equal(result.status, "unavailable");
  assert.match("reason" in result ? result.reason : "", /timed out/);
  assert.ok(Date.now() - started < 8000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 100);
  t.after(() => clearTimeout(timer));
  await assert.rejects(detectPlatform("codex", env, controller.signal), { name: "AbortError" });
});
