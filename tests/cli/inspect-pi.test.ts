import assert from "node:assert/strict";
import fs from "node:fs";
import { execFile } from "node:child_process";
import { lstat, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { inspectPi } from "../../src/cli/inspect-pi.ts";
import { consumeMailbox } from "../../src/core/consumer.ts";
import { sendMessage, sessionKey } from "../../src/core/mailbox.ts";
import { hash, repository, stateDirectory, writeJson } from "../../src/core/store.ts";
import { fixture } from "../helpers.ts";

const ref = "refs/heads/main", exec = promisify(execFile);
const cli = fileURLToPath(new URL("../../dist/cli/main.js", import.meta.url));

test("pi inspection does not initialize a repository or state", async (t) => {
  const f = await fixture(t);
  await assert.rejects(inspectPi(f.b, ref, "no-session", "a".repeat(64)), /No existing GitRelay repository identity/);
  await assert.rejects(lstat(join(f.main, ".git", ".git-relay-id")), { code: "ENOENT" });
  await assert.rejects(lstat(stateDirectory()), { code: "ENOENT" });
});

test("pi inspection reports observed digest groups without message contents or mutation", async (t) => {
  const f = await fixture(t), receiver = { cwd: f.b, ref, adapter: "pi", session: "inspect", async deliver() {} };
  await consumeMailbox(receiver);
  const repo = await repository(f.b), key = sessionKey(repo, receiver, ref);
  const sender = { cwd: f.a, adapter: "test", session: "sender" };
  const first = await sendMessage({ ...sender, text: "INSPECT_SECRET_FIRST" });
  const second = await sendMessage({ ...sender, text: "INSPECT_SECRET_SECOND" });
  const third = await sendMessage({ ...sender, text: "INSPECT_SECRET_OTHER" });
  const dir = join(repo.directory, "receipts", key), digest = hash("shared-message"), other = hash("other-message");
  await mkdir(dir, { recursive: true });
  for (const [id, value] of [[first.id, digest], [second.id, digest], [third.id, other]]) await writeJson(join(dir, `${id}.${value}.pi-proof`), { eventId: id, digest: value });
  const firstPath = join(repo.directory, "events", `${first.id}.json`), before = await readFile(firstPath);
  const report = await inspectPi(f.b, ref, receiver.session, first.id) as any;
  assert.deepEqual(report.proofs.map((proof: any) => proof.eventId).sort(), [first.id, second.id].sort());
  assert.deepEqual(report.events.map((event: any) => event.eventId).sort(), [first.id, second.id].sort());
  assert.equal(report.events.every((event: any) => event.receiptStatus === null), true);
  assert.match(report.fingerprint, /^[a-f0-9]{64}$/);
  assert.match(report.note, /do not establish a complete batch/);
  assert.doesNotMatch(JSON.stringify(report), /INSPECT_SECRET/);
  assert.deepEqual(await readFile(firstPath), before);
  const result = JSON.parse((await exec(process.execPath, [cli, "pi-inspect", "--cwd", f.b, "--session", receiver.session, "--event", first.id])).stdout);
  assert.deepEqual(result, JSON.parse(JSON.stringify(report)));
  await assert.rejects(exec(process.execPath, [cli, "pi-inspect", "--cwd", f.b, "--session", receiver.session, "--event", first.id, "--apply"]), /read-only/);
});

test("pi inspection rejects proof symlinks and changing evidence", { skip: process.platform === "win32" }, async (t) => {
  const f = await fixture(t), receiver = { cwd: f.b, ref, adapter: "pi", session: "inspect", async deliver() {} };
  await consumeMailbox(receiver);
  const repo = await repository(f.b), key = sessionKey(repo, receiver, ref);
  const event = await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: "preserve" });
  const dir = join(repo.directory, "receipts", key), digest = hash("message"), proof = join(dir, `${event.id}.${digest}.pi-proof`);
  await mkdir(dir, { recursive: true });
  const target = join(f.root, "target.json");
  await writeFile(target, JSON.stringify({ eventId: event.id, digest }));
  await symlink(target, proof);
  await assert.rejects(inspectPi(f.b, ref, receiver.session, event.id));
  assert.equal((await lstat(proof)).isSymbolicLink(), true);
  await rm(proof);
  await writeJson(proof, { eventId: event.id, digest });
  const eventPath = join(repo.directory, "events", `${event.id}.json`), original = await readFile(eventPath, "utf8");
  const open = fs.promises.open;
  let changed = false;
  fs.promises.open = (async (path: any, ...args: any[]) => {
    const handle = await (open as any)(path, ...args);
    if (!changed && String(path) === eventPath) {
      const read = handle.read.bind(handle);
      handle.read = async (...readArgs: any[]) => {
        const result = await read(...readArgs);
        if (!changed) { changed = true; await writeFile(eventPath, `${original} `); }
        return result;
      };
    }
    return handle;
  }) as typeof fs.promises.open;
  syncBuiltinESMExports();
  try { await assert.rejects(inspectPi(f.b, ref, receiver.session, event.id), /changed/); }
  finally { fs.promises.open = open; syncBuiltinESMExports(); }
});

test("pi inspection errors do not reveal corrupted message contents", async (t) => {
  const f = await fixture(t), receiver = { cwd: f.b, ref, adapter: "pi", session: "inspect", async deliver() {} };
  await consumeMailbox(receiver);
  const repo = await repository(f.b);
  const event = await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: "original" });
  const path = join(repo.directory, "events", `${event.id}.json`);
  await writeFile(path, "CORRUPTED_PRIVATE_MESSAGE");
  await assert.rejects(inspectPi(f.b, ref, receiver.session, event.id), (error: unknown) => error instanceof Error && /Invalid JSON/.test(error.message) && !error.message.includes("CORRUPTED_PRIVATE_MESSAGE"));
  assert.equal(await readFile(path, "utf8"), "CORRUPTED_PRIVATE_MESSAGE");
});

test("pi inspection never mixes receipt status with a different receipt hash", async (t) => {
  const f = await fixture(t), receiver = { cwd: f.b, ref, adapter: "pi", session: "inspect", async deliver() {} };
  await consumeMailbox(receiver);
  const repo = await repository(f.b), key = sessionKey(repo, receiver, ref);
  const event = await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: "preserve" });
  const path = join(repo.directory, "receipts", key, `${event.id}.json`), at = new Date().toISOString();
  const delivered = JSON.stringify({ eventId: event.id, status: "delivered", at });
  const irrelevant = JSON.stringify({ eventId: event.id, status: "irrelevant", at });
  await writeFile(path, delivered);
  const open = fs.promises.open;
  let calls = 0;
  fs.promises.open = (async (candidate: any, ...args: any[]) => {
    if (String(candidate) === path) await writeFile(path, ++calls % 2 ? delivered : irrelevant);
    return (open as any)(candidate, ...args);
  }) as typeof fs.promises.open;
  syncBuiltinESMExports();
  try { await assert.rejects(inspectPi(f.b, ref, receiver.session, event.id), /changed/); }
  finally { fs.promises.open = open; syncBuiltinESMExports(); }
  assert.equal(calls, 2);
});
