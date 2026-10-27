import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { installClaude, uninstallClaude } from "../../src/cli/install-claude.ts";

async function waitForFile(path: string, exited?: () => string | undefined, timeout = 10000): Promise<string> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { return await readFile(path, "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const outcome = exited?.();
    if (outcome) throw new Error(`Process exited before creating ${path}: ${outcome}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${path}`);
}

async function waitForPid(path: string, exited?: () => string | undefined, timeout?: number): Promise<number> {
  const contents = (await waitForFile(path, exited, timeout)).trim();
  if (!/^[1-9]\d*$/.test(contents) || !Number.isSafeInteger(Number(contents))) throw new Error(`Invalid PID in ${path}`);
  return Number(contents);
}

async function waitForGroupGone(pid: number, timeout = 5000): Promise<void> {
  const deadline = Date.now() + timeout;
  let lastPermissionError: unknown;
  while (Date.now() < deadline) {
    try { process.kill(-pid, 0); lastPermissionError = undefined; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
      if ((error as NodeJS.ErrnoException).code !== "EPERM") throw new Error(`Cannot inspect process group ${pid}`, { cause: error });
      lastPermissionError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  if (lastPermissionError) throw new Error(`Cannot inspect process group ${pid}: EPERM persisted`, { cause: lastPermissionError });
  throw new Error(`Process group ${pid} did not exit`);
}

test("process-group wait requires ESRCH after a transient permission error", async () => {
  const kill = process.kill;
  const signals: Array<string | number | undefined> = [];
  process.kill = ((pid, signal) => {
    assert.equal(pid, -12345);
    signals.push(signal);
    throw Object.assign(new Error("injected"), { code: signals.length < 3 ? "EPERM" : "ESRCH" });
  }) as typeof process.kill;
  try { await waitForGroupGone(12345, 500); assert.deepEqual(signals, [0, 0, 0]); }
  finally { process.kill = kill; }
});

test("process-group wait reports persistent permission errors", async () => {
  const kill = process.kill;
  const failure = Object.assign(new Error("injected"), { code: "EPERM" });
  process.kill = (() => { throw failure; }) as typeof process.kill;
  try { await assert.rejects(waitForGroupGone(12345, 75), (error: Error) => error.message.includes("EPERM persisted") && error.cause === failure); }
  finally { process.kill = kill; }
});

function testEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (name.startsWith("GITRELAY_") || name.startsWith("FAKE_")) delete env[name];
  return env;
}

test("PID wait reports an early process exit with diagnostics", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "git-relay-pid-wait-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const child = spawn(process.execPath, ["-e", "process.stderr.write('probe failure'); process.exitCode = 7"]);
  let stderr = "", outcome: string | undefined;
  child.stdout.resume(); child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  child.once("exit", (code, signal) => { outcome = `code=${code}, signal=${signal}`; });
  const closed = new Promise<void>((resolve, reject) => { child.once("error", reject); child.once("close", () => resolve()); });
  try {
    await assert.rejects(waitForFile(join(root, "missing"), () => outcome ? `${outcome}, stderr=${stderr}` : undefined), /code=7.*probe failure/);
  } finally {
    child.kill("SIGKILL");
    await closed;
  }
});

test("PID wait rejects an empty published PID", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "git-relay-invalid-pid-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "pid");
  await writeFile(path, "");
  await assert.rejects(waitForPid(path), /Invalid PID/);
});

