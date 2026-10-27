import assert from "node:assert/strict";
import { chmod, link, mkdir, mkdtemp, readFile, readdir, readlink, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { installClaude, uninstallClaude } from "../../src/cli/install-claude.ts";

test("Claude uninstall reports a dangling installation directory without modifying it", { skip: process.platform === "win32" }, async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "git-relay-claude-dangling-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const directory = join(workspace, "claude");
  await symlink("missing", directory, "dir");
  await assert.rejects(uninstallClaude({ workspace }), /Invalid Claude installation directory/);
  assert.equal(await readlink(directory), "missing");
});

test("Claude installation recovers an unknown result and preserves user changes", { skip: process.platform === "win32" }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "git-relay-claude-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source");
  for (const path of ["dist/cli", "skills/example", "docs"]) await mkdir(join(source, path), { recursive: true });
  await writeFile(join(source, "package.json"), JSON.stringify({ version: "0.1.0" }));
  await writeFile(join(source, "dist/cli/main.js"), "console.log('v1')");
  await writeFile(join(source, "skills/example/SKILL.md"), "skill");
  await writeFile(join(source, "docs/example.md"), "docs");
  const script = join(root, "claude");
  await writeFile(script, `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const statePath = process.env.FAKE_STATE;
let state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath)) : { markets: [], plugins: [], failed: false, other: 'preserved' };
const a = process.argv.slice(2);
let out = {};
if (a[1] === 'marketplace' && a[2] === 'list') out = state.markets;
else if (a[1] === 'marketplace' && a[2] === 'add') {
  const market = a[3], manifest = JSON.parse(fs.readFileSync(path.join(market, '.claude-plugin/marketplace.json')));
  state.markets.push({ name: manifest.name, source: 'directory', path: market });
  if (!state.failed) { state.failed = true; fs.writeFileSync(statePath, JSON.stringify(state)); process.exit(1); }
} else if (a[1] === 'list') out = state.plugins.map(p => {
  const market = state.markets.find(m => p.id.endsWith('@' + m.name));
  const manifest = JSON.parse(fs.readFileSync(path.join(market.path, '.claude-plugin/marketplace.json')));
  return { ...p, readFromFolder: path.join(market.path, manifest.plugins[0].source) };
});
else if (a[1] === 'install') state.plugins.push({ id: a[2], scope: 'user', enabled: true });
else if (a[1] === 'uninstall') state.plugins = state.plugins.filter(p => p.id !== a[2]);
else process.exit(2);
fs.writeFileSync(statePath, JSON.stringify(state));
console.log(JSON.stringify(out));
`);
  await chmod(script, 0o755);
  const env = { ...process.env, FAKE_STATE: join(root, "fake-state.json") };
  const options = { workspace: join(root, "workspace"), sourceRoot: source, command: script, env };
  const concurrent = await Promise.allSettled([installClaude(options), installClaude(options)]);
  assert.equal(concurrent.filter((result) => result.status === "rejected").length, 1);
  const successful = concurrent.find((result) => result.status === "fulfilled");
  assert.ok(successful && successful.status === "fulfilled");
  const first = successful.value;
  assert.equal(first.enabled, true);
  assert.equal((await installClaude(options)).id, first.id);
  const manifest = join(options.workspace, "claude/marketplace/.claude-plugin/marketplace.json");
  const before = await readFile(manifest, "utf8");
  await writeFile(join(source, "dist/cli/main.js"), "console.log('v2')");
  const alternateNode = join(root, "alternate-node");
  await link(process.execPath, alternateNode);
  const upgrade = `import { installClaude } from ${JSON.stringify(new URL("../../src/cli/install-claude.ts", import.meta.url).href)}; await installClaude(${JSON.stringify(options)});`;
  const changedNode = spawnSync(alternateNode, ["--experimental-strip-types", "--input-type=module", "-e", upgrade], { encoding: "utf8" });
  assert.equal(changedNode.status, 0, changedNode.stderr);
  assert.equal((await installClaude(options)).id, first.id);
  assert.equal(await readFile(manifest, "utf8"), before);
  const launcher = join(options.workspace, "claude/launcher.cjs");
  const run = spawnSync(process.execPath, [launcher, "hook", "claude-code"], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), "v2");
  const hooksPath = join(options.workspace, "claude/marketplace", JSON.parse(before).plugins[0].source, "hooks/hooks.json");
  const hooksText = await readFile(hooksPath, "utf8");
  const hooks = JSON.parse(hooksText);
  for (const entries of Object.values(hooks.hooks) as { hooks: { command: string }[] }[][]) {
    for (const entry of entries) for (const hook of entry.hooks) assert.equal(hook.command, process.execPath);
  }
  const journalPath = join(options.workspace, "claude/journal.json");
  const journalText = await readFile(journalPath, "utf8");
  const missingNodeState = JSON.parse(journalText);
  missingNodeState.launcher.node = alternateNode;
  for (const entries of Object.values(hooks.hooks) as { hooks: { command: string }[] }[][]) {
    for (const entry of entries) for (const hook of entry.hooks) hook.command = alternateNode;
  }
  await writeFile(hooksPath, JSON.stringify(hooks));
  await writeFile(journalPath, JSON.stringify(missingNodeState));
  await rm(alternateNode);
  await assert.rejects(installClaude(options), /Node executable is unavailable or incompatible/);
  assert.equal(await readFile(journalPath, "utf8"), JSON.stringify(missingNodeState));
  assert.equal(await readFile(hooksPath, "utf8"), JSON.stringify(hooks));
  await writeFile(journalPath, journalText);
  await writeFile(hooksPath, hooksText);
  await writeFile(join(source, "skills/example/SKILL.md"), "changed skill");
  await assert.rejects(installClaude(options), /skill changes require manual plugin migration/);
  await writeFile(join(source, "skills/example/SKILL.md"), "skill");
  const installedSkill = join(options.workspace, "claude/marketplace", JSON.parse(before).plugins[0].source, "skills/example/SKILL.md");
  await writeFile(installedSkill, "USER_SKILL_EDIT");
  await assert.rejects(installClaude(options), /Installed Claude skills were modified; preserved/);
  assert.equal(await readFile(installedSkill, "utf8"), "USER_SKILL_EDIT");
  await writeFile(installedSkill, "skill");
  const installedHooks = join(options.workspace, "claude/marketplace", JSON.parse(before).plugins[0].source, "hooks/hooks.json");
  const savedHooks = await readFile(installedHooks, "utf8");
  await writeFile(installedHooks, JSON.stringify({ hooks: {} }));
  await assert.rejects(installClaude(options), /plugin metadata was modified; preserved/);
  assert.equal(await readFile(installedHooks, "utf8"), JSON.stringify({ hooks: {} }));
  await writeFile(installedHooks, savedHooks);
  await writeFile(join(source, "dist/cli/main.js"), "import './missing.js'");
  await assert.rejects(installClaude(options));
  assert.equal(spawnSync(process.execPath, [launcher], { encoding: "utf8" }).stdout.trim(), "v2");
  await writeFile(join(source, "dist/cli/main.js"), "console.log('v3')");
  const preload = join(root, "revision-failure.mjs");
  await writeFile(preload, `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const original = fs.promises.writeFile;
fs.promises.writeFile = async (path, ...args) => {
  if (String(path).includes('/revisions/')) throw new Error('injected revision failure');
  return original(path, ...args);
};
syncBuiltinESMExports();
`);
  const interrupted = join(root, "interrupted.mjs");
  await writeFile(interrupted, `import { installClaude } from ${JSON.stringify(new URL("../../src/cli/install-claude.ts", import.meta.url).href)};
try { await installClaude(${JSON.stringify(options)}); process.exitCode = 1; } catch (error) { if (!String(error).includes('injected revision failure')) throw error; }
`);
  const failure = spawnSync(process.execPath, ["--experimental-strip-types", "--import", pathToFileURL(preload).href, interrupted], { encoding: "utf8" });
  assert.equal(failure.status, 0, failure.stderr);
  assert.equal(spawnSync(process.execPath, [launcher], { encoding: "utf8" }).stdout.trim(), "v2");
  await installClaude(options);
  assert.equal(spawnSync(process.execPath, [launcher], { encoding: "utf8" }).stdout.trim(), "v3");
  await writeFile(join(source, "dist/cli/main.js"), "console.log('v4')");
  const afterMarker = join(root, "after-marker.mjs");
  await writeFile(afterMarker, `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const write = fs.promises.writeFile, rename = fs.promises.rename;
let published = false;
fs.promises.writeFile = async (path, ...args) => { const result = await write(path, ...args); if (String(path).includes('/revisions/')) published = true; return result; };
fs.promises.rename = async (from, to) => { if (published && String(to).endsWith('/journal.json')) throw new Error('injected final journal failure'); return rename(from, to); };
syncBuiltinESMExports();
`);
  const interruptedAfter = spawnSync(process.execPath, ["--experimental-strip-types", "--import", pathToFileURL(afterMarker).href, interrupted], { encoding: "utf8" });
  assert.notEqual(interruptedAfter.status, 0);
  assert.match(interruptedAfter.stderr, /injected final journal failure/);
  assert.equal(spawnSync(process.execPath, [launcher], { encoding: "utf8" }).stdout.trim(), "v4");
  await installClaude(options);
  assert.equal(spawnSync(process.execPath, [launcher], { encoding: "utf8" }).stdout.trim(), "v4");
  const launcherText = await readFile(launcher, "utf8");
  await writeFile(launcher, "USER_EDIT");
  await assert.rejects(installClaude(options), /launcher was modified; preserved/);
  assert.equal(await readFile(launcher, "utf8"), "USER_EDIT");
  await writeFile(launcher, launcherText);
  const revisions = join(options.workspace, "claude/revisions");
  const revisionNames = (await readdir(revisions)).sort();
  const newest = revisionNames.at(-1)!;
  const concurrentRead = join(root, "concurrent-read.cjs");
  await writeFile(concurrentRead, `const fs = require('node:fs');
const read = fs.readFileSync; let stale = true;
fs.readFileSync = function(path, ...args) { const value = read.call(this, path, ...args); if (stale && String(path).endsWith('/journal.json')) { stale = false; const state = JSON.parse(value); state.launcher.current = ${JSON.stringify(revisionNames.at(-2))}; delete state.launcher.pending; return JSON.stringify(state); } return value; };
`);
  const racingHook = spawnSync(process.execPath, ["--require", concurrentRead, launcher], { encoding: "utf8" });
  assert.equal(racingHook.status, 0, racingHook.stderr);
  assert.equal(racingHook.stdout.trim(), "v4");
  await rm(join(revisions, newest));
  assert.notEqual(spawnSync(process.execPath, [launcher], { encoding: "utf8" }).status, 0);
  await assert.rejects(installClaude(options), /revisions changed outside GitRelay/);
  await writeFile(join(revisions, newest), "");
  const journal = join(options.workspace, "claude/journal.json");
  const savedJournal = await readFile(journal, "utf8");
  const legacy = JSON.parse(savedJournal);
  delete legacy.launcher;
  await writeFile(journal, JSON.stringify(legacy));
  await assert.rejects(installClaude(options), /upgrade is not supported.*preserved/);
  assert.equal(await readFile(manifest, "utf8"), before);
  await writeFile(journal, savedJournal);
  await writeFile(join(source, "dist/cli/main.js"), "console.log('v1')");
  const state = JSON.parse(await readFile(env.FAKE_STATE, "utf8"));
  assert.equal(state.markets.length, 1);
  assert.equal(state.plugins.length, 1);
  await writeFile(manifest, JSON.stringify({ user: "changed" }));
  await assert.rejects(uninstallClaude(options), /different owner/);
  assert.equal(await readFile(manifest, "utf8"), JSON.stringify({ user: "changed" }));
  await writeFile(manifest, before);
  const unrelated = join(root, "unrelated.json");
  await writeFile(unrelated, before);
  await rm(manifest);
  await symlink(unrelated, manifest);
  await assert.rejects(installClaude(options), /not a regular file/);
  assert.equal(await readFile(unrelated, "utf8"), before);
  await rm(manifest);
  await writeFile(manifest, before);
  assert.deepEqual(await uninstallClaude(options), { removed: true, retainedMarketplace: true });
  assert.deepEqual(await uninstallClaude(options), { removed: false, retainedMarketplace: true });
  const after = JSON.parse(await readFile(env.FAKE_STATE, "utf8"));
  assert.equal(after.other, "preserved");
  after.plugins.push({ id: first.id, scope: "user", enabled: true });
  await writeFile(env.FAKE_STATE, JSON.stringify(after));
  await writeFile(join(source, "dist/cli/main.js"), "console.log('v3')");
  await assert.rejects(installClaude(options), /different owner/);
  assert.equal(await readFile(manifest, "utf8"), before);
  await assert.rejects(uninstallClaude(options), /different owner/);
});

