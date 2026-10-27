import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { publishBootstrap } from "../../src/cli/bootstrap.ts";

for (const failure of ["publication", "concurrent-edit", "replacement"] as const) test("launcher migration preserves state after " + failure, async (t) => {
  const root = await fs.promises.mkdtemp(join(tmpdir(), "gitrelay-launcher-publication-"));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const pointer = join(root, "current.mjs");
  await fs.promises.writeFile(pointer, "owned old launcher");
  const rename = fs.promises.rename, link = fs.promises.link;
  const mockedRename = t.mock.method(fs.promises, "rename", async (...args: Parameters<typeof rename>) => {
    if (args[0] === pointer && failure === "concurrent-edit") await fs.promises.writeFile(pointer, "concurrent user edit");
    return rename(...args);
  });
  const mockedLink = t.mock.method(fs.promises, "link", async (...args: Parameters<typeof link>) => {
    if (args[1] === pointer && String(args[0]).endsWith(".tmp")) {
      if (failure === "publication") throw Object.assign(new Error("injected publication failure"), { code: "EIO" });
      if (failure === "replacement") await fs.promises.writeFile(pointer, "concurrent replacement");
    }
    return link(...args);
  });
  syncBuiltinESMExports();
  try { await assert.rejects(publishBootstrap(pointer, "owned old launcher", "new launcher"), /preserved archive/); }
  finally { mockedRename.mock.restore(); mockedLink.mock.restore(); syncBuiltinESMExports(); }
  const expected = failure === "publication" ? "owned old launcher" : failure === "concurrent-edit" ? "concurrent user edit" : "concurrent replacement";
  assert.equal(await fs.promises.readFile(pointer, "utf8"), expected);
  const archive = (await fs.promises.readdir(root)).find((name) => name.startsWith(".git-relay-launcher-"));
  assert.ok(archive);
  assert.equal(await fs.promises.readFile(join(root, archive, "previous.mjs"), "utf8"), failure === "concurrent-edit" ? "concurrent user edit" : "owned old launcher");
  if (failure === "publication") {
    await publishBootstrap(pointer, "owned old launcher", "new launcher");
    assert.equal(await fs.promises.readFile(pointer, "utf8"), "new launcher");
  }
});
