import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { access, chmod, cp, mkdtemp, mkdir, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { installPi } from "../../src/cli/install-pi.ts";
import { installOpenCode } from "../../src/cli/install-opencode.ts";

const repo = fileURLToPath(new URL("../../", import.meta.url));

async function waitForPids(path: string, earlyExit?: () => string | undefined): Promise<number[]> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try { return (await readFile(path, "utf8")).trim().split(/\s+/).map(Number); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const failure = earlyExit?.();
    if (failure) throw new Error(failure);
    await delay(20);
  }
  throw new Error(`Test process did not start: ${path}`);
}

function assertStopped(pids: number[]): void {
  assert.equal(pids.length, 2);
  for (const pid of pids) {
    assert.ok(Number.isInteger(pid) && pid > 0);
    const state = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" }).stdout.trim();
    assert.ok(!state || state.startsWith("Z"), `process ${pid} is still running: ${state}`);
  }
}

test("PID wait reports a failed CLI immediately with stderr", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "git-relay-cli-start-failure-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const child = spawn(process.execPath, ["-e", "process.stderr.write('startup failed'); process.exitCode = 7"], { stdio: ["ignore", "ignore", "pipe"] });
  let errors = "", finished = false;
  child.stderr.on("data", (chunk) => { errors += String(chunk); });
  const closed = new Promise<void>((resolve, reject) => { child.on("error", reject); child.on("close", () => { finished = true; resolve(); }); });
  const started = Date.now();
  await assert.rejects(waitForPids(join(dir, "missing"), () => finished ? `CLI exited: ${errors}` : undefined), /CLI exited: startup failed/);
  assert.ok(Date.now() - started < 2000);
  await closed;
});

