import { spawn } from "node:child_process";
import { installerDigest } from "./installer-digest.ts";
import { cp, link, lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readJson, withLock, writeJson } from "../core/store.ts";
import { readInstallationRecord } from "./install-record.ts";
import { commandOutput } from "./command-output.ts";

type Options = { workspace: string; sourceRoot: string; env?: NodeJS.ProcessEnv; signal?: AbortSignal };
type Record = { agentDir: string; current: string | null; pending?: string; entryWitness?: string; skillWitness?: string; nextSkillWitness?: string; skillArchive?: string; entryArchive?: string; removing?: boolean; removed?: boolean };
const files = ["package.json", "src", "skills/worktree-coordination"];

const digest = (root: string, signal?: AbortSignal) => installerDigest(root, files, "pi", signal);

async function canonicalDirectory(path: string): Promise<string> {
  try { return await realpath(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    try { await lstat(path); throw new Error(`Cannot resolve existing pi directory: ${path}`); }
    catch (failure) { if ((failure as NodeJS.ErrnoException).code !== "ENOENT") throw failure; }
    const parent = dirname(path);
    if (parent === path) throw error;
    return join(await canonicalDirectory(parent), basename(path));
  }
}

export async function agentDirectory(env: NodeJS.ProcessEnv): Promise<string> {
  const configured = env.PI_CODING_AGENT_DIR;
  return canonicalDirectory(resolve(configured || join(env.HOME || homedir(), ".pi", "agent")));
}

async function prepare(workspace: string, sourceRoot: string, signal?: AbortSignal): Promise<string> {
  const id = await digest(sourceRoot, signal);
  const versions = join(workspace, "pi-versions");
  const target = join(versions, id);
  await mkdir(versions, { recursive: true });
  const exists = await lstat(target).then(() => true, (error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return false; throw error; });
  if (exists) {
    try {
      if (!(await lstat(target)).isDirectory()) throw new Error(`Not a directory: ${target}`);
      if (await digest(target, signal) !== id) throw new Error(`Pi runtime was modified: ${target}`);
    } catch (error) { signal?.throwIfAborted(); throw new Error(`Pi runtime was modified: ${target}`, { cause: error }); }
  } else {
    const stage = await mkdtemp(join(versions, ".stage-"));
    try {
      await mkdir(join(stage, "skills"));
      for (const path of files) await cp(join(sourceRoot, path), join(stage, path), { recursive: true });
      if (await digest(stage, signal) !== id) throw new Error("Pi package changed while copying; retry installation.");
      await rename(stage, target);
    } finally { await rm(stage, { recursive: true, force: true }); }
  }
  return target;
}

async function owner(workspace: string): Promise<void> {
  if (await readFile(join(workspace, ".git-relay-owner"), "utf8") !== "git-relay installer v1\n") throw new Error(`Not an owned GitRelay workspace: ${workspace}`);
}

async function validateRuntime(workspace: string, runtime: string, env: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  const dir = await mkdtemp(join(workspace, ".pi-validation-"));
  try {
    const valid = await new Promise<boolean>((resolveResult, reject) => {
      const child = spawn("pi", ["--mode", "rpc", "--no-session", "--no-mcp", "--offline", "--no-extensions", "--no-skills", "--extension", join(runtime, "src", "adapters", "pi", "index.ts"), "--skill", join(runtime, "skills", "worktree-coordination")], { cwd: dir, env: { ...env, HOME: dir, PI_CODING_AGENT_DIR: dir, PI_OFFLINE: "1", PI_TELEMETRY: "0" }, detached: true, stdio: ["pipe", "pipe", "pipe"] });
      let buffer = "", result = false, stopping = false, failure: Error | undefined;
      const stop = (error?: Error) => {
        if (stopping) return;
        stopping = true; failure = error;
        if (child.pid) {
          try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
        }
        child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
      };
      const timeout = setTimeout(() => stop(new Error("Pi runtime validation timed out")), 10_000);
      const abort = () => stop(signal?.reason instanceof Error ? signal.reason : new Error("Pi runtime validation cancelled"));
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      child.on("error", stop);
      child.stdout.on("data", (chunk) => {
        buffer += String(chunk);
        if (buffer.length > 4 * 1024 * 1024) { stop(new Error("Pi runtime validation output is too large")); return; }
        const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
        for (const line of lines) {
          try {
            const response = JSON.parse(line);
            if (response.id !== "git-relay-install-check") continue;
            const names = response.data?.commands?.map((command: { name: string }) => command.name);
            result = response.success === true && Array.isArray(names) && names.includes("worktree") && names.includes("skill:worktree-coordination");
            stop();
            return;
          } catch { /* Ignore non-protocol output. */ }
        }
      });
      child.stderr.resume();
      child.on("close", () => {
        clearTimeout(timeout); signal?.removeEventListener("abort", abort);
        if (failure) reject(failure); else resolveResult(result);
      });
      child.stdin.on("error", () => {});
      child.stdin.end('{"id":"git-relay-install-check","type":"get_commands"}\n');
    });
    if (!valid) throw new Error("Pi could not load the staged extension and skill; existing installation preserved.");
  } finally { await rm(dir, { recursive: true, force: true }); }
}


const revisionPattern = /^\d{20}-[a-f0-9]{64}$/;
const loader = `import { readFile, readdir } from "node:fs/promises";\nconst revisions = (await readdir(new URL("./pi-revisions/", import.meta.url))).sort();\nconst revision = revisions.at(-1);\nconst state = JSON.parse(await readFile(new URL("./pi.json", import.meta.url), "utf8"));\nif (!revision || !/^\\d{20}-[a-f0-9]{64}$/.test(revision) || (revision !== state.current && revision !== state.pending) || await readFile(new URL("./pi-revisions/" + revision, import.meta.url), "utf8") !== "") throw new Error("Invalid or missing GitRelay pi revision");\nif (state.pending && state.pending !== revision) throw new Error("GitRelay pi upgrade is incomplete; rerun installation");\nexport default (await import(new URL("./pi-versions/" + revision.slice(21) + "/src/adapters/pi/index.ts", import.meta.url).href)).default;\n`;

async function textFile(path: string): Promise<string | undefined> {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw new Error(`Not a small regular file: ${path}`);
    return await readFile(path, "utf8");
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}

async function linkTarget(path: string): Promise<string | undefined> {
  try {
    if (!(await lstat(path)).isSymbolicLink()) throw new Error(`Pi skill entry was modified; preserved: ${path}`);
    return await readlink(path);
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}

async function createFile(path: string, content: string): Promise<void> {
  const dir = await mkdtemp(join(dirname(path), ".git-relay-stage-"));
  try { const staged = join(dir, "entry"); await writeFile(staged, content, { flag: "wx", mode: 0o600 }); await link(staged, path); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

async function witness(directory: string, content: string, skill: boolean): Promise<string> {
  const path = join(await mkdtemp(join(directory, ".git-relay-owned-")), "entry");
  if (skill) await symlink(content, path, "dir");
  else await writeFile(path, content, { flag: "wx", mode: 0o600 });
  return path;
}

async function sameInode(path: string, anchor: string): Promise<boolean> {
  try {
    const [left, right] = await Promise.all([lstat(path, { bigint: true }), lstat(anchor, { bigint: true })]);
    return left.dev === right.dev && left.ino === right.ino;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

async function publishWitness(anchor: string, path: string, skill: boolean, env: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<void> {
  if (skill) await commandOutput("ln", ["-P", anchor, path], env, 5000, 64 * 1024, signal);
  else await link(anchor, path);
}

export function validateRecord(value: unknown, agentDir: string): asserts value is Record {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid pi installation record.");
  const record = value as Record;
  const rev = (value: unknown) => typeof value === "string" && revisionPattern.test(value);
  const managed = (value: unknown, directory: string, kind: string) => value === undefined || (typeof value === "string" && isAbsolute(value) && dirname(dirname(value)) === directory && new RegExp(`^\\.git-relay-${kind}-[a-zA-Z0-9]+$`).test(basename(dirname(value))) && basename(value) === "entry");
  const extensions = join(agentDir, "extensions"), skills = join(agentDir, "skills");
  if (record.agentDir !== agentDir || !(record.current === null || rev(record.current)) || !(record.pending === undefined || rev(record.pending)) || typeof record.removing !== "undefined" && typeof record.removing !== "boolean" || typeof record.removed !== "undefined" && typeof record.removed !== "boolean" || !managed(record.skillArchive, skills, "archive") || !managed(record.entryArchive, extensions, "archive") || !managed(record.entryWitness, extensions, "owned") || !managed(record.skillWitness, skills, "owned") || !managed(record.nextSkillWitness, skills, "owned") || !record.entryWitness || (record.current !== null && !record.skillWitness) || (record.pending !== undefined && !record.nextSkillWitness)) throw new Error("Invalid pi installation record or changed pi configuration directory.");
}

async function existingPackage(agentDir: string, env: NodeJS.ProcessEnv): Promise<void> {
  const settings = await readJson(join(agentDir, "settings.json"));
  if (settings === undefined) return;
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) throw new Error("Invalid pi settings; preserved.");
  const packages = (settings as { packages?: unknown }).packages;
  for (const field of ["extensions", "skills"] as const) {
    const paths = (settings as { extensions?: unknown; skills?: unknown })[field];
    if (paths !== undefined && !Array.isArray(paths)) throw new Error(`Invalid pi ${field} configuration; preserved.`);
    if (Array.isArray(paths) && paths.some((path) => typeof path === "string" && /(?:git-relay|worktree-relay|pi-git-worktree|worktree-coordination)/i.test(path))) throw new Error(`Existing pi ${field} entry may already contain GitRelay; preserved.`);
  }
  if (packages === undefined) return;
  if (!Array.isArray(packages)) throw new Error("Invalid pi packages configuration; preserved.");
  for (const item of packages) {
    const source = typeof item === "string" ? item : item && typeof item === "object" ? (item as { source?: unknown }).source : undefined;
    if (typeof source !== "string") continue;
    const normalized = source.trim();
    if (/^(?:npm:|git:|github:|https?:|ssh:)/.test(normalized)) {
      if (/(?:git-relay|worktree-relay|pi-git-worktree)/i.test(normalized)) throw new Error(`Existing pi package may already contain GitRelay; preserved: ${source}`);
      continue;
    }
    // Pi resolves local package sources as written; Unicode whitespace can be
    // part of a real directory name and must not be removed here.
    let path = source;
    if (path === "~") path = env.HOME || homedir();
    else if (path.startsWith("~/") || (process.platform === "win32" && path.startsWith("~\\"))) path = join(env.HOME || homedir(), path.slice(2));
    else if (path.startsWith("file://")) path = fileURLToPath(path);
    const pkg = await readJson(join(resolve(agentDir, path), "package.json")).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOTDIR") return undefined; throw error; });
    if (pkg && typeof pkg === "object" && /^(git-relay|worktree-relay|pi-git-worktree)$/.test(String((pkg as { name?: unknown }).name))) throw new Error(`Existing pi package may already contain GitRelay; preserved: ${source}`);
  }
}

async function preserveArchive(path: string, archive: string, expected: string, skill: boolean, anchor: string, env: NodeJS.ProcessEnv): Promise<void> {
  const archived = skill ? await linkTarget(archive) : await textFile(archive);
  const actual = skill ? await linkTarget(path) : await textFile(path);
  if (archived !== undefined && actual !== undefined) throw new Error(`Pi entry changed during removal; preserved at ${archive} and ${path}`);
  if (archived === undefined && actual !== undefined) await rename(path, archive);
  let moved: string | undefined;
  try { moved = skill ? await linkTarget(archive) : await textFile(archive); }
  catch {
    try { await publishWitness(archive, path, skill, env); } catch { /* Preserve the archive if another entry occupies the path. */ }
    throw new Error(`Pi entry changed during removal; preserved at ${archive}`);
  }
  if (moved !== undefined && (moved !== expected || !(await sameInode(archive, anchor)))) {
    try { await publishWitness(archive, path, skill, env); } catch { /* Preserve the archive if another entry occupies the path. */ }
    throw new Error(`Pi entry changed during removal; preserved at ${archive}`);
  }
}

export async function installPi({ workspace, sourceRoot, env = process.env, signal }: Options): Promise<void> {
  if (process.platform === "win32") throw new Error("Pi automatic installation is not supported on Windows; see the manual installation guide.");
  signal?.throwIfAborted();
  await owner(workspace);
  const step = async (): Promise<boolean> => {
    let upgradeAfterRecovery = false;
    const agentDir = await agentDirectory(env), extensions = join(agentDir, "extensions"), skills = join(agentDir, "skills");
    const entry = join(extensions, "git-relay.ts"), skill = join(skills, "worktree-coordination"), statePath = join(workspace, "pi.json");
    const loaderPath = join(workspace, "pi-loader.ts"), revisions = join(workspace, "pi-revisions");
    const entryContent = `export { default } from ${JSON.stringify(pathToFileURL(loaderPath).href)};\n`;
    const raw = await readInstallationRecord(statePath, "pi");
    if (raw !== undefined) validateRecord(raw, agentDir);
    let record: Record = raw ?? { agentDir, current: null };
    if (record.removing) throw new Error("Pi uninstall is incomplete; rerun uninstall first.");
    await existingPackage(agentDir, env);
    await mkdir(extensions, { recursive: true }); await mkdir(skills, { recursive: true }); await mkdir(revisions, { recursive: true });
    const names = (await readdir(revisions)).sort();
    if (names.some((name) => !revisionPattern.test(name))) throw new Error(`Unexpected pi revision; preserved: ${revisions}`);
    for (const name of names) if (await textFile(join(revisions, name)) !== "") throw new Error(`Pi revision was modified: ${name}`);
    const latest = names.at(-1);
    if ((!raw && latest) || (latest !== record.current && latest !== record.pending && !(latest === undefined && record.current === null))) throw new Error(`Pi revisions changed outside GitRelay: ${revisions}`);
    const actualEntry = await textFile(entry), actualLoader = await textFile(loaderPath), actualSkill = await linkTarget(skill);
    if (actualEntry !== undefined && (!raw || record.removed || actualEntry !== entryContent)) throw new Error(`Pi extension entry already exists or was modified; preserved: ${entry}`);
    if (actualEntry !== undefined && (!record.entryWitness || !(await sameInode(entry, record.entryWitness)))) throw new Error(`Pi extension entry is not owned; preserved: ${entry}`);
    if (actualLoader !== undefined && (!raw || actualLoader !== loader)) throw new Error(`Pi loader was modified; preserved: ${loaderPath}`);
    const oldTarget = record.current ? join(workspace, "pi-versions", record.current.slice(21), "skills", "worktree-coordination") : undefined;
    if (actualSkill !== undefined && (!raw || record.removed || (actualSkill !== oldTarget && (!record.pending || actualSkill !== join(workspace, "pi-versions", record.pending.slice(21), "skills", "worktree-coordination"))))) throw new Error(`Pi skill entry already exists or was modified; preserved: ${skill}`);
    if (actualSkill !== undefined && !((record.skillWitness && await sameInode(skill, record.skillWitness)) || (record.nextSkillWitness && await sameInode(skill, record.nextSkillWitness)))) throw new Error(`Pi skill entry is not owned; preserved: ${skill}`);
    let target: string;
    if (record.pending) {
      const pendingId = record.pending.slice(21);
      const pendingTarget = join(workspace, "pi-versions", pendingId);
      try {
        if (!(await lstat(pendingTarget)).isDirectory() || await digest(pendingTarget, signal) !== pendingId) throw new Error("Invalid pending snapshot");
      } catch (error) {
        signal?.throwIfAborted();
        throw new Error(`Interrupted pi installation snapshot is missing or modified; preserved: ${pendingTarget}`, { cause: error });
      }
      target = pendingTarget;
      upgradeAfterRecovery = true;
    } else target = await prepare(workspace, sourceRoot, signal);
    const id = basename(target);
    await validateRuntime(workspace, target, env, signal);
    signal?.throwIfAborted();
    const desired = latest?.endsWith(`-${id}`) ? latest : `${String(BigInt(latest?.slice(0, 20) ?? "0") + 1n).padStart(20, "0")}-${id}`;
    if (!revisionPattern.test(desired)) throw new Error("Pi revision counter exhausted.");
    if (record.pending && record.pending !== desired) throw new Error("Interrupted pi installation has a different pending version; preserve it for inspection.");
    const targetSkill = join(target, "skills", "worktree-coordination");
    if (!record.pending) {
      let skillArchive: string | undefined;
      if (actualSkill !== undefined && actualSkill !== targetSkill) skillArchive = join(await mkdtemp(join(skills, ".git-relay-archive-")), "entry");
      const entryWitness = record.removed || !record.entryWitness ? await witness(extensions, entryContent, false) : record.entryWitness;
      const nextSkillWitness = record.removed || !record.skillWitness || oldTarget !== targetSkill ? await witness(skills, targetSkill, true) : record.skillWitness;
      record = { agentDir, current: record.current, pending: desired, entryWitness, skillWitness: record.skillWitness, nextSkillWitness, skillArchive };
      await writeJson(statePath, record);
    }
    if (!record.entryWitness || !record.nextSkillWitness || await textFile(record.entryWitness) !== entryContent || await linkTarget(record.nextSkillWitness) !== targetSkill) throw new Error("Pi ownership witness was modified; preserved.");
    if (record.skillArchive && oldTarget && record.skillWitness) {
      if (await linkTarget(skill) !== targetSkill) await preserveArchive(skill, record.skillArchive, oldTarget, true, record.skillWitness, env);
      else if (await linkTarget(record.skillArchive) !== oldTarget || !(await sameInode(record.skillArchive, record.skillWitness))) throw new Error(`Pi skill archive changed; preserved: ${record.skillArchive}`);
    }
    const currentSkill = await linkTarget(skill);
    if (currentSkill === undefined) await publishWitness(record.nextSkillWitness, skill, true, env, signal);
    else if (currentSkill !== targetSkill || !(await sameInode(skill, record.nextSkillWitness))) throw new Error(`Pi skill changed during installation; preserved: ${skill}`);
    if (await textFile(loaderPath) === undefined) await createFile(loaderPath, loader);
    if (await textFile(entry) === undefined) await publishWitness(record.entryWitness, entry, false, env);
    else if (!(await sameInode(entry, record.entryWitness))) throw new Error(`Pi extension changed during installation; preserved: ${entry}`);
    if (latest !== desired) await writeFile(join(revisions, desired), "", { flag: "wx", mode: 0o600 });
    await writeJson(statePath, { agentDir, current: desired, entryWitness: record.entryWitness, skillWitness: record.nextSkillWitness });
    return upgradeAfterRecovery;
  };
  await withLock(join(workspace, "pi-install.lock"), async () => {
    do { signal?.throwIfAborted(); } while (await step());
  }, { waitMs: 100, signal });
  signal?.throwIfAborted();
}

export async function uninstallPi({ workspace, env = process.env, signal }: Omit<Options, "sourceRoot">): Promise<void> {
  if (process.platform === "win32") throw new Error("Pi automatic uninstallation is not supported on Windows; see the manual installation guide.");
  signal?.throwIfAborted();
  await owner(workspace);
  await withLock(join(workspace, "pi-install.lock"), async () => {
    const agentDir = await agentDirectory(env), extensions = join(agentDir, "extensions"), skills = join(agentDir, "skills");
    const entry = join(extensions, "git-relay.ts"), skill = join(skills, "worktree-coordination"), statePath = join(workspace, "pi.json");
    const raw = await readInstallationRecord(statePath, "pi");
    if (raw === undefined) return;
    validateRecord(raw, agentDir);
    let record = raw;
    if (record.removed) return;
    if (record.pending) throw new Error("Pi installation is incomplete; rerun install first.");
    const entryContent = `export { default } from ${JSON.stringify(pathToFileURL(join(workspace, "pi-loader.ts")).href)};\n`;
    const skillTarget = record.current ? join(workspace, "pi-versions", record.current.slice(21), "skills", "worktree-coordination") : undefined;
    if (!record.removing) {
      const actualEntry = await textFile(entry), actualSkill = await linkTarget(skill);
      if (actualEntry !== undefined && actualEntry !== entryContent) throw new Error(`Pi extension was modified; preserved: ${entry}`);
      if (actualSkill !== undefined && actualSkill !== skillTarget) throw new Error(`Pi skill was modified; preserved: ${skill}`);
      if (actualEntry !== undefined && (!record.entryWitness || !(await sameInode(entry, record.entryWitness)))) throw new Error(`Pi extension is not owned; preserved: ${entry}`);
      if (actualSkill !== undefined && (!record.skillWitness || !(await sameInode(skill, record.skillWitness)))) throw new Error(`Pi skill is not owned; preserved: ${skill}`);
      const entryArchive = actualEntry === undefined ? undefined : join(await mkdtemp(join(extensions, ".git-relay-archive-")), "entry");
      const skillArchive = actualSkill === undefined ? undefined : join(await mkdtemp(join(skills, ".git-relay-archive-")), "entry");
      record = { ...record, removing: true, entryArchive, skillArchive };
      await writeJson(statePath, record);
    }
    if (record.entryArchive && record.entryWitness) await preserveArchive(entry, record.entryArchive, entryContent, false, record.entryWitness, env);
    if (record.skillArchive && skillTarget && record.skillWitness) await preserveArchive(skill, record.skillArchive, skillTarget, true, record.skillWitness, env);
    await writeJson(statePath, { ...record, removing: false, removed: true });
  }, { waitMs: 100, signal });
  signal?.throwIfAborted();
}
