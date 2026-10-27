import assert from "node:assert/strict";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Plugin } from "@opencode/plugin";
import piExtension from "../../src/adapters/pi/index.ts";
import opencodePlugin from "../../src/adapters/opencode/index.ts";
import { fixture } from "../helpers.ts";

test("pi and OpenCode warn on invalid Git root bytes, create no watchers, and shut down cleanly", { skip: process.platform === "win32" }, async (t) => {
  const f = await fixture(t), bin = join(f.root, "bin"); await mkdir(bin);
  await writeFile(join(bin, "git"), "#!/bin/sh\ncase \"$*\" in *' rev-parse --show-toplevel'*) printf '/private_\\377\\n'; exit 0;; esac\nexec /usr/bin/git \"$@\"\n"); await chmod(join(bin, "git"), 0o755);
  const previous = process.env.PATH; process.env.PATH = `${bin}:${previous ?? ""}`;
  const callbacks = new Map<string, (event: unknown, ctx: unknown) => Promise<void>>(), notices: string[] = [];
  piExtension({ registerFlag() {}, registerCommand() {}, getFlag() { return undefined; }, on(event: string, handler: (event: unknown, ctx: unknown) => Promise<void>) { callbacks.set(event, handler); return () => {}; } } as unknown as ExtensionAPI);
  const ctx = { mode: "rpc", cwd: f.b, ui: { notify(message: string) { notices.push(message); } } };
  const warnings: string[] = []; const mocked = t.mock.method(console, "warn", (...args: unknown[]) => { warnings.push(args.join(" ")); });
  try {
    await callbacks.get("session_start")!({}, ctx);
    assert.equal(notices.length, 1); assert.match(notices[0], /not valid UTF-8/); assert.ok(!notices[0].includes("/private_"));
    await callbacks.get("session_shutdown")!({}, ctx);
    const cleanup = await opencodePlugin.setup({ location: { directory: f.b }, session: { async hook() { return { async dispose() {} }; } }, event: { async *subscribe({ signal }: { signal: AbortSignal }) { await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true })); } } } as unknown as Plugin.Context);
    assert.equal(warnings.length, 1); assert.match(warnings[0], /not valid UTF-8/); assert.ok(!warnings[0].includes("/private_"));
    await cleanup();
  } finally { mocked.mock.restore(); if (previous === undefined) delete process.env.PATH; else process.env.PATH = previous; }
});

test("pi stays quiet and OpenCode warns outside Git, then both clean up", async (t) => {
  const f = await fixture(t), cwd = join(f.root, "non-git"); await mkdir(cwd);
  const callbacks = new Map<string, (event: unknown, ctx: unknown) => Promise<void>>(), notices: string[] = [];
  piExtension({ registerFlag() {}, registerCommand() {}, getFlag() { return undefined; }, on(event: string, handler: (event: unknown, ctx: unknown) => Promise<void>) { callbacks.set(event, handler); return () => {}; } } as unknown as ExtensionAPI);
  const ctx = { mode: "rpc", cwd, ui: { notify(message: string) { notices.push(message); } } };
  const warnings: string[] = []; const mocked = t.mock.method(console, "warn", (...args: unknown[]) => { warnings.push(args.join(" ")); });
  try {
    await callbacks.get("session_start")!({}, ctx); await callbacks.get("session_shutdown")!({}, ctx);
    const cleanup = await opencodePlugin.setup({ location: { directory: cwd }, session: { async hook() { return { async dispose() {} }; } }, event: { async *subscribe({ signal }: { signal: AbortSignal }) { await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true })); } } } as unknown as Plugin.Context); await cleanup();
    assert.equal(notices.length, 0); assert.equal(warnings.length, 1);
    assert.match(warnings[0], /Initialization failed/);
  } finally { mocked.mock.restore(); }
});
