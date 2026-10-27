import assert from "node:assert/strict";
import fs from "node:fs";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { detectPlatform } from "../../src/cli/platform-detection.ts";

test(
  "broken executable links are unavailable without blocking a later PATH match",
  { skip: process.platform === "win32" },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "gitrelay-client-links-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const broken = join(root, "broken"),
      valid = join(root, "valid"),
      empty = join(root, "empty");
    for (const directory of [broken, valid, empty]) await mkdir(directory);
    await symlink(join(root, "missing"), join(broken, "opencode"));
    await writeFile(join(valid, "opencode"), "#!/bin/sh\nprintf '2.1.2\\n'\n");
    await chmod(join(valid, "opencode"), 0o755);
    assert.equal((await detectPlatform("opencode", { PATH: broken })).status, "unavailable");
    assert.equal((await detectPlatform("opencode", { PATH: [broken, valid].join(delimiter) })).status, "installed");
    assert.equal((await detectPlatform("opencode", { PATH: empty })).status, "missing");
    const linked = join(root, "linked"),
      disabled = join(root, "disabled"),
      badTarget = join(root, "bad-target");
    for (const directory of [linked, disabled, badTarget]) await mkdir(directory);
    await symlink(join(valid, "opencode"), join(linked, "opencode"));
    assert.equal((await detectPlatform("opencode", { PATH: linked })).status, "installed");
    await writeFile(join(disabled, "opencode"), "not executable");
    await chmod(join(disabled, "opencode"), 0o600);
    assert.equal((await detectPlatform("opencode", { PATH: disabled })).status, "unavailable");
    const notDirectory = join(root, "not-directory");
    await writeFile(notDirectory, "file");
    await symlink(join(notDirectory, "missing"), join(badTarget, "opencode"));
    assert.equal((await detectPlatform("opencode", { PATH: badTarget })).status, "unavailable");
    assert.equal((await detectPlatform("opencode", { PATH: notDirectory })).status, "missing");
  },
);

test("platform lookup propagates cancellation during filesystem checks", async () => {
  const methods = fs.promises as unknown as Record<string, unknown>;
  const original = { stat: methods.stat, lstat: methods.lstat, access: methods.access };
  try {
    for (const phase of ["stat", "lstat", "access"] as const) {
      const controller = new AbortController(),
        reason = new Error(`cancelled in ${phase}`);
      methods.stat = async () => {
        if (phase === "stat") controller.abort(reason);
        if (phase !== "access") throw Object.assign(new Error("missing"), { code: "ENOENT" });
        return { isFile: () => true };
      };
      methods.lstat = async () => {
        controller.abort(reason);
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      };
      methods.access = async () => {
        controller.abort(reason);
      };
      syncBuiltinESMExports();
      await assert.rejects(
        detectPlatform("opencode", { PATH: "/synthetic" }, controller.signal),
        (error) => error === reason,
      );
    }
  } finally {
    Object.assign(methods, original);
    syncBuiltinESMExports();
  }
});
