import { createHash, randomUUID } from "node:crypto";
import { cp, link, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { readJson, withLock, writeJson } from "../core/store.ts";
import { commandOutput } from "./command-output.ts";
import { installerDigest } from "./installer-digest.ts";

const files = ["dist", "skills", "docs"];
type Options = { workspace: string; command?: string; env?: NodeJS.ProcessEnv; signal?: AbortSignal };
type InstallOptions = Options & { sourceRoot: string };
type Launcher = { skills: string; node: string; version: string; initialSource: string; current: string | null; pending?: string };
type Journal = { schema: 1; name: string; marketplaceIntent: boolean; installIntent: boolean; applied?: object; pending?: object; launcher?: Launcher };

async function ownedJson(path: string): Promise<unknown | undefined> {
  try {
    if (!(await lstat(path)).isFile()) throw new Error(`GitRelay installer file is not a regular file: ${path}`);
    return await readJson(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function ownedDirectory(path: string): Promise<void> {
  try { await mkdir(path, { mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  if (!(await lstat(path)).isDirectory()) throw new Error(`GitRelay installer directory is not a directory: ${path}`);
}

const fingerprint = (root: string, names = files, signal?: AbortSignal) => installerDigest(root, names, "claude", signal);

async function invoke(options: Options, args: string[]): Promise<unknown> {
  try {
    const stdout = await commandOutput(options.command ?? "claude", [...args, "--json"], options.env ?? process.env, 30000, 4 * 1024 * 1024, options.signal);
    return JSON.parse(stdout);
  } catch (error) {
    options.signal?.throwIfAborted();
    throw new Error(`Claude plugin command failed (${args.slice(0, 3).join(" ")}): ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function listing(options: Options, args: string[]): Promise<Record<string, unknown>[]> {
  const value = await invoke(options, args);
  if (!Array.isArray(value) || value.some((item) => !item || typeof item !== "object" || Array.isArray(item))) throw new Error("Unexpected Claude plugin listing");
  return value;
}

async function setupDirectory(workspace: string): Promise<string> {
  await mkdir(workspace, { recursive: true, mode: 0o700 });
  const directory = join(workspace, "claude");
  try {
    await lstat(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const id = randomUUID();
    const name = `.claude-stage-${id}`;
    const stage = join(workspace, name);
    await mkdir(stage, { mode: 0o700 });
    let published = false;
    try {
      await writeJson(join(stage, "owner.json"), { schema: 1, name: `git-relay-${id}` });
      try {
        await symlink(name, directory, "dir");
        published = true;
      } catch (failure) {
        if ((failure as NodeJS.ErrnoException).code !== "EEXIST") throw failure;
      }
    } finally {
      if (!published) console.error(`GitRelay retained unpublished Claude installer stage: ${resolve(stage)}`);
    }
  }
  const info = await lstat(directory);
  let stageId: string | undefined;
  if (info.isSymbolicLink()) {
    stageId = (await readlink(directory)).match(/^\.claude-stage-([0-9a-f-]{36})$/)?.[1];
    if (!stageId || !(await lstat(join(workspace, `.claude-stage-${stageId}`))).isDirectory()) throw new Error(`Claude installer directory is not owned by GitRelay: ${directory}`);
  } else if (!info.isDirectory()) throw new Error(`Claude installer directory is not owned by GitRelay: ${directory}`);
  if (!(await lstat(join(directory, "owner.json"))).isFile()) throw new Error(`Claude installer directory is not owned by GitRelay: ${directory}`);
  const owner = await readJson(join(directory, "owner.json")) as { schema?: unknown; name?: unknown } | undefined;
  if (owner?.schema !== 1 || typeof owner.name !== "string" || !/^git-relay-[0-9a-f-]{36}$/.test(owner.name) || (stageId && owner.name !== `git-relay-${stageId}`)) throw new Error(`Claude installer directory is not owned by GitRelay: ${directory}`);
  return directory;
}

async function journal(directory: string): Promise<Journal> {
  const owner = await readJson(join(directory, "owner.json")) as { name: string };
  const value = await ownedJson(join(directory, "journal.json"));
  if (value === undefined) return { schema: 1, name: owner.name, marketplaceIntent: false, installIntent: false };
  const state = value as Journal;
  if (!state || state.schema !== 1 || state.name !== owner.name || typeof state.marketplaceIntent !== "boolean" || typeof state.installIntent !== "boolean") throw new Error("Invalid Claude installer journal");
  if (state.launcher !== undefined && (!state.launcher || typeof state.launcher !== "object" || Array.isArray(state.launcher))) throw new Error("Invalid Claude launcher state");
  return state;
}

async function packagePlugin(source: string, directory: string, launcher?: string, node = process.execPath, signal?: AbortSignal): Promise<string> {
  const digest = await fingerprint(source, files, signal);
  const manifest = JSON.parse(await readFile(join(source, "package.json"), "utf8")) as { version?: unknown };
  if (typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(manifest.version)) throw new Error("Invalid package version");
  const revision = `${digest}-${createHash("sha256").update(`${manifest.version}\0${node}${launcher ? `\0${launcher}` : ""}`).digest("hex").slice(0, 16)}`;
  const market = join(directory, "marketplace");
  const target = join(market, `plugin-${revision}`);
  const pluginManifest = manifestFor(manifest.version);
  const hooks = hooksFor(launcher, node);
  await ownedDirectory(market);
  let existing = false;
  try {
    const info = await lstat(target);
    existing = true;
    if (!info.isDirectory() || await fingerprint(target, files, signal) !== digest ||
        !same(await readJson(join(target, ".claude-plugin", "plugin.json")), pluginManifest) ||
        !same(await readJson(join(target, "hooks", "hooks.json")), hooks) ||
        !same(await readJson(join(target, "package.json")), { type: "module" })) throw new Error(`Existing Claude plugin snapshot was modified: ${target}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    if (existing) throw new Error(`Existing Claude plugin snapshot was modified: ${target}`, { cause: error });
    const staging = await mkdtemp(join(market, ".plugin-"));
    try {
      for (const name of files) await cp(join(source, name), join(staging, name), { recursive: true });
      if (await fingerprint(staging, files, signal) !== digest) throw new Error("Source changed while building Claude plugin");
      await mkdir(join(staging, ".claude-plugin"));
      await writeJson(join(staging, ".claude-plugin", "plugin.json"), pluginManifest);
      await mkdir(join(staging, "hooks"));
      await writeJson(join(staging, "hooks", "hooks.json"), hooks);
      await writeJson(join(staging, "package.json"), { type: "module" });
      await rename(staging, target);
    } catch (error) { await rm(staging, { recursive: true, force: true }); throw error; }
  }
  return `./plugin-${revision}`;
}

function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }

function manifestFor(version: string) {
  return { name: "git-relay", version, description: "Git worktree coordination", author: { name: "shenyankm" } };
}

function hooksFor(launcher?: string, node = process.execPath) {
  const hook = { type: "command", command: node, args: [launcher ?? "${CLAUDE_PLUGIN_ROOT}/dist/cli/main.js", "hook", "claude-code"], timeout: 60 };
  return { hooks: Object.fromEntries(["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop"].map((event) => [event, [{ hooks: [hook] }]])) };
}

const launcherBody = `const fs = require("node:fs");\nconst path = require("node:path");\nconst { pathToFileURL } = require("node:url");\nlet revision;\nfor (let attempt = 0; attempt < 3; attempt++) {\n  const state = JSON.parse(fs.readFileSync(path.join(__dirname, "journal.json"), "utf8"));\n  const latest = fs.readdirSync(path.join(__dirname, "revisions")).sort().at(-1);\n  if (latest && /^\\d{20}-[a-f0-9]{64}-[a-f0-9]{16}$/.test(latest) && (latest === state.launcher?.current || latest === state.launcher?.pending)) { revision = latest; break; }\n}\nif (!revision) throw new Error("Invalid GitRelay Claude revision");\nimport(pathToFileURL(path.join(__dirname, "marketplace", "plugin-" + revision.slice(21), "dist", "cli", "main.js")).href).catch((error) => { console.error(error); process.exitCode = 1; });\n`;

async function publishLauncher(path: string): Promise<void> {
  const actual = await ownedJsonText(path);
  if (actual !== undefined) {
    if (actual !== launcherBody) throw new Error(`Claude launcher was modified; preserved: ${path}`);
    return;
  }
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, launcherBody, { flag: "wx", mode: 0o600 });
    await link(temp, path);
  } finally { await rm(temp, { force: true }); }
}

async function ownedJsonText(path: string): Promise<string | undefined> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.size > 2 * 1024 * 1024) throw new Error(`GitRelay installer file is not a small regular file: ${path}`);
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function activateLauncher(directory: string, state: Journal, source: string, skills: string, save: () => Promise<void>, signal?: AbortSignal): Promise<string> {
  const initialManifest = await ownedJson(join(directory, "marketplace", source, ".claude-plugin", "plugin.json")) as { version?: unknown } | undefined;
  if (!state.launcher && typeof initialManifest?.version !== "string") throw new Error("Invalid Claude plugin version");
  const launcher: Launcher = state.launcher ?? { skills, node: process.execPath, version: initialManifest!.version as string, initialSource: source, current: null };
  const revisionPattern = /^\d{20}-[a-f0-9]{64}-[a-f0-9]{16}$/;
  if (typeof launcher.skills !== "string" || !/^[a-f0-9]{64}$/.test(launcher.skills) || launcher.skills !== skills) throw new Error("Claude skill changes require manual plugin migration; installed skills preserved");
  if (typeof launcher.node !== "string" || !isAbsolute(launcher.node) || launcher.node.includes("\0") || typeof launcher.version !== "string" || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(launcher.version) || typeof launcher.initialSource !== "string" || !/^\.\/plugin-[a-f0-9]{64}-[a-f0-9]{16}$/.test(launcher.initialSource) || !(launcher.current === null || (typeof launcher.current === "string" && revisionPattern.test(launcher.current))) || (launcher.pending !== undefined && (typeof launcher.pending !== "string" || !revisionPattern.test(launcher.pending)))) throw new Error("Invalid Claude launcher state");
  const initial = join(directory, "marketplace", launcher.initialSource);
  if (!same(await ownedJson(join(initial, ".claude-plugin", "plugin.json")), manifestFor(launcher.version)) || !same(await ownedJson(join(initial, "hooks", "hooks.json")), hooksFor(join(directory, "launcher.cjs"), launcher.node)) || !same(await ownedJson(join(initial, "package.json")), { type: "module" })) throw new Error("Installed Claude plugin metadata was modified; preserved");
  const revisions = join(directory, "revisions");
  await ownedDirectory(revisions);
  const names = (await readdir(revisions)).sort();
  if (names.some((name) => !revisionPattern.test(name))) throw new Error(`Unexpected Claude revision; preserved: ${revisions}`);
  for (const name of names) if (await ownedJsonText(join(revisions, name)) !== "") throw new Error(`Claude revision was modified: ${name}`);
  const latest = names.at(-1);
  if ((!state.launcher && latest) || (state.launcher && (latest ?? null) !== launcher.current && (latest ?? null) !== launcher.pending)) throw new Error("Claude revisions changed outside GitRelay; preserved");
  if (latest) {
    const runtime = join(directory, "marketplace", `plugin-${latest.slice(21)}`);
    if (await fingerprint(runtime, files, signal) !== latest.slice(21, 85)) throw new Error(`Claude runtime was modified: ${runtime}`);
  }
  const id = source.slice("./plugin-".length);
  const desired = latest?.endsWith(`-${id}`) ? latest : `${String(BigInt(latest?.slice(0, 20) ?? "0") + 1n).padStart(20, "0")}-${id}`;
  if (!revisionPattern.test(desired)) throw new Error("Claude revision counter exhausted");
  await publishLauncher(join(directory, "launcher.cjs"));
  launcher.current = latest ?? null;
  launcher.pending = desired;
  state.launcher = launcher;
  await save();
  if (latest !== desired) await writeFile(join(revisions, desired), "", { flag: "wx", mode: 0o600 });
  launcher.current = desired;
  delete launcher.pending;
  await save();
  return launcher.initialSource;
}

async function publishManifest(path: string, value: object): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value), { flag: "wx", mode: 0o600 });
    try { await link(temporary, path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || !same(await ownedJson(path), value)) throw new Error("Claude marketplace manifest already exists or changed; preserved");
    }
  } finally { await rm(temporary, { force: true }); }
}

