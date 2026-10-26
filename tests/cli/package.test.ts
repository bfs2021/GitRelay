import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("package exposes portable CLI, pi resources and the shared coordination skill", async () => {
  const manifest = JSON.parse(await read("package.json"));
  assert.equal(manifest.name, "worktree-relay");
  assert.equal(manifest.bin["worktree-relay"], "./dist/cli/main.js");
  assert.equal(manifest.bin["worktree-sync"], manifest.bin["worktree-relay"]);
  assert.match(await read("README.md"), /^# Worktree Relay\n/);
  assert.ok(await read("dist/cli/main.js"));
  for (const name of ["publisher", "sessions", "cleanup", "daemon-state", "daemon"]) assert.ok(await read(`dist/core/${name}.js`));
  for (const name of ["maintenance", "acceptance"]) assert.ok(await read(`docs/${name}.md`));
  assert.deepEqual(manifest.pi.skills, ["./skills/worktree-coordination"]);
  for (const path of manifest.pi.extensions) assert.ok(await read(path));
  const skill = await read("skills/worktree-coordination/SKILL.md");
  assert.match(skill, /^---\nname: worktree-coordination\ndescription:/);
  assert.match(skill, /first check establishes a baseline/);
  for (const agent of ["claude-code", "codex", "cursor"]) {
    const hooks = JSON.parse(await read(`src/adapters/${agent}/hooks.json`));
    assert.ok(hooks.hooks);
    assert.ok(JSON.stringify(hooks).includes(`worktree-sync hook ${agent}`));
  }
  assert.match(await read("index.ts"), /src\/adapters\/pi\/index.ts/);
});