async function exerciseCancellation(t: import("node:test").TestContext, mode: "timeout" | "interrupt", fault?: "empty-pid" | "kill-before-ipc", observe?: (pid: number) => void): Promise<void> {
    const root = await mkdtemp(join(tmpdir(), `git-relay-claude-${mode}-`));
    t.after(() => rm(root, { recursive: true, force: true }));
    const bin = join(root, "bin"), data = join(root, "data"), workspace = join(data, "git-relay");
    await mkdir(bin, { recursive: true });
    const pidFile = join(root, "pid"), childFile = join(root, "child"), armedFile = join(root, "timeout-armed"), settings = join(root, "settings.json");
    await writeFile(settings, "user settings\n");
    const command = join(bin, "claude");
    const parentValue = fault === "empty-pid" ? "''" : '"$$"';
    await writeFile(command, `#!/bin/sh\nif [ "$1" = --version ]; then printf '2.1.310\\n'; exit 0; fi\npublish() { (umask 077; set -C; printf '%s\\n' "$2" > "$1.tmp") || exit 1; /bin/ln "$1.tmp" "$1" || exit 1; /bin/rm "$1.tmp"; }\npublish "$GITRELAY_GROUP_WITNESS" "$$"\n( while [ "$(/bin/ps -o ppid= -p "$$" | /usr/bin/tr -d '[:space:]')" = "$GITRELAY_CONTROLLER_PID" ]; do /bin/sleep 0.1; done; /bin/kill -KILL -- "-$$" 2>/dev/null ) &\n${mode === "timeout" ? "/bin/sleep 1\n" : ""}trap '' TERM\npublish "$GITRELAY_PARENT_PID" ${parentValue}\n/bin/sh -c 'trap "" TERM; (umask 077; set -C; printf "%s\\n" "$$" > "$GITRELAY_CHILD_PID.tmp") || exit 1; /bin/ln "$GITRELAY_CHILD_PID.tmp" "$GITRELAY_CHILD_PID" || exit 1; /bin/rm "$GITRELAY_CHILD_PID.tmp"; while :; do /bin/sleep 1; done' &\nwait\n`, { mode: 0o755 });
    const env = { ...testEnvironment(), XDG_DATA_HOME: data, PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`, GITRELAY_PARENT_PID: pidFile, GITRELAY_CHILD_PID: childFile, GITRELAY_GROUP_WITNESS: join(root, "shell-witness") };
    const module = pathToFileURL(fileURLToPath(new URL("../../src/cli/install-claude.ts", import.meta.url))).href;
    // Trigger the timeout callback only after both fixture processes have started.
    const timeoutScript = `import { writeFileSync } from 'node:fs';
const original = globalThis.setTimeout;
globalThis.setTimeout = (fn, delay, ...args) => {
  if (delay !== 30000) return original(fn, delay, ...args);
  const timer = original(fn, delay, ...args);
  process.once('SIGUSR2', () => { clearTimeout(timer); fn(...args); });
  writeFileSync(${JSON.stringify(armedFile)}, 'armed', { flag: 'wx' });
  return timer;
};
const { installClaude } = await import(${JSON.stringify(module)});
try { await installClaude({ workspace: ${JSON.stringify(workspace)}, sourceRoot: ${JSON.stringify(root)} }); process.exitCode = 1; }
catch (error) { if (!String(error).includes('Command timed out')) throw error; }`;
    const preload = join(root, "spawn-witness.mjs");
    await writeFile(preload, `import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const spawn = childProcess.spawn;
childProcess.spawn = (...args) => {
  if (args[0] === 'claude' && args[1]?.[0] === 'plugin') args[2] = { ...args[2], env: { ...args[2]?.env, GITRELAY_CONTROLLER_PID: String(process.pid) } };
  const child = spawn(...args);
  if (args[0] === 'claude' && args[1]?.[0] === 'plugin' && child.pid) {
    if (${fault === "kill-before-ipc"}) process.kill(process.pid, 'SIGKILL');
    process.send({ group: child.pid });
  }
  return child;
};
syncBuiltinESMExports();
`);
    const cli = fileURLToPath(new URL("../../src/cli/main.ts", import.meta.url));
    const args = mode === "timeout" ? ["--import", pathToFileURL(preload).href, "--experimental-strip-types", "--input-type=module", "-e", timeoutScript] : ["--import", pathToFileURL(preload).href, "--experimental-strip-types", cli, "install", "--platform", "claude-code"];
    const processUnderTest = spawn(process.execPath, args, { env, stdio: ["ignore", "pipe", "pipe", "ipc"] });
    let stderr = "", outcome: string | undefined;
    processUnderTest.stdout!.resume(); processUnderTest.stderr!.on("data", (chunk) => { stderr += String(chunk); });
    processUnderTest.once("exit", (code, signal) => { outcome = `code=${code}, signal=${signal}`; });
    processUnderTest.once("error", (error) => { outcome = `spawn error: ${error.message}`; });
    const finished = new Promise<number | null>((resolve, reject) => { processUnderTest.once("error", reject); processUnderTest.once("close", resolve); });
    const witness = Promise.withResolvers<number>();
    let witnessed = 0;
    processUnderTest.on("message", (message: unknown) => {
      const pid = (message as { group?: unknown })?.group;
      if (typeof pid === "number" && Number.isSafeInteger(pid) && pid > 0) { witnessed = pid; witness.resolve(pid); }
    });
    // The process may fail before either PID file appears; preserve its diagnostics.
    const exited = () => outcome ? `${outcome}, stderr=${stderr}` : undefined;
    let group = 0, stopped = false;
    try {
      let witnessTimer: ReturnType<typeof setTimeout> | undefined;
      group = await Promise.race([
        witness.promise,
        finished.then(() => { throw new Error(`Process exited before publishing its group: ${exited()}`); }),
        new Promise<never>((_, reject) => { witnessTimer = setTimeout(() => reject(new Error("No process-group witness")), 10000); }),
      ]).finally(() => clearTimeout(witnessTimer));
      observe?.(group);
      assert.equal(await waitForPid(pidFile, exited), group);
      const child = await waitForPid(childFile, exited);
      assert.ok(child > 0);
      if (mode === "interrupt") processUnderTest.kill("SIGINT");
      else {
        await waitForFile(armedFile, exited);
        processUnderTest.kill("SIGUSR2");
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const code = await Promise.race([finished, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Installer did not exit")), 5000); })]).finally(() => clearTimeout(timer));
      assert.equal(code, mode === "interrupt" ? 130 : 0);
      await waitForGroupGone(group);
      stopped = true;
      await assert.rejects(readFile(join(workspace, "claude", "install.lock")), { code: "ENOENT" });
      assert.equal(await readFile(settings, "utf8"), "user settings\n");
    } finally {
      if (!stopped) {
        processUnderTest.kill("SIGKILL");
        if (!group) group = witnessed;
        if (!group) try { group = await waitForPid(env.GITRELAY_GROUP_WITNESS, undefined, 2000); } catch { /* The fixture may not have spawned yet. */ }
        if (group) observe?.(group);
        if (group > 0) try { process.kill(-group, "SIGKILL"); } catch { /* Already exited. */ }
        await finished.catch(() => {});
        if (group > 0) await waitForGroupGone(group);
      }
    }
}

test("Claude inspection timeout and CLI SIGINT kill a hung process group", { skip: process.platform === "win32", timeout: 30000 }, async (t) => {
  for (const mode of ["timeout", "interrupt"] as const) await exerciseCancellation(t, mode);
});

test("the fixture self-cleans if its controller dies before the IPC witness", { skip: process.platform === "win32", timeout: 20000 }, async (t) => {
  let group = 0;
  await assert.rejects(exerciseCancellation(t, "timeout", "kill-before-ipc", (pid) => { group = pid; }), /Process exited before publishing its group/);
  assert.ok(group > 0);
  await waitForGroupGone(group);
});

test("a malformed PID file still cleans the witnessed process group", { skip: process.platform === "win32", timeout: 20000 }, async (t) => {
  let group = 0;
  await assert.rejects(exerciseCancellation(t, "timeout", "empty-pid", (pid) => { group = pid; }), /Invalid PID/);
  assert.ok(group > 0);
  await waitForGroupGone(group);
});

test("fixture ignores external test variables and preserves their files", { skip: process.platform === "win32", timeout: 30000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "git-relay-env-sentinel-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const names = ["GITRELAY_TEST_WITNESS_PATH", "GITRELAY_TEST_SHELL_WITNESS_PATH", "GITRELAY_PARENT_PID", "GITRELAY_CHILD_PID", "GITRELAY_GROUP_WITNESS", "FAKE_READY", "FAKE_STATE"];
  const paths = Object.fromEntries(names.map((name) => [name, join(root, name)]));
  for (const path of Object.values(paths)) {
    await writeFile(path, "preserve", { flag: "wx" });
    await writeFile(`${path}.tmp`, "preserve temporary", { flag: "wx" });
  }
  const child = spawn(process.execPath, ["--experimental-strip-types", "--test", "--test-name-pattern=^Claude inspection timeout", fileURLToPath(import.meta.url)], {
    env: { ...testEnvironment(), NODE_TEST_CONTEXT: undefined, ...paths, GITRELAY_TEST_BAD_PID: "1", GITRELAY_TEST_KILL_BEFORE_IPC: "1" },
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += String(chunk); });
  child.stderr.on("data", (chunk) => { output += String(chunk); });
  const code = await new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
  assert.equal(code, 0, output);
  for (const path of Object.values(paths)) {
    assert.equal(await readFile(path, "utf8"), "preserve");
    assert.equal(await readFile(`${path}.tmp`, "utf8"), "preserve temporary");
  }
});

test("Claude retries after cancellation when the host already installed the plugin", { skip: process.platform === "win32", timeout: 30000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "git-relay-claude-unknown-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source");
  for (const path of ["dist/cli", "skills/example", "docs"]) await mkdir(join(source, path), { recursive: true });
  await writeFile(join(source, "package.json"), JSON.stringify({ version: "0.1.0" }));
  await writeFile(join(source, "dist/cli/main.js"), "console.log('help')");
  await writeFile(join(source, "skills/example/SKILL.md"), "skill");
  await writeFile(join(source, "docs/example.md"), "docs");
  const command = join(root, "claude"), state = join(root, "host.json"), ready = join(root, "ready");
  await writeFile(command, `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path');
const statePath = process.env.FAKE_STATE;
const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath)) : { markets: [], plugins: [] };
const publishReady = () => { const tmp = process.env.FAKE_READY + '.tmp'; fs.writeFileSync(tmp, String(process.pid), {flag:'wx'}); fs.linkSync(tmp, process.env.FAKE_READY); fs.unlinkSync(tmp); };
const a = process.argv.slice(2); let out = {};
if (a[1] === 'marketplace' && a[2] === 'list') out = state.markets;
else if (a[1] === 'marketplace' && a[2] === 'add') { const market = a[3]; const manifest = JSON.parse(fs.readFileSync(path.join(market, '.claude-plugin/marketplace.json'))); state.markets.push({name: manifest.name, source: 'directory', path: market}); }
else if (a[1] === 'list') out = state.plugins.map(p => { const market = state.markets.find(m => p.id.endsWith('@' + m.name)); const manifest = JSON.parse(fs.readFileSync(path.join(market.path, '.claude-plugin/marketplace.json'))); return {...p, readFromFolder: path.join(market.path, manifest.plugins[0].source)}; });
else if (a[1] === 'install') { state.plugins.push({id: a[2], scope: 'user', enabled: true}); fs.writeFileSync(statePath, JSON.stringify(state)); if (process.env.FAKE_HANG) { publishReady(); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); return; } }
else if (a[1] === 'uninstall') { state.plugins = state.plugins.filter(p => p.id !== a[2]); fs.writeFileSync(statePath, JSON.stringify(state)); if (process.env.FAKE_HANG_UNINSTALL) { publishReady(); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); return; } }
else process.exit(2);
fs.writeFileSync(statePath, JSON.stringify(state)); console.log(JSON.stringify(out));
`, { mode: 0o755 });
  const env = { ...testEnvironment(), FAKE_STATE: state, FAKE_READY: ready, FAKE_HANG: "1", FAKE_HANG_UNINSTALL: "" };
  const controller = new AbortController();
  const options = { workspace: join(root, "workspace"), sourceRoot: source, command, env, signal: controller.signal };
  const pending = installClaude(options);
  try {
    const pid = await waitForPid(ready);
    controller.abort();
    await assert.rejects(pending, { name: "AbortError" });
    await waitForGroupGone(pid);
    const retried = await installClaude({ ...options, env: { ...env, FAKE_HANG: "" }, signal: undefined });
    assert.equal(retried.enabled, true);
    assert.equal(JSON.parse(await readFile(state, "utf8")).plugins.length, 1);
    await assert.rejects(readFile(join(options.workspace, "claude", "install.lock")), { code: "ENOENT" });
    await rm(ready);
    const removeController = new AbortController();
    const removal = uninstallClaude({ ...options, env: { ...env, FAKE_HANG: "", FAKE_HANG_UNINSTALL: "1" }, signal: removeController.signal });
    try {
      const removePid = await waitForPid(ready);
      removeController.abort();
      await assert.rejects(removal, { name: "AbortError" });
      await waitForGroupGone(removePid);
      assert.deepEqual(await uninstallClaude({ ...options, env: { ...env, FAKE_HANG: "" }, signal: undefined }), { removed: false, retainedMarketplace: true });
      assert.equal(JSON.parse(await readFile(state, "utf8")).plugins.length, 0);
    } finally {
      removeController.abort();
      await removal.catch(() => {});
    }
  } finally {
    controller.abort();
    await pending.catch(() => {});
  }
});