test("Claude does not publish a skill that changed during packaging", { skip: process.platform === "win32" }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "git-relay-claude-skill-race-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source"), workspace = join(root, "workspace");
  for (const path of ["dist/cli", "skills/example", "docs"]) await mkdir(join(source, path), { recursive: true });
  await writeFile(join(source, "package.json"), JSON.stringify({ version: "0.1.0" }));
  await writeFile(join(source, "dist/cli/main.js"), "console.log('help')");
  const skill = join(source, "skills/example/SKILL.md");
  await writeFile(skill, "A");
  await writeFile(join(source, "docs/example.md"), "docs");
  const command = join(root, "claude");
  await writeFile(command, "#!/bin/sh\nprintf '[]\\n'\n", { mode: 0o755 });
  const preload = join(root, "preload.mjs");
  await writeFile(preload, `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const open = fs.promises.open; let changed = false;
fs.promises.open = async (path, ...args) => { const handle = await open(path, ...args); if (!changed && path === ${JSON.stringify(skill)}) { const read = handle.read; handle.read = async (...params) => { const result = await read.apply(handle, params); if (!changed) { changed = true; await fs.promises.writeFile(path, 'B'); } return result; }; } return handle; };
syncBuiltinESMExports();
`);
  const child = join(root, "child.mjs");
  await writeFile(child, `import { installClaude } from ${JSON.stringify(new URL("../../src/cli/install-claude.ts", import.meta.url).href)};
try { await installClaude(${JSON.stringify({ workspace, sourceRoot: source, command })}); process.exitCode = 1; } catch (error) { if (!String(error).includes('skills changed while packaging') && !String(error).includes('Installer file changed while reading')) throw error; }
`);
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--import", pathToFileURL(preload).href, child], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(skill, "utf8"), "B");
});

