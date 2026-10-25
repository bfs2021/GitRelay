import assert from "node:assert/strict";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { formatChange, inspectChange, resolveMain, watchRoot } from "../../src/core/changes.ts";
import { fixture, git } from "../helpers.ts";

const ref = "refs/heads/main";

test("one merged worktree informs two overlapping worktrees but not the clean source", async (t) => {
  const f = await fixture(t);
  await f.commit(f.b, "shared.txt", "B committed\n");
  await writeFile(join(f.c, "shared.txt"), "C uncommitted\n");
  await f.commit(f.a, "shared.txt", "A upstream\n");
  git(f.main, "merge", "--no-ff", "feature/a", "-m", "merge A");
  const current = await resolveMain(f.main, ref);
  for (const root of [f.b, f.c]) {
    const change = await inspectChange({ root, ref, commit: f.initial }, current);
    assert.deepEqual(change?.files, ["shared.txt"]);
    assert.ok(change?.patch.includes("A upstream"));
    assert.equal(change?.rewritten, false);
    assert.match(formatChange(change!), /不授权 merge/);
  }
  assert.equal(await inspectChange({ root: f.a, ref, commit: f.initial }, current), undefined);
  assert.equal(git(f.b, "show", "HEAD:shared.txt"), "B committed\n");
  assert.equal(git(f.c, "diff", "--name-only").trim(), "shared.txt");
});

test("detects staging, untracked files, deletions and both sides of renames", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.b, "shared.txt"), "staged\n");
  git(f.b, "add", "shared.txt");
  await writeFile(join(f.b, "shared.txt"), "base\n"); // Staged/unstaged cancel in net diff.
  await writeFile(join(f.b, "new.txt"), "untracked\n");
  await rename(join(f.a, "shared.txt"), join(f.a, "renamed.txt"));
  await writeFile(join(f.a, "new.txt"), "upstream new\n");
  git(f.a, "add", ".");
  git(f.a, "commit", "-m", "rename and add");
  git(f.main, "merge", "--ff-only", "feature/a");
  const change = await inspectChange({ root: f.b, ref, commit: f.initial }, await resolveMain(f.main, ref));
  assert.deepEqual(change?.files, ["new.txt", "shared.txt"]);
});

test("does not lose intermediate edits reverted before the next poll", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.b, "shared.txt"), "local\n");
  await f.commit(f.main, "shared.txt", "temporary\n");
  await f.commit(f.main, "shared.txt", "base\n");
  const change = await inspectChange({ root: f.b, ref, commit: f.initial }, await resolveMain(f.main, ref));
  assert.deepEqual(change?.files, ["shared.txt"]);
  assert.equal(change?.commits.length, 2);
  assert.ok(change?.patch.includes("temporary"));
});

test("unrelated updates do not trigger, ref rewind is identified, subdirectories resolve to root", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.b, "shared.txt"), "local\n");
  const unrelated = await f.commit(f.main, "other.txt", "unrelated\n");
  assert.equal(await inspectChange({ root: f.b, ref, commit: f.initial }, unrelated), undefined);
  const changed = await f.commit(f.main, "shared.txt", "upstream\n");
  const rewrite = await inspectChange({ root: f.b, ref, commit: changed }, f.initial);
  assert.equal(rewrite?.rewritten, true);
  await mkdir(join(f.b, "sub"));
  assert.equal(await watchRoot(join(f.b, "sub")), f.b);
  await assert.rejects(resolveMain(f.main, "--help"), /完整分支引用/);
});

test("unusual paths use literal pathspecs and huge diff previews are bounded", async (t) => {
  const f = await fixture(t);
  const name = "[shared]* 中文\n.txt";
  await f.commit(f.main, name, "initial\n");
  git(f.b, "merge", "--ff-only", "main");
  const before = await resolveMain(f.main, ref);
  await writeFile(join(f.b, name), "local\n");
  const current = await f.commit(f.main, name, "large\n".repeat(100_000));
  const change = await inspectChange({ root: f.b, ref, commit: before }, current);
  assert.deepEqual(change?.files, [name]);
  assert.ok(change!.patch.length < 25_000);
  assert.match(change!.patch, /truncated/);
});