test("pi RPC validation kills a hung process group on cancellation and timeout, preserving the active installation", { skip: process.platform === "win32", timeout: 30_000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "git-relay-pi-cancel-"));
  let running: number[] = [];
  t.after(async () => {
    if (running.length) { try { process.kill(-running[0], "SIGKILL"); } catch {} }
    await rm(dir, { recursive: true, force: true });
  });
  const workspace = join(dir, "workspace"), agent = join(dir, "agent"), sourceRoot = join(dir, "source"), bin = join(dir, "bin"), pidfile = join(dir, "pids");
  await mkdir(workspace); await mkdir(agent); await mkdir(sourceRoot); await mkdir(bin);
  await writeFile(join(workspace, ".git-relay-owner"), "git-relay installer v1\n");
  await mkdir(join(sourceRoot, "skills"));
  for (const path of ["package.json", "src", "skills/worktree-coordination"]) await cp(join(repo, path), join(sourceRoot, path), { recursive: true });
  const settings = '{"theme":"kept","packages":[]}\n';
  await writeFile(join(agent, "settings.json"), settings);
  const fake = join(bin, "pi");
  const script = (reply: boolean) => `#!/bin/sh\ntrap '' TERM\n/bin/sleep 30 &\nprintf '%s %s\\n' "$$" "$!" > "$TEST_PIDS"\n${reply ? `printf '%s\\n' '{"id":"git-relay-install-check","success":true,"data":{"commands":[{"name":"worktree"},{"name":"skill:worktree-coordination"}]}}'\n` : ""}wait\n`;
  await writeFile(fake, script(true), { mode: 0o755 }); await chmod(fake, 0o755);
  const env = { ...process.env, HOME: dir, PI_CODING_AGENT_DIR: agent, PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`, TEST_PIDS: pidfile };
  await installPi({ workspace, sourceRoot, env });
  running = await waitForPids(pidfile); assertStopped(running); running = [];
  const state = await readFile(join(workspace, "pi.json"), "utf8"), entry = await readFile(join(agent, "extensions", "git-relay.ts"), "utf8");
  await writeFile(join(sourceRoot, "src", "next-version"), "new\n");
  await writeFile(fake, script(false)); await rm(pidfile);
  const controller = new AbortController();
  const cancelled = assert.rejects(installPi({ workspace, sourceRoot, env, signal: controller.signal }), { name: "AbortError" });
  running = await waitForPids(pidfile); controller.abort(); await cancelled; assertStopped(running); running = [];
  assert.equal(await readFile(join(workspace, "pi.json"), "utf8"), state);
  assert.equal(await readFile(join(agent, "extensions", "git-relay.ts"), "utf8"), entry);
  assert.equal(await readFile(join(agent, "settings.json"), "utf8"), settings);
  await assert.rejects(access(join(workspace, "pi-install.lock")), { code: "ENOENT" });
  await rm(pidfile);
  const timedOut = assert.rejects(installPi({ workspace, sourceRoot, env }), /Pi runtime validation timed out/);
  running = await waitForPids(pidfile); await timedOut; assertStopped(running); running = [];
  assert.equal(await readFile(join(workspace, "pi.json"), "utf8"), state);
  await assert.rejects(access(join(workspace, "pi-install.lock")), { code: "ENOENT" });
});

test("OpenCode staged import kills a hung process group on cancellation and timeout without switching the active revision", { skip: process.platform === "win32", timeout: 20_000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "git-relay-opencode-cancel-"));
  let running: number[] = [];
  t.after(async () => {
    if (running.length) { try { process.kill(-running[0], "SIGKILL"); } catch {} }
    await rm(dir, { recursive: true, force: true });
  });
  const root = join(dir, "git-relay"), config = join(dir, "config"), source = join(dir, "dist"), pidfile = join(dir, "pids");
  const module = join(source, "adapters", "opencode", "index.js");
  await mkdir(join(source, "adapters", "opencode"), { recursive: true });
  await writeFile(module, "export default { id: 'git-relay', setup() {} };\n");
  await installOpenCode(root, config, source);
  const state = await readFile(join(root, "opencode.json"), "utf8"), entry = join(config, "opencode", "plugins", "git-relay.js"), original = await readFile(entry, "utf8");
  await writeFile(module, `import { spawn } from 'node:child_process';\nimport { writeFileSync } from 'node:fs';\nprocess.on('SIGTERM', () => {});\nconst child = spawn('/bin/sh', ['-c', "trap '' TERM; exec /bin/sleep 30"]);\nwriteFileSync(${JSON.stringify(pidfile)}, process.pid + ' ' + child.pid);\nawait new Promise(() => setInterval(() => {}, 1000));\nexport default { id: 'git-relay', setup() {} };\n`);
  const controller = new AbortController();
  const cancelled = assert.rejects(installOpenCode(root, config, source, controller.signal), { name: "AbortError" });
  running = await waitForPids(pidfile); controller.abort(); await cancelled; assertStopped(running); running = [];
  assert.equal(await readFile(join(root, "opencode.json"), "utf8"), state);
  assert.equal(await readFile(entry, "utf8"), original);
  await assert.rejects(access(join(root, "install.lock")), { code: "ENOENT" });
  await rm(pidfile);
  const timedOut = assert.rejects(installOpenCode(root, config, source), /timed out/);
  running = await waitForPids(pidfile); await timedOut; assertStopped(running); running = [];
  assert.equal(await readFile(join(root, "opencode.json"), "utf8"), state);
  assert.equal(await readFile(entry, "utf8"), original);
  await assert.rejects(access(join(root, "install.lock")), { code: "ENOENT" });
});

test("pi interrupted skill publication keeps its pending journal and resumes without claiming user entries", { skip: process.platform === "win32", timeout: 20_000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "git-relay-pi-ln-cancel-"));
  let running: number[] = [];
  t.after(async () => {
    if (running.length) { try { process.kill(-running[0], "SIGKILL"); } catch {} }
    await rm(dir, { recursive: true, force: true });
  });
  const workspace = join(dir, "workspace"), agent = join(dir, "agent"), sourceRoot = join(dir, "source"), bin = join(dir, "bin"), pidfile = join(dir, "pids");
  await mkdir(workspace); await mkdir(agent); await mkdir(sourceRoot); await mkdir(bin);
  await writeFile(join(workspace, ".git-relay-owner"), "git-relay installer v1\n");
  await mkdir(join(sourceRoot, "skills"));
  for (const path of ["package.json", "src", "skills/worktree-coordination"]) await cp(join(repo, path), join(sourceRoot, path), { recursive: true });
  await mkdir(join(agent, "extensions"));
  const other = join(agent, "extensions", "user.ts");
  await writeFile(other, "user entry\n");
  await writeFile(join(bin, "pi"), `#!/bin/sh\nprintf '%s\\n' '{"id":"git-relay-install-check","success":true,"data":{"commands":[{"name":"worktree"},{"name":"skill:worktree-coordination"}]}}'\n`, { mode: 0o755 });
  await writeFile(join(bin, "ln"), '#!/bin/sh\ntrap "" TERM\n/bin/sleep 30 &\nprintf "%s %s\\n" "$$" "$!" > "$TEST_LN_PIDS"\nwait\n', { mode: 0o755 });
  const env = { ...process.env, HOME: dir, PI_CODING_AGENT_DIR: agent, PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`, TEST_LN_PIDS: pidfile };
  const controller = new AbortController();
  const cancelled = assert.rejects(installPi({ workspace, sourceRoot, env, signal: controller.signal }), { name: "AbortError" });
  running = await waitForPids(pidfile); controller.abort(); await cancelled; assertStopped(running); running = [];
  const pending = JSON.parse(await readFile(join(workspace, "pi.json"), "utf8"));
  assert.ok(pending.pending); assert.equal(pending.current, null);
  assert.equal(await readFile(other, "utf8"), "user entry\n");
  await assert.rejects(access(join(workspace, "pi-install.lock")), { code: "ENOENT" });
  await rm(pidfile);
  const timedOut = assert.rejects(installPi({ workspace, sourceRoot, env }), /timed out/);
  running = await waitForPids(pidfile); await timedOut; assertStopped(running); running = [];
  assert.equal(JSON.parse(await readFile(join(workspace, "pi.json"), "utf8")).pending, pending.pending);
  await rm(join(bin, "ln"));
  await installPi({ workspace, sourceRoot, env });
  const recovered = JSON.parse(await readFile(join(workspace, "pi.json"), "utf8"));
  assert.equal(recovered.current, pending.pending); assert.equal(recovered.pending, undefined);
  assert.match(await readFile(join(agent, "extensions", "git-relay.ts"), "utf8"), /pi-loader/);
  assert.ok((await readlink(join(agent, "skills", "worktree-coordination"))).includes(recovered.current.slice(21)));
  assert.equal(await readFile(other, "utf8"), "user entry\n");
});

test("CLI SIGINT reaches pi and OpenCode validation and reports cancellation", { skip: process.platform === "win32", timeout: 20_000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "git-relay-install-sigint-"));
  let clientGroup = 0, validationGroup = 0;
  t.after(async () => {
    for (const pid of [clientGroup, validationGroup]) if (pid) { try { process.kill(-pid, "SIGKILL"); } catch {} }
    await rm(dir, { recursive: true, force: true });
  });
  const source = join(dir, "snapshot"), bin = join(dir, "bin"), pidfile = join(dir, "pids");
  await mkdir(source); await mkdir(bin); await cp(join(repo, "src"), join(source, "src"), { recursive: true });
  await mkdir(join(source, "vendor")); await cp(join(repo, "vendor", "smol-toml"), join(source, "vendor", "smol-toml"), { recursive: true });
  await writeFile(join(source, "package.json"), '{"type":"module"}\n');
  const fakePi = join(bin, "pi"), fakeOpenCode = join(bin, "opencode");
  await writeFile(fakePi, '#!/bin/sh\nif [ "$1" = "--version" ]; then printf "1.4.0\\n"; exit 0; fi\ntrap "" TERM\n/bin/sleep 30 &\nprintf "%s %s\\n" "$$" "$!" > "$TEST_PIDS"\nwait\n', { mode: 0o755 });
  await writeFile(fakeOpenCode, '#!/bin/sh\nprintf "2.1.2\\n"\n', { mode: 0o755 });
  await mkdir(join(source, "dist", "adapters", "opencode"), { recursive: true });
  await writeFile(join(source, "dist", "adapters", "opencode", "index.js"), `import { spawn } from 'node:child_process';\nimport { writeFileSync } from 'node:fs';\nprocess.on('SIGTERM', () => {});\nconst child = spawn('/bin/sh', ['-c', "trap '' TERM; exec /bin/sleep 30"]);\nwriteFileSync(process.env.TEST_PIDS, process.pid + ' ' + child.pid);\nawait new Promise(() => setInterval(() => {}, 1000));\nexport default { id: 'git-relay', setup() {} };\n`);
  for (const platform of ["pi", "opencode"]) {
    const home = join(dir, platform), agent = join(home, "agent");
    await mkdir(home); await mkdir(agent);
    await writeFile(join(agent, "settings.json"), '{"theme":"kept","packages":[]}\n');
    const env = { ...process.env, HOME: home, PI_CODING_AGENT_DIR: agent, XDG_DATA_HOME: join(home, "data"), XDG_CONFIG_HOME: join(home, "config"), PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`, TEST_PIDS: pidfile };
    if (platform === "pi") {
      await mkdir(join(source, "skills"));
      await cp(join(repo, "skills", "worktree-coordination"), join(source, "skills", "worktree-coordination"), { recursive: true });
    }
    const child = spawn(process.execPath, ["--experimental-strip-types", join(source, "src", "cli", "main.ts"), "install", "--platform", platform], { env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    clientGroup = child.pid!;
    let output = "", errors = "";
    child.stdout.on("data", (chunk) => { output += String(chunk); });
    child.stderr.on("data", (chunk) => { errors += String(chunk); });
    let finished = false, spawnError: Error | undefined, exitCode: number | null = null;
    child.on("error", (error) => { spawnError = error; });
    const closed = new Promise<number | null>((resolve) => { child.on("close", (code) => { finished = true; exitCode = code; resolve(code); }); });
    const pids = await waitForPids(pidfile, () => spawnError || finished ? `CLI exited before validation (${spawnError?.message ?? exitCode}): ${errors}` : undefined); validationGroup = pids[0];
    child.kill("SIGINT");
    assert.equal(await closed, 130, errors); clientGroup = 0;
    assert.equal(output, ""); assert.match(errors, /operation may have completed.*uninstall --dry-run/); assertStopped(pids); validationGroup = 0;
    assert.equal(await readFile(join(agent, "settings.json"), "utf8"), '{"theme":"kept","packages":[]}\n');
    await assert.rejects(access(join(home, "data", "git-relay", platform === "pi" ? "pi-install.lock" : "install.lock")), { code: "ENOENT" });
    await rm(pidfile);
  }
});