test("Claude preserves an existing incomplete plugin snapshot", { skip: process.platform === "win32" }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "git-relay-claude-incomplete-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceRoot = join(root, "source"), workspace = join(root, "workspace"), command = join(root, "claude");
  for (const path of ["dist/cli", "skills/example", "docs"]) await mkdir(join(sourceRoot, path), { recursive: true });
  await writeFile(join(sourceRoot, "package.json"), JSON.stringify({ version: "0.1.0" }));
  await writeFile(join(sourceRoot, "dist/cli/main.js"), "console.log('help')");
  await writeFile(join(sourceRoot, "skills/example/SKILL.md"), "skill");
  await writeFile(join(sourceRoot, "docs/example.md"), "docs");
  await writeFile(command, "#!/bin/sh\nprintf '[]\\n'\n", { mode: 0o755 });
  const options = { workspace, sourceRoot, command };
  await assert.rejects(installClaude(options), /could not be verified/);
  const market = join(workspace, "claude", "marketplace");
  const names = (await readdir(market)).filter((name) => name.startsWith("plugin-"));
  assert.equal(names.length, 1);
  const target = join(market, names[0]);
  await rm(target, { recursive: true });
  await mkdir(target);
  const before = await stat(target);
  await assert.rejects(installClaude(options), /Existing Claude plugin snapshot was modified/);
  assert.equal((await stat(target)).ino, before.ino);
  assert.deepEqual(await readdir(target), []);
  await writeFile(join(target, "user.txt"), "preserve");
  await assert.rejects(installClaude(options), /Existing Claude plugin snapshot was modified/);
  assert.equal((await stat(target)).ino, before.ino);
  assert.equal(await readFile(join(target, "user.txt"), "utf8"), "preserve");
});

