import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { consumeMailbox } from "../../src/core/consumer.ts";
import { eventsIn, readReceipt, sessionKey } from "../../src/core/mailbox.ts";
import { repository } from "../../src/core/store.ts";
import { fixture, git } from "../helpers.ts";

const exec = promisify(execFile),
  cli = fileURLToPath(new URL("../../src/cli/main.ts", import.meta.url));

test("CLI requires explicit consent to acknowledge an unavailable history notification", async (t) => {
  const f = await fixture(t),
    ref = "refs/heads/main";
  const receiver = {
    cwd: f.b,
    ref,
    adapter: "test",
    session: "gap",
    async deliver() {
      return false;
    },
  };
  await writeFile(join(f.b, "shared.txt"), "local\n");
  await consumeMailbox(receiver);
  await f.commit(f.main, "shared.txt", "lost\n");
  await consumeMailbox(receiver);
  git(f.main, "reset", "--hard", f.initial);
  git(f.main, "reflog", "expire", "--expire=now", "--all");
  git(f.main, "gc", "--prune=now");
  const args = [
    "--experimental-strip-types",
    cli,
    "check",
    "--cwd",
    f.b,
    "--agent",
    receiver.adapter,
    "--session",
    receiver.session,
  ];
  await assert.rejects(exec(process.execPath, [...args, "--acknowledge-history-gap"]), /requires check --apply/);
  await assert.rejects(exec(process.execPath, args), /could not compare/);
  const repo = await repository(f.b),
    key = sessionKey(repo, receiver, ref);
  const events = (await eventsIn(repo)).filter((event) => event.recipients.includes(key));
  for (const event of events) assert.equal(await readReceipt(repo, key, event.id), undefined);
  const { stdout } = await exec(process.execPath, [...args, "--acknowledge-history-gap", "--apply"]);
  assert.ok(
    stdout
      .split("\n")
      .filter(Boolean)
      .every((line) => JSON.parse(line).unavailable === true),
  );
  for (const event of events) assert.equal((await readReceipt(repo, key, event.id))?.status, "delivered");
  assert.equal(git(f.b, "status", "--porcelain").trim(), "M shared.txt");
});
