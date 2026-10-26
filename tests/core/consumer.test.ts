import assert from "node:assert/strict";
import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { consumeChanges } from "../../src/core/consumer.ts";
import { repository } from "../../src/core/store.ts";
import { fixture } from "../helpers.ts";

test("persistent per-session checkpoints deduplicate, resume and retry failed delivery", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.b, "shared.txt"), "B local\n");
  let delivered = 0;
  let fail = false;
  const options = {
    cwd: f.b, ref: "refs/heads/main", adapter: "test", session: "one",
    async deliver() { if (fail) throw new Error("offline"); delivered++; },
  };
  await consumeChanges(options);
  assert.equal(delivered, 0);
  await f.commit(f.main, "shared.txt", "upstream 1\n");
  fail = true;
  await assert.rejects(consumeChanges(options), /offline/);
  fail = false;
  await consumeChanges(options);
  await consumeChanges({ ...options });
  assert.equal(delivered, 1);
  await consumeChanges({ ...options, session: "two" }); // New conversations start at the current main.
  await f.commit(f.main, "shared.txt", "upstream 2\n");
  await consumeChanges(options);
  await consumeChanges({ ...options, session: "two" });
  assert.equal(delivered, 3);
  await assert.rejects(consumeChanges({ ...options, session: "" }), /session ID/);
});

test("abandoned locks are reported without deleting another process's state", async (t) => {
  const f = await fixture(t);
  const options = { cwd: f.b, ref: "refs/heads/main", adapter: "test", session: "stale", async deliver() {} };
  await consumeChanges(options);
  const directory = join((await repository(f.b)).directory, "sessions");
  const cursor = (await readdir(directory)).find((name) => name.endsWith(".json"))!;
  await writeFile(join(directory, cursor.replace(/\.json$/, ".lock")), JSON.stringify({ pid: 2_000_000_000 }));
  await assert.rejects(consumeChanges(options), /Stale git-relay lock/);
  assert.ok((await readdir(directory)).includes(cursor));
});

test("concurrent checks on one session do not double-deliver", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.b, "shared.txt"), "B local\n");
  let delivered = 0;
  const options = {
    cwd: f.b, ref: "refs/heads/main", adapter: "test", session: "concurrent",
    async deliver() { delivered++; await new Promise((resolve) => setTimeout(resolve, 30)); },
  };
  await consumeChanges(options);
  await f.commit(f.main, "shared.txt", "new\n");
  await Promise.all([consumeChanges(options), consumeChanges(options)]);
  assert.equal(delivered, 1);
});