test("Claude workspace publication preserves abandoned stages and unowned directories", { skip: process.platform === "win32" }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "git-relay-claude-owner-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, "workspace");
  const abandoned = join(workspace, ".claude-stage-00000000-0000-4000-8000-000000000001");
  await mkdir(abandoned, { recursive: true });
  await writeFile(join(abandoned, "important"), "keep");
  await assert.rejects(installClaude({ workspace, sourceRoot: join(root, "missing") }));
  assert.match(await readlink(join(workspace, "claude")), /^\.claude-stage-/);
  assert.equal(await readFile(join(abandoned, "important"), "utf8"), "keep");
  const foreign = join(root, "foreign");
  await mkdir(join(foreign, "claude"), { recursive: true });
  await writeFile(join(foreign, "claude", "important"), "keep");
  await assert.rejects(installClaude({ workspace: foreign, sourceRoot: join(root, "missing") }));
  assert.equal(await readFile(join(foreign, "claude", "important"), "utf8"), "keep");
});

test("Claude preserves unpublished workspace stages on failure and publication races", { skip: process.platform === "win32" }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "git-relay-claude-stage-race-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const moduleUrl = new URL("../../src/cli/install-claude.ts", import.meta.url).href;
  for (const scenario of ["failure", "adopted"]) {
    const workspace = join(root, scenario, "workspace");
    const outside = join(root, scenario, "external-reference");
    const preload = join(root, `${scenario}.mjs`);
    await writeFile(preload, `import fs from 'node:fs';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
const original = fs.promises.symlink;
fs.promises.symlink = async (from, to, type) => {
  if (to === ${JSON.stringify(join(workspace, "claude"))}) {
    const stage = path.join(path.dirname(to), from);
    await fs.promises.writeFile(path.join(stage, 'foreign'), 'keep');
    await original(stage, ${JSON.stringify(outside)}, 'dir');
    if (${JSON.stringify(scenario)} === 'failure') throw Object.assign(new Error('injected symlink failure'), { code: 'EACCES' });
    await original(from, to, type);
  }
  return original(from, to, type);
};
syncBuiltinESMExports();
`);
    const child = join(root, `${scenario}-child.mjs`);
    await writeFile(child, `import { installClaude } from ${JSON.stringify(moduleUrl)};
try { await installClaude(${JSON.stringify({ workspace, sourceRoot: join(root, "missing") })}); process.exitCode = 1; }
catch { process.stdout.write('failed as expected'); }
`);
    const result = spawnSync(process.execPath, ["--experimental-strip-types", "--import", pathToFileURL(preload).href, child], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "failed as expected");
    const stages = (await readdir(workspace)).filter((name) => name.startsWith(".claude-stage-"));
    assert.equal(stages.length, 1);
    const stage = join(workspace, stages[0]);
    assert.ok(result.stderr.includes(stage), result.stderr);
    assert.equal(await readFile(join(stage, "foreign"), "utf8"), "keep");
    assert.equal(await readFile(join(outside, "foreign"), "utf8"), "keep");
    if (scenario === "adopted") assert.equal(await readlink(join(workspace, "claude")), stages[0]);
  }
});

