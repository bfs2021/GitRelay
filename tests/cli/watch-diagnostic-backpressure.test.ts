import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";

const cli = join(process.cwd(), "src/cli/main.ts");
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const script = (program: string) => `#!/bin/sh\nexec ${shellQuote(process.execPath)} -e ${shellQuote(program)}\n`;
for (const command of ["status", "watch"] as const) {
  test(
    `${command} bounds diagnostics and responds to SIGTERM`,
    { skip: process.platform === "win32", timeout: 30_000 },
    async (t) => {
      const base = await mkdtemp(join(tmpdir(), "gitrelay-watch-bounded-"));
      let cleanupChild: (() => Promise<void>) | undefined;
      t.after(async () => {
        await cleanupChild?.();
        await rm(base, { recursive: true, force: true });
      });
      const home = join(base, "home"),
        template = join(base, "template"),
        bin = join(base, "bin"),
        repo = join(base, "repo");
      for (const path of [home, template, bin]) await mkdir(path);
      const env = {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        HOME: home,
        TMPDIR: base,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_TERMINAL_PROMPT: "0",
      };
      execFileSync("git", ["init", "--template", template, "-b", "main", repo], { env, stdio: "ignore" });
      const executable = join(bin, "git");
      await writeFile(executable, script("process.stderr.write('x'.repeat(2000000)); process.exitCode=77;"));
      await chmod(executable, 0o755);
      const metrics = join(base, "metrics.jsonl"),
        preload = join(base, "measure.mjs");
      await writeFile(
        preload,
        `import fs from 'node:fs'; const out=process.stderr.write.bind(process.stderr); process.stderr.write=(...args)=>{ const r=out(...args); fs.appendFileSync(${JSON.stringify(metrics)},JSON.stringify({queued:process.stderr.writableLength,blocked:!r})+'\\n'); return r; };\n`,
      );
      const args =
        command === "status"
          ? ["status", "--cwd", repo, "--watch", "--interval-ms", "50"]
          : ["watch", "--cwd", repo, "--session", "test"];
      const child = spawn(process.execPath, ["--experimental-strip-types", "--import", preload, cli, ...args], {
        env: { ...env, PATH: `${bin}${delimiter}${env.PATH}`, WORKTREE_SYNC_STATE_DIR: join(base, "state") },
        stdio: ["ignore", "ignore", "pipe"],
      });
      const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) => resolve({ code, signal }));
      });
      cleanupChild = async () => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        await done.catch(() => {});
      };
      const deadline = performance.now() + 12000;
      let rows: { queued: number; blocked: boolean }[] = [];
      const readMetrics = async () => {
        const text = await readFile(metrics, "utf8").catch((error) => {
          if (error.code === "ENOENT") return "";
          throw error;
        });
        return text
          .split("\n")
          .slice(0, -1)
          .map((line) => JSON.parse(line) as { queued: number; blocked: boolean });
      };
      while (performance.now() < deadline) {
        rows = await readMetrics();
        if (command === "status" ? rows.some((row) => row.blocked) : rows.length > 0) break;
        await delay(20);
      }
      assert.ok(rows.length >= 1, "diagnostics reached stderr");
      if (command === "status") {
        assert.ok(
          rows.some((row) => row.blocked),
          "stderr reached backpressure",
        );
        const count = rows.length;
        await delay(300);
        rows = await readMetrics();
        assert.equal(rows.length, count, "diagnostics stop while stderr is backpressured");
        child.stderr!.resume();
        while (performance.now() < deadline && rows.length <= count) {
          await delay(20);
          rows = await readMetrics();
        }
        assert.ok(rows.length > count, "diagnostics resume after the pipe drains");
      }
      child.kill("SIGTERM");
      assert.deepEqual(await Promise.race([done, delay(3000, "timeout" as const)]), { code: 0, signal: null });
      assert.ok(
        Math.max(...rows.map((row) => row.queued)) <= 128 * 1024,
        `stderr backlog grew to ${Math.max(...rows.map((row) => row.queued))}`,
      );
    },
  );
}

