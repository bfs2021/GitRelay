import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import extension from "../../src/adapters/pi/index.ts";
import { removeWorktree } from "../../src/core/git.ts";
import { fixture } from "../helpers.ts";

test("replaced selection and SDK entry preserve the replacement worktree", { skip: process.platform === "win32" }, async (t) => {
  const f = await fixture(t);
  const target = join(f.root, "selected-$(touch SHELL_INJECTION)"), exclude = join(f.root, "test-excludes");
  const git = (...args: string[]) => execFileSync("/usr/bin/git", ["-C", f.main, ...args], { env: { PATH: "/usr/bin:/bin", HOME: f.root, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" }, stdio: "pipe" });
  await writeFile(exclude, "ignored-data\n");
  git("config", "core.excludesfile", exclude);
  git("worktree", "add", "-b", "confirm-before", target);
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<string>();
  let command: { handler(args: string, ctx: any): Promise<void> };
  extension({ registerFlag() {}, getFlag() { return false; }, registerCommand(_name: string, value: typeof command) { command = value; }, on() {}, sendMessage() {} } as any);
  const notices: string[] = [];
  const ctx: any = { hasUI: true, mode: "rpc", cwd: f.main, ui: {
    async select(_title: string, options: string[]) { const selected = options.find((x) => x.startsWith(JSON.stringify(target))); assert.ok(selected); entered.resolve(); return release.promise; },
    async confirm() { assert.fail("automatic removal must not ask for destructive confirmation"); },
    notify(message: string) { notices.push(message); },
  } };
  assert.equal(await stat(join(f.main, "SHELL_INJECTION")).catch(() => undefined), undefined);
  const pending = command!.handler("remove", ctx);
  await entered.promise;
  const selected = `${JSON.stringify(target)} — confirm-before`;
  git("worktree", "remove", target);
  git("worktree", "add", "-b", "replacement", target);
  await writeFile(join(target, "ignored-data"), "do not delete");
  release.resolve(selected);
  await pending;
  assert.equal(await readFile(join(target, "ignored-data"), "utf8"), "do not delete");
  assert.ok(notices.some((value) => value.includes("Automatic worktree removal is temporarily unavailable")));
  assert.ok(notices.some((value) => value.includes(JSON.stringify(target))));
  assert.ok(notices.some((value) => value.includes("JSON data, not shell quoting")));
  assert.ok(!notices.some((value) => value.includes(`git worktree remove -- ${JSON.stringify(target)}`)));
  await assert.rejects(removeWorktree(f.main, target), /Automatic worktree removal is temporarily unavailable/);
  assert.equal(await readFile(join(target, "ignored-data"), "utf8"), "do not delete");
  assert.equal(await stat(join(f.main, "SHELL_INJECTION")).catch(() => undefined), undefined);
});

test("automatic removal remains unavailable until a conditional identity-safe mechanism exists", { todo: "Git's path-based removal does not provide atomic expected identity" }, async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.b, "untracked-user-data"), "preserve");
  await assert.rejects(removeWorktree(f.main, f.b));
  assert.equal(await readFile(join(f.b, "untracked-user-data"), "utf8"), "preserve");
  await removeWorktree(f.main, f.a);
});