test("CLI cancellation after OpenCode publication reports uncertainty after safely finishing install and uninstall", { skip: process.platform === "win32", timeout: 20_000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "git-relay-commit-sigint-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const source = join(dir, "snapshot"), bin = join(dir, "bin"), home = join(dir, "home");
  await mkdir(source); await mkdir(bin); await mkdir(home);
  await cp(join(repo, "src"), join(source, "src"), { recursive: true });
  await mkdir(join(source, "vendor")); await cp(join(repo, "vendor", "smol-toml"), join(source, "vendor", "smol-toml"), { recursive: true });
  await writeFile(join(source, "package.json"), '{"type":"module"}\n');
  await mkdir(join(source, "dist", "adapters", "opencode"), { recursive: true });
  await writeFile(join(source, "dist", "adapters", "opencode", "index.js"), "export default { id: 'git-relay', setup() {} };\n");
  await writeFile(join(bin, "opencode"), '#!/bin/sh\nprintf "2.1.2\\n"\n', { mode: 0o755 });
  const preload = join(dir, "signal-after-publication.mjs");
  await writeFile(preload, `import fs from 'node:fs/promises';\nimport { syncBuiltinESMExports } from 'node:module';\nconst write = fs.writeFile, rename = fs.rename; let fired = false;\nasync function interrupt() { fired = true; process.kill(process.pid, 'SIGINT'); await new Promise(r => setTimeout(r, 50)); }\nfs.writeFile = async (...args) => { const result = await write(...args); if (!fired && process.env.TEST_PHASE === 'install' && String(args[0]).includes('/opencode-revisions/')) await interrupt(); return result; };\nfs.rename = async (...args) => { const result = await rename(...args); if (!fired && process.env.TEST_PHASE === 'uninstall' && String(args[1]).includes('/.git-relay-removed-')) await interrupt(); return result; };\nsyncBuiltinESMExports();\n`);
  const env = { ...process.env, HOME: home, XDG_DATA_HOME: join(home, "data"), XDG_CONFIG_HOME: join(home, "config"), PATH: `${bin}${delimiter}${process.env.PATH ?? ""}` };
  const main = join(source, "src", "cli", "main.ts"), root = join(env.XDG_DATA_HOME, "git-relay"), entry = join(env.XDG_CONFIG_HOME, "opencode", "plugins", "git-relay.js");
  for (const phase of ["install", "uninstall"]) {
    const child = spawnSync(process.execPath, ["--experimental-strip-types", "--import", preload, main, phase, "--platform", "opencode"], { env: { ...env, TEST_PHASE: phase }, encoding: "utf8", timeout: 10_000 });
    assert.equal(child.status, 130, child.stderr);
    assert.equal(child.stdout, "");
    assert.match(child.stderr, /operation may have completed.*uninstall --dry-run/);
    const state = JSON.parse(await readFile(join(root, "opencode.json"), "utf8"));
    assert.equal(state.pending, undefined);
    assert.equal(state.removed === true, phase === "uninstall");
    if (phase === "install") assert.ok(await readFile(entry, "utf8"));
    else { await assert.rejects(access(entry), { code: "ENOENT" }); assert.ok(await readFile(state.archive, "utf8")); }
    await assert.rejects(access(join(root, "install.lock")), { code: "ENOENT" });
    const preview = spawnSync(process.execPath, ["--experimental-strip-types", main, "uninstall", "--platform", "opencode", "--dry-run"], { env, encoding: "utf8", timeout: 10_000 });
    assert.equal(preview.status, 0, preview.stderr);
    assert.equal(JSON.parse(preview.stdout).results.find((item: { platform: string }) => item.platform === "opencode").status, phase === "install" ? "would-check-and-remove" : "not-managed");
  }
});
