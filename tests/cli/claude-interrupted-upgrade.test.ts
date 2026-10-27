import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { installClaude } from "../../src/cli/install-claude.ts";

test("Claude recovers successive interrupted upgrades with changed packages", { skip: process.platform === "win32", timeout: 30_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "gitrelay-claude-interrupted-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source"), workspace = join(root, "workspace"), command = join(root, "claude");
  for (const dir of ["dist/cli", "skills/example", "docs"]) await mkdir(join(source, dir), { recursive: true });
  await writeFile(join(root, "package.json"), '{"type":"commonjs","private":true}\n');
  await writeFile(join(source, "package.json"), JSON.stringify({ version: "0.1.0" }));
  await writeFile(join(source, "skills/example/SKILL.md"), "skill");
  await writeFile(join(source, "docs/example.md"), "docs");
  await writeFile(command, `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path');
const file = process.env.FAKE_STATE;
let state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : { markets: [], plugins: [] };
const a = process.argv.slice(2); let out = {};
if (a[1] === 'marketplace' && a[2] === 'list') out = state.markets;
else if (a[1] === 'marketplace' && a[2] === 'add') {
  const market = a[3], manifest = JSON.parse(fs.readFileSync(path.join(market, '.claude-plugin/marketplace.json')));
  state.markets.push({ name: manifest.name, source: 'directory', path: market });
} else if (a[1] === 'list') out = state.plugins.map(p => {
  const market = state.markets.find(m => p.id.endsWith('@' + m.name));
  const manifest = JSON.parse(fs.readFileSync(path.join(market.path, '.claude-plugin/marketplace.json')));
  return { ...p, readFromFolder: path.join(market.path, manifest.plugins[0].source) };
});
else if (a[1] === 'install') state.plugins.push({ id: a[2], scope: 'user', enabled: true });
else throw new Error('unexpected command');
fs.writeFileSync(file, JSON.stringify(state)); console.log(JSON.stringify(out));
`);
  await chmod(command, 0o755);
  const env = { HOME: root, TMPDIR: root, PATH: "/usr/bin:/bin", FAKE_STATE: join(root, "fake-state.json") };
  const options = { workspace, sourceRoot: source, command, env };
  const runtime = join(source, "dist/cli/main.js"), launcher = join(workspace, "claude/launcher.cjs");
  const revisions = join(workspace, "claude/revisions"), journal = join(workspace, "claude/journal.json");
  const setVersion = (value: string) => writeFile(runtime, `console.log(${JSON.stringify(value)})`);
  const runLauncher = () => spawnSync(process.execPath, [launcher], { encoding: "utf8", env });
  const module = new URL("../../src/cli/install-claude.ts", import.meta.url).href;
  const script = `import { installClaude } from ${JSON.stringify(module)}; await installClaude(${JSON.stringify(options)});`;
  const preload = join(root, "fault.mjs");
  async function fault(point: "before" | "after" | "kill") {
    await writeFile(preload, `import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module';
const write = fs.promises.writeFile, rename = fs.promises.rename;
let published = false;
fs.promises.writeFile = async (path, ...args) => {
  if (String(path).startsWith(${JSON.stringify(revisions + "/")})) {
    if (${JSON.stringify(point)} === 'kill') process.kill(process.pid, 'SIGKILL');
    if (${JSON.stringify(point)} === 'before') throw new Error('injected before revision');
    const result = await write.call(fs.promises, path, ...args); published = true; return result;
  }
  return write.call(fs.promises, path, ...args);
};
fs.promises.rename = async (from, to) => {
  if (published && String(to) === ${JSON.stringify(journal)}) throw new Error('injected after revision');
  return rename.call(fs.promises, from, to);
};
syncBuiltinESMExports();`);
    return spawnSync(process.execPath, ["--experimental-strip-types", "--import", pathToFileURL(preload).href, "--input-type=module", "-e", script], { encoding: "utf8", env, timeout: 15_000 });
  }
  const expectLauncher = (version: string) => {
    const result = runLauncher();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), version);
  };

  await setVersion("v1");
  await installClaude(options);
  await installClaude(options);
  await setVersion("v2");
  const after = await fault("after");
  assert.notEqual(after.status, 0); assert.match(after.stderr, /injected after revision/);
  expectLauncher("v2");
  await setVersion("v3");
  const before = await fault("before");
  assert.notEqual(before.status, 0); assert.match(before.stderr, /injected before revision/);
  expectLauncher("v2");
  await installClaude(options);
  expectLauncher("v3");

  await setVersion("v4");
  assert.match((await fault("after")).stderr, /injected after revision/);
  expectLauncher("v4");
  await setVersion("v5");
  const killed = await fault("kill");
  assert.equal(killed.signal, "SIGKILL");
  const lock = join(workspace, "claude/install.lock"), lockData = await readFile(lock, "utf8"), lockInfo = await stat(lock);
  assert.equal(JSON.parse(lockData).pid, killed.pid);
  assert.throws(() => process.kill(killed.pid!, 0), (error: unknown) => (error as NodeJS.ErrnoException).code === "ESRCH");
  assert.equal(await readFile(lock, "utf8"), lockData);
  assert.equal((await stat(lock)).ino, lockInfo.ino);
  await rm(lock);
  expectLauncher("v4");
  await installClaude(options);
  expectLauncher("v5");

  const latest = (await readdir(revisions)).sort().at(-1)!;
  const saved = await readFile(journal, "utf8");
  await writeFile(join(revisions, latest), "foreign");
  await assert.rejects(installClaude(options), /revision was modified/);
  assert.equal(await readFile(join(revisions, latest), "utf8"), "foreign");
  assert.equal(await readFile(journal, "utf8"), saved);
  await writeFile(join(revisions, latest), "");
  const invalid = JSON.parse(saved); invalid.launcher.current = "invalid";
  await writeFile(journal, JSON.stringify(invalid));
  await assert.rejects(installClaude(options), /Invalid Claude launcher state/);
  assert.equal(await readFile(journal, "utf8"), JSON.stringify(invalid));
});
