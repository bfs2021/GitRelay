import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { installPi, uninstallPi } from "../../src/cli/install-pi.ts";

const repo = fileURLToPath(new URL("../../", import.meta.url));
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const dir = await mkdtemp(join(tmpdir(), "git-relay-pi-install-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const workspace = join(dir, "workspace"), agent = join(dir, "agent"), sourceRoot = join(dir, "source");
  await mkdir(workspace); await mkdir(agent); await mkdir(sourceRoot);
  await writeFile(join(workspace, ".git-relay-owner"), "git-relay installer v1\n");
  for (const path of ["package.json", "src", "skills/worktree-coordination"]) {
    if (path.startsWith("skills/")) await mkdir(join(sourceRoot, "skills"), { recursive: true });
    await cp(join(repo, path), join(sourceRoot, path), { recursive: true });
  }
  const settings = '{"theme":"test-theme","packages":[]}\n';
  await writeFile(join(agent, "settings.json"), settings);
  const env = { ...process.env, HOME: dir, PI_CODING_AGENT_DIR: agent, PI_OFFLINE: "1", PI_TELEMETRY: "0", PATH: `${join(repo, "node_modules", ".bin")}${delimiter}${process.env.PATH ?? ""}` };
  return { dir, workspace, agent, sourceRoot, env, settings };
}
async function commands(cwd: string, env: NodeJS.ProcessEnv): Promise<string[]> {
  return await new Promise((resolve, reject) => {
    const child = spawn("pi", ["--mode", "rpc", "--no-session", "--no-mcp", "--offline"], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    let output = "", errors = "", settled = false;
    const timer = setTimeout(() => { child.kill(); if (!settled) { settled = true; reject(new Error(`pi RPC timed out: ${errors}`)); } }, 10_000);
    child.stderr.on("data", (chunk) => { errors += String(chunk); });
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
      for (const line of output.split("\n")) {
        try {
          const event = JSON.parse(line);
          if (event.id !== "probe" || settled) continue;
          settled = true; clearTimeout(timer); child.kill();
          if (!event.success) reject(new Error(`pi RPC failed: ${line} ${errors}`));
          else resolve(event.data.commands.map((command: { name: string }) => command.name));
        } catch { /* Wait for a complete JSON line. */ }
      }
    });
    child.on("error", (error) => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
    child.on("close", () => { if (!settled) { settled = true; clearTimeout(timer); reject(new Error(errors || "pi exited before the RPC response")); } });
    child.stdin.write('{"id":"probe","type":"get_commands"}\n');
  });
}

test("pi preserves a symlinked installation record and its target", { skip: process.platform === "win32" }, async (t) => {
  const f = await fixture(t), options = { workspace: f.workspace, sourceRoot: f.sourceRoot, env: f.env };
  await installPi(options);
  const state = join(f.workspace, "pi.json"), target = join(f.workspace, "pi.saved.json");
  const saved = await readFile(state, "utf8"), entry = join(f.agent, "extensions", "git-relay.ts");
  const savedEntry = await readFile(entry, "utf8"), skill = join(f.agent, "skills", "worktree-coordination"), savedSkill = await readlink(skill);
  await rename(state, target); await symlink("pi.saved.json", state);
  await assert.rejects(installPi(options), /Invalid pi installation record/);
  await assert.rejects(uninstallPi({ workspace: f.workspace, env: f.env }), /Invalid pi installation record/);
  assert.equal(await readlink(state), "pi.saved.json");
  assert.equal(await readFile(target, "utf8"), saved);
  assert.equal(await readFile(entry, "utf8"), savedEntry);
  assert.equal(await readlink(skill), savedSkill);
  assert.equal(await readFile(join(f.agent, "settings.json"), "utf8"), f.settings);
});

test("pi autodiscovers extension and skill through repeat install, upgrade and uninstall without editing settings", { skip: process.platform === "win32" }, async (t) => {
  const f = await fixture(t), options = { workspace: f.workspace, sourceRoot: f.sourceRoot, env: f.env };
  const state = async () => JSON.parse(await readFile(join(f.workspace, "pi.json"), "utf8"));
  await installPi(options);
  const firstState = await state();
  const first = firstState.current as string;
  const initial = await commands(f.dir, f.env);
  assert.ok(initial.includes("worktree")); assert.ok(initial.includes("skill:worktree-coordination"));
  await installPi(options);
  assert.equal((await state()).current, first);
  await writeFile(join(f.sourceRoot, "skills", "worktree-coordination", "SKILL.md"), `${await readFile(join(f.sourceRoot, "skills", "worktree-coordination", "SKILL.md"), "utf8")}\nUpgrade marker\n`);
  await installPi(options);
  const second = (await state()).current as string;
  assert.notEqual(first, second);
  assert.ok((await readlink(join(f.agent, "skills", "worktree-coordination"))).includes(second.slice(21)));
  const updated = await commands(f.dir, f.env);
  assert.ok(updated.includes("worktree")); assert.ok(updated.includes("skill:worktree-coordination"));
  assert.equal(await readFile(join(f.agent, "settings.json"), "utf8"), f.settings);
  await uninstallPi({ workspace: f.workspace, env: f.env });
  await uninstallPi({ workspace: f.workspace, env: f.env });
  const stopped = await commands(f.dir, f.env);
  assert.equal(stopped.includes("worktree"), false); assert.equal(stopped.includes("skill:worktree-coordination"), false);
  assert.equal(await readFile(join(f.agent, "settings.json"), "utf8"), f.settings);
  await installPi(options);
  assert.ok((await commands(f.dir, f.env)).includes("worktree"));
  assert.notEqual((await state()).entryWitness, firstState.entryWitness);
  assert.notEqual((await state()).skillWitness, firstState.skillWitness);
});

test("pi refuses unowned, modified and legacy entries and preserves interrupted upgrade archives", { skip: process.platform === "win32" }, async (t) => {
  const f = await fixture(t), options = { workspace: f.workspace, sourceRoot: f.sourceRoot, env: f.env };
  await mkdir(join(f.agent, "extensions")); await writeFile(join(f.agent, "extensions", "git-relay.ts"), "user data\n");
  await assert.rejects(installPi(options), /already exists or was modified/);
  assert.equal(await readFile(join(f.agent, "extensions", "git-relay.ts"), "utf8"), "user data\n");
  await rm(join(f.agent, "extensions", "git-relay.ts"));
  await installPi(options);
  const before = JSON.parse(await readFile(join(f.workspace, "pi.json"), "utf8"));
  const first = before.current as string;
  const oldSkill = await readlink(join(f.agent, "skills", "worktree-coordination"));
  await writeFile(join(f.sourceRoot, "skills", "worktree-coordination", "SKILL.md"), `${await readFile(join(f.sourceRoot, "skills", "worktree-coordination", "SKILL.md"), "utf8")}\nnew\n`);
  await installPi(options);
  const after = JSON.parse(await readFile(join(f.workspace, "pi.json"), "utf8"));
  const second = after.current as string;
  let archive: string | undefined;
  for (const name of await readdir(join(f.agent, "skills"))) {
    if (!name.startsWith(".git-relay-archive-")) continue;
    const candidate = join(f.agent, "skills", name, "entry");
    try { if (await readlink(candidate) === oldSkill) archive = candidate; } catch { /* Not the skill archive. */ }
  }
  assert.ok(archive);
  await writeFile(join(f.workspace, "pi.json"), JSON.stringify({ agentDir: before.agentDir, current: first, pending: second, entryWitness: before.entryWitness, skillWitness: before.skillWitness, nextSkillWitness: after.skillWitness, skillArchive: archive.replace(f.agent, before.agentDir) }));
  await installPi(options);
  assert.equal(JSON.parse(await readFile(join(f.workspace, "pi.json"), "utf8")).current, second);
  await writeFile(join(f.agent, "extensions", "git-relay.ts"), "user modified\n");
  await assert.rejects(uninstallPi({ workspace: f.workspace, env: f.env }), /modified; preserved/);
  assert.equal(await readFile(join(f.agent, "extensions", "git-relay.ts"), "utf8"), "user modified\n");
  assert.equal(await readFile(join(f.agent, "settings.json"), "utf8"), f.settings);
});

test("pi completes a pending first install before upgrading to a different package", { skip: process.platform === "win32" }, async (t) => {
  for (const stage of ["journal", "entry", "revision"]) {
    const f = await fixture(t), options = { workspace: f.workspace, sourceRoot: f.sourceRoot, env: f.env };
    await installPi(options);
    const statePath = join(f.workspace, "pi.json"), state = JSON.parse(await readFile(statePath, "utf8"));
    await writeFile(statePath, JSON.stringify({ agentDir: state.agentDir, current: null, pending: state.current, entryWitness: state.entryWitness, nextSkillWitness: state.skillWitness }));
    if (stage !== "revision") await rm(join(f.workspace, "pi-revisions", state.current));
    if (stage === "journal") {
      await rm(join(f.agent, "extensions", "git-relay.ts"));
      await rm(join(f.agent, "skills", "worktree-coordination"));
      await rm(join(f.workspace, "pi-loader.ts"));
    }
    const skill = join(f.sourceRoot, "skills", "worktree-coordination", "SKILL.md");
    await writeFile(skill, `${await readFile(skill, "utf8")}\nNew package ${stage}\n`);
    await installPi(options);
    const recovered = JSON.parse(await readFile(statePath, "utf8"));
    assert.notEqual(recovered.current, state.current);
    assert.equal(recovered.pending, undefined);
    assert.deepEqual((await readdir(join(f.workspace, "pi-revisions"))).sort(), [state.current, recovered.current]);
    assert.ok((await readlink(join(f.agent, "skills", "worktree-coordination"))).includes(recovered.current.slice(21)));
    assert.ok((await commands(f.dir, f.env)).includes("worktree"));
    await uninstallPi({ workspace: f.workspace, env: f.env });
    assert.equal(await readFile(join(f.agent, "settings.json"), "utf8"), f.settings);
  }
});

test("pi recovers a pending upgrade before upgrading again and refuses a damaged pending snapshot", { skip: process.platform === "win32" }, async (t) => {
  const f = await fixture(t), options = { workspace: f.workspace, sourceRoot: f.sourceRoot, env: f.env };
  const statePath = join(f.workspace, "pi.json"), skill = join(f.sourceRoot, "skills", "worktree-coordination", "SKILL.md");
  await installPi(options);
  const first = JSON.parse(await readFile(statePath, "utf8"));
  const oldTarget = await readlink(join(f.agent, "skills", "worktree-coordination"));
  await writeFile(skill, `${await readFile(skill, "utf8")}\nSecond package\n`);
  await installPi(options);
  const second = JSON.parse(await readFile(statePath, "utf8"));
  let archive: string | undefined;
  for (const name of await readdir(join(f.agent, "skills"))) {
    if (!name.startsWith(".git-relay-archive-")) continue;
    const candidate = join(f.agent, "skills", name, "entry");
    try { if (await readlink(candidate) === oldTarget) archive = candidate; } catch { /* Not the skill archive. */ }
  }
  assert.ok(archive);
  const pending = { ...first, pending: second.current, nextSkillWitness: second.skillWitness, skillArchive: archive.replace(f.agent, first.agentDir) };
  await writeFile(statePath, JSON.stringify(pending));
  await writeFile(skill, `${await readFile(skill, "utf8")}\nThird package\n`);
  const snapshotSkill = join(f.workspace, "pi-versions", second.current.slice(21), "skills", "worktree-coordination", "SKILL.md");
  const original = await readFile(snapshotSkill, "utf8");
  await writeFile(snapshotSkill, `${original}\nCorrupted\n`);
  await assert.rejects(installPi(options), /snapshot is missing or modified; preserved/);
  assert.deepEqual(JSON.parse(await readFile(statePath, "utf8")), pending);
  assert.equal(await readlink(archive), oldTarget);
  await writeFile(snapshotSkill, original);
  const snapshot = join(f.workspace, "pi-versions", second.current.slice(21)), held = `${snapshot}.held`;
  await rename(snapshot, held);
  await assert.rejects(installPi(options), /snapshot is missing or modified; preserved/);
  assert.deepEqual(JSON.parse(await readFile(statePath, "utf8")), pending);
  await rename(held, snapshot);
  await installPi(options);
  const final = JSON.parse(await readFile(statePath, "utf8"));
  assert.notEqual(final.current, second.current);
  assert.equal(final.pending, undefined);
  assert.deepEqual((await readdir(join(f.workspace, "pi-revisions"))).sort(), [first.current, second.current, final.current]);
  assert.ok((await commands(f.dir, f.env)).includes("worktree"));
  await uninstallPi({ workspace: f.workspace, env: f.env });
  assert.equal(await readFile(join(f.agent, "settings.json"), "utf8"), f.settings);
});

test("pi finishes a pending install even if the current package has disappeared", { skip: process.platform === "win32" }, async (t) => {
  const f = await fixture(t), options = { workspace: f.workspace, sourceRoot: f.sourceRoot, env: f.env };
  await installPi(options);
  const statePath = join(f.workspace, "pi.json"), state = JSON.parse(await readFile(statePath, "utf8"));
  await writeFile(statePath, JSON.stringify({ agentDir: state.agentDir, current: null, pending: state.current, entryWitness: state.entryWitness, nextSkillWitness: state.skillWitness }));
  await rm(join(f.workspace, "pi-revisions", state.current));
  await rm(join(f.agent, "extensions", "git-relay.ts"));
  await rm(join(f.agent, "skills", "worktree-coordination"));
  await rm(join(f.workspace, "pi-loader.ts"));
  await rename(f.sourceRoot, `${f.sourceRoot}.held`);
  await assert.rejects(installPi(options), { code: "ENOENT" });
  const recovered = JSON.parse(await readFile(statePath, "utf8"));
  assert.equal(recovered.current, state.current);
  assert.equal(recovered.pending, undefined);
  assert.ok((await commands(f.dir, f.env)).includes("worktree"));
  await uninstallPi({ workspace: f.workspace, env: f.env });
  assert.equal(await readFile(join(f.agent, "settings.json"), "utf8"), f.settings);
});

test("pi keeps the install lock between pending recovery and the requested upgrade", { skip: process.platform === "win32" }, async (t) => {
  const f = await fixture(t), options = { workspace: f.workspace, sourceRoot: f.sourceRoot, env: f.env };
  await installPi(options);
  const statePath = join(f.workspace, "pi.json"), state = JSON.parse(await readFile(statePath, "utf8"));
  await writeFile(statePath, JSON.stringify({ agentDir: state.agentDir, current: null, pending: state.current, entryWitness: state.entryWitness, nextSkillWitness: state.skillWitness }));
  await rm(join(f.workspace, "pi-revisions", state.current));
  const skill = join(f.sourceRoot, "skills", "worktree-coordination", "SKILL.md");
  await writeFile(skill, `${await readFile(skill, "utf8")}\nNew package\n`);
  const bin = join(f.dir, "test-bin"), first = join(f.dir, "first-validation"), second = join(f.dir, "second-validation");
  await mkdir(bin);
  await writeFile(join(bin, "pi"), '#!/bin/sh\nif [ -f "$GIT_RELAY_TEST_FIRST" ]; then touch "$GIT_RELAY_TEST_SECOND"; sleep 1; else touch "$GIT_RELAY_TEST_FIRST"; fi\nexec "$GIT_RELAY_TEST_PI" "$@"\n', { mode: 0o755 });
  const operation = installPi({ ...options, env: { ...f.env, PATH: `${bin}${delimiter}${f.env.PATH}`, GIT_RELAY_TEST_FIRST: first, GIT_RELAY_TEST_SECOND: second, GIT_RELAY_TEST_PI: join(repo, "node_modules", ".bin", "pi") } });
  const settled = operation.then(() => undefined, (error: unknown) => error);
  try {
    let observed = false;
    for (let i = 0; i < 500; i++) {
      if (await lstat(second).then(() => true, () => false)) { observed = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(observed, "second validation did not start");
    assert.equal(JSON.parse(await readFile(statePath, "utf8")).current, state.current);
    await assert.rejects(uninstallPi({ workspace: f.workspace, env: f.env }), /lock remains busy/);
  } finally {
    const error = await settled;
    if (error) throw error;
  }
  assert.notEqual(JSON.parse(await readFile(statePath, "utf8")).current, state.current);
  await uninstallPi({ workspace: f.workspace, env: f.env });
});

test("pi package hashes distinguish file boundaries and preserve damaged runtimes", { skip: process.platform === "win32" }, async (t) => {
  const f = await fixture(t), options = { workspace: f.workspace, sourceRoot: f.sourceRoot, env: f.env };
  await writeFile(join(f.sourceRoot, "src", "collision-a"), "xsrc/collision-b\0y");
  await installPi(options);
  const first = JSON.parse(await readFile(join(f.workspace, "pi.json"), "utf8")).current as string;
  await writeFile(join(f.sourceRoot, "src", "collision-a"), "x");
  await writeFile(join(f.sourceRoot, "src", "collision-b"), "y");
  await installPi(options);
  const second = JSON.parse(await readFile(join(f.workspace, "pi.json"), "utf8")).current as string;
  assert.notEqual(first.slice(21), second.slice(21));
  const damaged = join(f.workspace, "pi-versions", second.slice(21), "src", "collision-a");
  await rm(damaged);
  await assert.rejects(installPi(options), /runtime was modified/);
  await assert.rejects(lstat(damaged), { code: "ENOENT" });
});

test("pi preserves an existing incomplete runtime directory", { skip: process.platform === "win32" }, async (t) => {
  const f = await fixture(t);
  await installPi({ workspace: f.workspace, sourceRoot: f.sourceRoot, env: f.env });
  const id = JSON.parse(await readFile(join(f.workspace, "pi.json"), "utf8")).current.slice(21);
  const workspace = join(f.dir, "other-workspace"), agent = join(f.dir, "other-agent"), runtime = join(workspace, "pi-versions", id);
  await mkdir(runtime, { recursive: true }); await mkdir(agent);
  await writeFile(join(workspace, ".git-relay-owner"), "git-relay installer v1\n");
  const inode = await lstat(runtime);
  const options = { workspace, sourceRoot: f.sourceRoot, env: { ...f.env, PI_CODING_AGENT_DIR: agent } };
  await assert.rejects(installPi(options), /Pi runtime was modified/);
  assert.equal((await lstat(runtime)).ino, inode.ino);
  assert.deepEqual(await readdir(runtime), []);
  await writeFile(join(runtime, "user-data"), "preserve");
  await assert.rejects(installPi(options), /Pi runtime was modified/);
  assert.equal((await lstat(runtime)).ino, inode.ino);
  assert.equal(await readFile(join(runtime, "user-data"), "utf8"), "preserve");
});

test("pi preserves an existing same-name skill and recognizes a legacy package", { skip: process.platform === "win32" }, async (t) => {
  const f = await fixture(t), options = { workspace: f.workspace, sourceRoot: f.sourceRoot, env: f.env };
  await mkdir(join(f.agent, "skills"));
  await symlink(f.sourceRoot, join(f.agent, "skills", "worktree-coordination"));
  await assert.rejects(installPi(options), /already exists or was modified/);
  assert.equal(await readlink(join(f.agent, "skills", "worktree-coordination")), f.sourceRoot);
  await rm(join(f.agent, "skills", "worktree-coordination"));
  await writeFile(join(f.agent, "settings.json"), JSON.stringify({ packages: [f.sourceRoot] }));
  await assert.rejects(installPi(options), /Existing pi package/);
});

test("pi detects an existing package whose local directory ends in Unicode whitespace", { skip: process.platform === "win32" }, async (t) => {
  const f = await fixture(t), packagePath = join(f.dir, "local-package\u00a0");
  await mkdir(packagePath);
  await writeFile(join(packagePath, "package.json"), JSON.stringify({ name: "git-relay" }));
  const settings = JSON.stringify({ packages: [packagePath] });
  await writeFile(join(f.agent, "settings.json"), settings);
  await assert.rejects(installPi({ workspace: f.workspace, sourceRoot: f.sourceRoot, env: f.env }), /Existing pi package/);
  assert.equal(await readFile(join(f.agent, "settings.json"), "utf8"), settings);
});

test("pi rejects identical user-created entries without matching ownership witnesses", { skip: process.platform === "win32" }, async (t) => {
  const f = await fixture(t), options = { workspace: f.workspace, sourceRoot: f.sourceRoot, env: f.env };
  await installPi(options);
  const entry = join(f.agent, "extensions", "git-relay.ts"), skill = join(f.agent, "skills", "worktree-coordination");
  const content = await readFile(entry, "utf8"), target = await readlink(skill);
  await rm(entry); await writeFile(entry, content);
  await assert.rejects(installPi(options), /not owned/);
  await assert.rejects(uninstallPi({ workspace: f.workspace, env: f.env }), /not owned/);
  assert.equal(await readFile(entry, "utf8"), content);
  await rm(entry);
  const record = JSON.parse(await readFile(join(f.workspace, "pi.json"), "utf8"));
  await import("node:fs/promises").then(({ link }) => link(record.entryWitness, entry));
  await rm(skill); await symlink(target, skill);
  await assert.rejects(installPi(options), /not owned/);
  await assert.rejects(uninstallPi({ workspace: f.workspace, env: f.env }), /not owned/);
  assert.equal(await readlink(skill), target);
});

test("pi never claims identical entries created by another process during first publication", { skip: process.platform === "win32" }, async (t) => {
  const f = await fixture(t), options = { workspace: f.workspace, sourceRoot: f.sourceRoot, env: f.env };
  await installPi(options);
  const record = JSON.parse(await readFile(join(f.workspace, "pi.json"), "utf8"));
  const entry = join(f.agent, "extensions", "git-relay.ts"), skill = join(f.agent, "skills", "worktree-coordination");
  const content = await readFile(entry, "utf8"), target = await readlink(skill);
  await writeFile(join(f.workspace, "pi.json"), JSON.stringify({ agentDir: record.agentDir, current: null, pending: record.current, entryWitness: record.entryWitness, nextSkillWitness: record.skillWitness }));
  await rm(entry); await writeFile(entry, content);
  await assert.rejects(installPi(options), /not owned/);
  assert.equal(await readFile(entry, "utf8"), content);
  await rm(entry);
  const { link } = await import("node:fs/promises"); await link(record.entryWitness, entry);
  await rm(skill); await symlink(target, skill);
  await assert.rejects(installPi(options), /not owned/);
  assert.equal(await readlink(skill), target);
});

test("pi refuses a broken upgrade before changing its active entry or skill", { skip: process.platform === "win32" }, async (t) => {
  const f = await fixture(t), options = { workspace: f.workspace, sourceRoot: f.sourceRoot, env: f.env };
  await installPi(options);
  const before = await readFile(join(f.workspace, "pi.json"), "utf8");
  const target = await readlink(join(f.agent, "skills", "worktree-coordination"));
  await rm(join(f.sourceRoot, "src", "adapters", "pi", "index.ts"));
  await assert.rejects(installPi(options), /could not load the staged extension and skill/);
  assert.equal(await readFile(join(f.workspace, "pi.json"), "utf8"), before);
  assert.equal(await readlink(join(f.agent, "skills", "worktree-coordination")), target);
  assert.ok((await commands(f.dir, f.env)).includes("worktree"));
  await cp(join(repo, "src", "adapters", "pi", "index.ts"), join(f.sourceRoot, "src", "adapters", "pi", "index.ts"));
  await rm(join(f.sourceRoot, "skills", "worktree-coordination", "SKILL.md"));
  await assert.rejects(installPi(options), /could not load the staged extension and skill/);
  assert.equal(await readFile(join(f.workspace, "pi.json"), "utf8"), before);
  assert.equal(await readlink(join(f.agent, "skills", "worktree-coordination")), target);
});

test("pi does not silently load an older revision or mix an interrupted upgrade", { skip: process.platform === "win32" }, async (t) => {
  const f = await fixture(t), options = { workspace: f.workspace, sourceRoot: f.sourceRoot, env: f.env };
  await installPi(options);
  const before = JSON.parse(await readFile(join(f.workspace, "pi.json"), "utf8"));
  await writeFile(join(f.sourceRoot, "skills", "worktree-coordination", "SKILL.md"), `${await readFile(join(f.sourceRoot, "skills", "worktree-coordination", "SKILL.md"), "utf8")}\nnew\n`);
  await installPi(options);
  const after = JSON.parse(await readFile(join(f.workspace, "pi.json"), "utf8"));
  await rm(join(f.workspace, "pi-revisions", after.current));
  await assert.rejects(commands(f.dir, f.env), /Invalid or missing GitRelay pi revision/);
  await assert.rejects(installPi(options), /revisions changed outside GitRelay/);
  await writeFile(join(f.workspace, "pi.json"), JSON.stringify({ ...before, pending: after.current, nextSkillWitness: after.skillWitness }));
  await assert.rejects(commands(f.dir, f.env), /GitRelay pi upgrade is incomplete/);
});

test("pi keeps ownership witnesses and archives beside symlinked discovery directories", { skip: process.platform === "win32" }, async (t) => {
  const f = await fixture(t), options = { workspace: f.workspace, sourceRoot: f.sourceRoot, env: f.env };
  const externalExtensions = join(f.dir, "external-extensions"), externalSkills = join(f.dir, "external-skills");
  await mkdir(externalExtensions); await mkdir(externalSkills);
  await symlink(externalExtensions, join(f.agent, "extensions"), "dir");
  await symlink(externalSkills, join(f.agent, "skills"), "dir");
  await installPi(options);
  await writeFile(join(f.sourceRoot, "skills", "worktree-coordination", "SKILL.md"), `${await readFile(join(f.sourceRoot, "skills", "worktree-coordination", "SKILL.md"), "utf8")}\nnew\n`);
  await installPi(options);
  assert.ok((await readdir(externalSkills)).some((name) => name.startsWith(".git-relay-archive-")));
  await uninstallPi({ workspace: f.workspace, env: f.env });
  assert.ok((await readdir(externalExtensions)).some((name) => name.startsWith(".git-relay-archive-")));
  assert.equal(await readFile(join(f.agent, "settings.json"), "utf8"), f.settings);
});

test("pi resolves equivalent agent directory aliases for install and uninstall", { skip: process.platform === "win32" }, async (t) => {
  const f = await fixture(t), alias = join(f.dir, "agent-alias");
  await symlink(f.agent, alias, "dir");
  await installPi({ workspace: f.workspace, sourceRoot: f.sourceRoot, env: { ...f.env, PI_CODING_AGENT_DIR: alias } });
  const record = JSON.parse(await readFile(join(f.workspace, "pi.json"), "utf8"));
  assert.equal(record.agentDir, await realpath(f.agent));
  await uninstallPi({ workspace: f.workspace, env: { ...f.env, PI_CODING_AGENT_DIR: f.agent } });
  await assert.rejects(lstat(join(f.agent, "extensions", "git-relay.ts")), { code: "ENOENT" });
  assert.equal(await readFile(join(f.agent, "settings.json"), "utf8"), f.settings);
});

test("pi preserves dangling agent directory aliases and accepts missing directories", { skip: process.platform === "win32" }, async (t) => {
  const f = await fixture(t), dangling = join(f.dir, "dangling"), target = join(f.dir, "missing-target");
  await symlink(target, dangling, "dir");
  await assert.rejects(installPi({ workspace: f.workspace, sourceRoot: f.sourceRoot, env: { ...f.env, PI_CODING_AGENT_DIR: join(dangling, "child") } }), /Cannot resolve existing pi directory/);
  assert.equal(await readlink(dangling), target);
  await assert.rejects(lstat(target), { code: "ENOENT" });
  await assert.rejects(lstat(join(f.workspace, "pi.json")), { code: "ENOENT" });
  const newAgent = join(f.dir, "new", "agent");
  await installPi({ workspace: f.workspace, sourceRoot: f.sourceRoot, env: { ...f.env, PI_CODING_AGENT_DIR: newAgent } });
  assert.ok((await lstat(join(newAgent, "extensions", "git-relay.ts"))).isFile());
  await uninstallPi({ workspace: f.workspace, env: { ...f.env, PI_CODING_AGENT_DIR: newAgent } });
});