test(
  "status reports a bounded error with a visible truncation marker",
  { skip: process.platform === "win32", timeout: 30_000 },
  async (t) => {
    const base = await mkdtemp(join(tmpdir(), "gitrelay-watch-readable-"));
    let cleanupChild: (() => Promise<void>) | undefined;
    t.after(async () => {
      await cleanupChild?.();
      await rm(base, { recursive: true, force: true });
    });
    const home = join(base, "home"),
      template = join(base, "template"),
      bin = join(base, "bin"),
      repo = join(base, "repo");
    for (const path of [home, template, bin]) await mkdir(path);
    const env = {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: home,
      TMPDIR: base,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    };
    execFileSync("git", ["init", "--template", template, "-b", "main", repo], { env, stdio: "ignore" });
    const executable = join(bin, "git");
    await writeFile(
      executable,
      script("process.stderr.write('sentinel:'+'x'.repeat(4086)+'😀'+'x'.repeat(10000)); process.exitCode=77;"),
    );
    await chmod(executable, 0o755);
    const child = spawn(
      process.execPath,
      ["--experimental-strip-types", cli, "status", "--cwd", repo, "--watch", "--interval-ms", "50"],
      { env: { ...env, PATH: `${bin}${delimiter}${env.PATH}` }, stdio: ["ignore", "ignore", "pipe"] },
    );
    const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    cleanupChild = async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await done.catch(() => {});
    };
    let diagnostics = "";
    child.stderr!.setEncoding("utf8");
    child.stderr!.on("data", (chunk) => {
      diagnostics += chunk;
    });
    const deadline = performance.now() + 5000;
    while (!diagnostics.includes("[diagnostic truncated]")) {
      if (performance.now() > deadline) throw new Error("No truncated diagnostic");
      await delay(20);
    }
    child.kill("SIGTERM");
    assert.deepEqual(await Promise.race([done, delay(3000, "timeout" as const)]), { code: 0, signal: null });
    const first = diagnostics.split("\n")[0];
    assert.ok(first.startsWith("sentinel:"));
    assert.ok(first.endsWith("[diagnostic truncated]"));
    assert.ok(!first.includes("�"), "truncation preserves Unicode surrogate boundaries");
    assert.ok(first.length < 4200);
  },
);

test(
  "closed stderr does not terminate status watch",
  { skip: process.platform === "win32", timeout: 30_000 },
  async (t) => {
    const base = await mkdtemp(join(tmpdir(), "gitrelay-watch-closed-stderr-"));
    let cleanupChild: (() => Promise<void>) | undefined;
    t.after(async () => {
      await cleanupChild?.();
      await rm(base, { recursive: true, force: true });
    });
    const home = join(base, "home"),
      template = join(base, "template"),
      bin = join(base, "bin"),
      repo = join(base, "repo");
    for (const path of [home, template, bin]) await mkdir(path);
    const env = {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: home,
      TMPDIR: base,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    };
    execFileSync("git", ["init", "--template", template, "-b", "main", repo], { env, stdio: "ignore" });
    const executable = join(bin, "git");
    await writeFile(executable, script("process.stderr.write('git error'); process.exitCode=77;"));
    await chmod(executable, 0o755);
    const child = spawn(
      process.execPath,
      ["--experimental-strip-types", cli, "status", "--cwd", repo, "--watch", "--interval-ms", "50"],
      { env: { ...env, PATH: `${bin}${delimiter}${env.PATH}` }, stdio: ["ignore", "ignore", "pipe"] },
    );
    const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    cleanupChild = async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await done.catch(() => {});
    };
    child.stderr!.destroy();
    await delay(1000);
    assert.equal(child.exitCode, null);
    child.kill("SIGTERM");
    assert.deepEqual(await Promise.race([done, delay(3000, "timeout" as const)]), { code: 0, signal: null });
  },
);