export async function installClaude(options: InstallOptions): Promise<{ id: string; enabled: boolean }> {
  options.signal?.throwIfAborted();
  const directory = await setupDirectory(options.workspace);
  return withLock(join(directory, "install.lock"), async () => {
    const state = await journal(directory);
    const market = join(directory, "marketplace");
    const manifestPath = join(market, ".claude-plugin", "marketplace.json");
    const save = () => writeJson(join(directory, "journal.json"), state);
    const existingManifest = await ownedJson(manifestPath) as { plugins?: { source?: string }[] } | undefined;
    if (!same(existingManifest, state.applied) && !same(existingManifest, state.pending)) throw new Error("Claude marketplace manifest changed outside GitRelay; preserving it");
    const existingMarkets = (await listing(options, ["plugin", "marketplace", "list"])).filter((item) => item.name === state.name);
    if (existingMarkets.length > 1 || (existingMarkets.length && (!state.marketplaceIntent || existingMarkets[0].source !== "directory" || existingMarkets[0].path !== market))) throw new Error("Claude marketplace already exists or has a different owner");
    const existingId = `git-relay@${state.name}`;
    const existingPlugins = (await listing(options, ["plugin", "list"])).filter((item) => item.id === existingId && item.scope === "user");
    const existingSource = existingManifest?.plugins?.[0]?.source;
    if (existingPlugins.length > 1 || (existingPlugins.length && (!state.installIntent || typeof existingSource !== "string" || existingPlugins[0].readFromFolder !== join(market, existingSource)))) throw new Error("Claude plugin already exists or has a different owner");
    if (state.pending) {
      const current = await ownedJson(manifestPath);
      if (!same(current, state.pending) && !same(current, state.applied)) throw new Error("Claude marketplace manifest changed outside GitRelay; preserving it");
      if (!same(current, state.pending)) {
        if (current !== undefined) throw new Error("Interrupted Claude upgrade requires manual reconciliation; existing manifest preserved");
        await publishManifest(manifestPath, state.pending);
      }
      state.applied = state.pending; delete state.pending; await save();
    }
    const marketBefore = (await listing(options, ["plugin", "marketplace", "list"])).filter((item) => item.name === state.name);
    if (marketBefore.length > 1 || (marketBefore.length && (!state.marketplaceIntent || marketBefore[0].source !== "directory" || marketBefore[0].path !== market))) throw new Error("Claude marketplace already exists or has a different owner");
    const priorId = `git-relay@${state.name}`;
    const pluginsBefore = (await listing(options, ["plugin", "list"])).filter((item) => item.id === priorId && item.scope === "user");
    const priorSource = (state.applied as { plugins?: { source?: string }[] } | undefined)?.plugins?.[0]?.source;
    if (pluginsBefore.length > 1 || (pluginsBefore.length && (!state.installIntent || typeof priorSource !== "string" || pluginsBefore[0].readFromFolder !== join(market, priorSource)))) throw new Error("Claude plugin already exists or has a different owner");
    const useLauncher = Boolean(state.launcher) || (!state.applied && !state.pending && !state.marketplaceIntent && !state.installIntent);
    const skills = useLauncher ? await fingerprint(options.sourceRoot, ["skills"], options.signal) : "";
    if (state.launcher && state.launcher.skills !== skills) throw new Error("Claude skill changes require manual plugin migration; installed skills preserved");
    const node = state.launcher?.node ?? process.execPath;
    if (typeof node !== "string" || !isAbsolute(node) || node.includes("\0")) throw new Error("Invalid Claude launcher state");
    if (state.launcher) {
      try {
        const version = /^v(\d+)\.(\d+)\.(\d+)\s*$/.exec(await commandOutput(node, ["--version"], options.env ?? process.env, 5000, 4096, options.signal));
        if (!version || Number(version[1]) < 22 || (Number(version[1]) === 22 && Number(version[2]) < 19)) throw new Error("Unsupported Node version");
      } catch {
        options.signal?.throwIfAborted();
        throw new Error(`Claude hook's Node executable is unavailable or incompatible: ${node}; migrate or reinstall the plugin to use the current Node.`);
      }
    }
    const snapshot = await packagePlugin(options.sourceRoot, directory, useLauncher ? join(directory, "launcher.cjs") : undefined, node, options.signal);
    if (useLauncher) {
      if (await fingerprint(join(market, snapshot), ["skills"], options.signal) !== skills) throw new Error("Claude skills changed while packaging; retry installation");
      if (state.launcher) {
        if (typeof state.launcher.initialSource !== "string" || !/^\.\/plugin-[a-f0-9]{64}-[a-f0-9]{16}$/.test(state.launcher.initialSource)) throw new Error("Invalid Claude launcher state");
        if (await fingerprint(join(market, state.launcher.initialSource), ["skills"], options.signal) !== skills) throw new Error("Installed Claude skills were modified; preserved");
      }
      await commandOutput(node, [join(market, snapshot, "dist", "cli", "main.js"), "--help"], options.env ?? process.env, 5000, 1024 * 1024, options.signal);
    }
    const source = useLauncher ? await activateLauncher(directory, state, snapshot, skills, save, options.signal) : snapshot;
    await ownedDirectory(join(market, ".claude-plugin"));
    const current = await ownedJson(manifestPath);
    if (!same(current, state.applied)) throw new Error("Claude marketplace manifest changed outside GitRelay; preserving it");
    const next = { name: state.name, owner: { name: "GitRelay" }, description: "Git worktree coordination", plugins: [{ name: "git-relay", source }] };
    if (!same(next, current)) {
      if (current !== undefined) throw new Error("Claude plugin upgrade is not supported yet; existing marketplace manifest preserved");
      state.pending = next; await save(); await publishManifest(manifestPath, next);
      state.applied = next; delete state.pending; await save();
    }
    const marketList = await listing(options, ["plugin", "marketplace", "list"]);
    const matches = marketList.filter((item) => item.name === state.name);
    if (matches.length > 1 || (matches.length && (!state.marketplaceIntent || matches[0].source !== "directory" || matches[0].path !== market))) throw new Error("Claude marketplace already exists or has a different owner");
    if (!matches.length) {
      state.marketplaceIntent = true; await save();
      await invoke(options, ["plugin", "marketplace", "add", market, "--scope", "user"]);
    }
    const id = `git-relay@${state.name}`;
    const installed = (await listing(options, ["plugin", "list"])).filter((item) => item.id === id && item.scope === "user");
    if (installed.length > 1 || (installed.length && (!state.installIntent || installed[0].readFromFolder !== join(market, source)))) throw new Error("Claude plugin already exists or has a different owner");
    if (!installed.length) {
      state.installIntent = true; await save();
      await invoke(options, ["plugin", "install", id, "--scope", "user"]);
    }
    const confirmed = (await listing(options, ["plugin", "list"])).filter((item) => item.id === id && item.scope === "user" && item.readFromFolder === join(market, source));
    if (confirmed.length !== 1) throw new Error("Claude plugin installation could not be verified");
    return { id, enabled: confirmed[0].enabled === true };
  }, { waitMs: 5000, signal: options.signal });
}

