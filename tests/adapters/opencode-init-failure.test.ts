import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { fixture } from "../helpers.ts";

for (const failure of ["git-error", "missing-git", "warning-error"] as const) {
  test(
    `OpenCode initialization handles ${failure} with recovery hooks`,
    { skip: process.platform === "win32" },
    async (t) => {
      const f = await fixture(t),
        bin = join(f.root, "failure-bin");
      await mkdir(bin);
      if (failure !== "missing-git") {
        await writeFile(join(bin, "git"), "#!/bin/sh\nprintf 'fatal: injected Git failure\\n' >&2\nexit 77\n");
        await chmod(join(bin, "git"), 0o755);
      }
      const module = pathToFileURL(join(process.cwd(), "src/adapters/opencode/index.ts")).href;
      const script = `
      import assert from "node:assert/strict";
      import plugin from ${JSON.stringify(module)};
      let registrations = 0, hook;
      const warnings = [];
      console.warn = (warning) => {
        if (${JSON.stringify(failure)} === "warning-error") throw new Error("warning failed");
        warnings.push(warning);
      };
      const cleanup = await plugin.setup({ location: { directory: ${JSON.stringify(f.b)} }, session: { async get() { return { location: { directory: ${JSON.stringify(f.b)} }, time: {created: 1} }; }, async hook(_name, handler) { registrations++; hook = handler; return {async dispose(){}}; } }, event: { async *subscribe({signal}) { await new Promise(resolve => signal.addEventListener("abort", resolve, {once:true})); } } });
      assert.equal(registrations, 1);
      assert.equal(typeof cleanup, "function");
      assert.equal(warnings.length, 0);
      await hook({sessionID: "enabled", prompt: {text: "Enable GitRelay"}});
      await cleanup();
      if (${JSON.stringify(failure)} === "warning-error") assert.equal(warnings.length, 0);
      else {
        assert.equal(warnings.length, 1);
        assert.match(warnings[0], /GitRelay/);
        assert.match(warnings[0], ${failure === "missing-git" ? "/ENOENT/" : "/injected Git failure/"});
      }
    `;
      assert.doesNotThrow(() =>
        execFileSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], {
          env: { ...process.env, PATH: bin },
          timeout: 20_000,
          stdio: "pipe",
        }),
      );
    },
  );
}