test("Claude preserves the original error when writing the stage owner collides", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "git-relay-claude-owner-collision-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, "workspace");
  const preload = join(root, "preload.mjs");
  await writeFile(preload, `import fs from 'node:fs';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
const original = fs.promises.open;
fs.promises.open = async (file, ...args) => {
  if (String(file).includes('.claude-stage-') && path.basename(String(file)).startsWith('owner.json.')) {
    await fs.promises.writeFile(file, 'foreign data');
    throw Object.assign(new Error('injected owner collision'), { code: 'EEXIST' });
  }
  return original(file, ...args);
};
syncBuiltinESMExports();
`);
  const child = join(root, "child.mjs");
  await writeFile(child, `import { installClaude } from ${JSON.stringify(new URL("../../src/cli/install-claude.ts", import.meta.url).href)};
try { await installClaude(${JSON.stringify({ workspace, sourceRoot: join(root, "missing") })}); process.exitCode = 1; }
catch (error) { process.stdout.write(JSON.stringify({ code: error.code, message: error.message })); }
`);
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--import", pathToFileURL(preload).href, child], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { code: "EEXIST", message: "injected owner collision" });
  const entries = await readdir(workspace);
  assert.equal(entries.length, 1);
  const stage = join(workspace, entries[0]);
  assert.ok(entries[0].startsWith(".claude-stage-"));
  const files = await readdir(stage);
  assert.equal(files.length, 1);
  assert.equal(await readFile(join(stage, files[0]), "utf8"), "foreign data");
  assert.ok(result.stderr.includes(stage), result.stderr);
});

test("Claude marketplace publication does not overwrite a concurrent user edit", { skip: process.platform === "win32" }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "git-relay-claude-race-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source"), workspace = join(root, "workspace");
  for (const path of ["dist/cli", "skills/example", "docs"]) await mkdir(join(source, path), { recursive: true });
  await writeFile(join(source, "package.json"), JSON.stringify({ version: "0.1.0" }));
  await writeFile(join(source, "dist/cli/main.js"), "console.log('help')");
  await writeFile(join(source, "skills/example/SKILL.md"), "skill");
  await writeFile(join(source, "docs/example.md"), "docs");
  const command = join(root, "claude");
  await writeFile(command, "#!/bin/sh\nprintf '[]\\n'\n", { mode: 0o755 });
  const preload = join(root, "preload.mjs");
  await writeFile(preload, `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const original = fs.promises.link;
fs.promises.link = async (from, to) => {
  if (to.endsWith('/marketplace.json')) await fs.promises.writeFile(to, 'USER_EDIT', {flag:'wx'});
  return original(from, to);
};
syncBuiltinESMExports();
`);
  const child = join(root, "child.mjs");
  const moduleUrl = new URL("../../src/cli/install-claude.ts", import.meta.url).href;
  await writeFile(child, `import { installClaude } from ${JSON.stringify(moduleUrl)};
try { await installClaude(${JSON.stringify({ workspace, sourceRoot: source, command })}); process.exitCode = 1; }
catch { process.stdout.write('preserved'); }
`);
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--import", pathToFileURL(preload).href, child], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "preserved");
  assert.equal(await readFile(join(workspace, "claude/marketplace/.claude-plugin/marketplace.json"), "utf8"), "USER_EDIT");
});