export async function hasClaudeInstall(workspace: string): Promise<boolean> {
  const directory = join(workspace, "claude");
  try { await lstat(directory); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  try {
    if (!(await stat(directory)).isDirectory()) throw new Error(`Invalid Claude installation directory: ${directory}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`Invalid Claude installation directory: ${directory}`);
    throw error;
  }
  return true;
}

export async function uninstallClaude(options: Options): Promise<{ removed: boolean; retainedMarketplace: boolean }> {
  options.signal?.throwIfAborted();
  const directory = join(options.workspace, "claude");
  if (!await hasClaudeInstall(options.workspace)) return { removed: false, retainedMarketplace: false };
  await setupDirectory(options.workspace);
  return withLock(join(directory, "install.lock"), async () => {
    const state = await journal(directory);
    const market = join(directory, "marketplace");
    if (state.pending) {
      const current = await ownedJson(join(market, ".claude-plugin", "marketplace.json"));
      if (!same(current, state.pending) && !same(current, state.applied)) throw new Error("Claude marketplace manifest changed outside GitRelay; preserving it");
      if (same(current, state.pending)) state.applied = state.pending;
      delete state.pending;
      await writeJson(join(directory, "journal.json"), state);
    }
    const markets = (await listing(options, ["plugin", "marketplace", "list"])).filter((item) => item.name === state.name);
    if (markets.length > 1 || (markets.length && (!state.marketplaceIntent || markets[0].source !== "directory" || markets[0].path !== market))) throw new Error("Claude marketplace has a different owner; preserving it");
    const id = `git-relay@${state.name}`;
    const manifest = await ownedJson(join(market, ".claude-plugin", "marketplace.json")) as { plugins?: { source?: string }[] } | undefined;
    if (!same(manifest, state.applied)) throw new Error("Claude marketplace manifest has a different owner; preserving it");
    const plugins = (await listing(options, ["plugin", "list"])).filter((item) => item.id === id && item.scope === "user");
    const source = manifest?.plugins?.[0]?.source;
    if (plugins.length > 1 || (plugins.length && (!state.installIntent || !same(manifest, state.applied) || typeof source !== "string" || plugins[0].readFromFolder !== join(market, source)))) throw new Error("Claude plugin has a different owner; preserving it");
    if (plugins.length) {
      await invoke(options, ["plugin", "uninstall", id, "--scope", "user", "--keep-data"]);
      if ((await listing(options, ["plugin", "list"])).some((item) => item.id === id && item.scope === "user")) throw new Error("Claude plugin removal could not be verified");
    }
    state.installIntent = false;
    await writeJson(join(directory, "journal.json"), state);
    return { removed: plugins.length === 1, retainedMarketplace: markets.length === 1 };
  }, { waitMs: 5000, signal: options.signal });
}
