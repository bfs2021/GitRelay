import assert from "node:assert/strict";
import { cp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fixture } from "../helpers.ts";
import { runHook } from "../../src/adapters/hooks.ts";
import { eventsIn, sendMessage, readReceipt, sessionKey } from "../../src/core/mailbox.ts";
import { repository } from "../../src/core/store.ts";

const ref = "refs/heads/main";
async function snapshot(root: string, suffix: string) {
  const current = process.env.WORKTREE_SYNC_STATE_DIR!;
  const next = join(root, `state-${suffix}`);
  await cp(current, next, { recursive: true, filter: (source) => !source.endsWith(".lock") });
  process.env.WORKTREE_SYNC_STATE_DIR = next;
}

test("Claude SessionStart keeps an existing unread event for the next prompt", async (t) => {
  const f = await fixture(t), identity = { adapter: "claude-code", session: "receiver" };
  const input = { hook_event_name: "SessionStart", session_id: identity.session, cwd: f.b };
  const responses: object[] = [], output = async (value: object) => { responses.push(value); };
  await runHook("claude-code", input, ref, output);
  await snapshot(f.root, "send");
  const event = await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: "SYNTHETIC_DEFERRED_MARKER" });
  await snapshot(f.root, "resume"); responses.length = 0;
  await runHook("claude-code", input, ref, output);
  assert.deepEqual(responses, [{}]);
  await snapshot(f.root, "before");
  let repo = await repository(f.b), key = sessionKey(repo, identity, ref);
  assert.equal(await readReceipt(repo, key, event.id), undefined);
  await snapshot(f.root, "prompt"); responses.length = 0;
  await runHook("claude-code", { ...input, hook_event_name: "UserPromptSubmit" }, ref, output);
  assert.match(JSON.stringify(responses), /SYNTHETIC_DEFERRED_MARKER/);
  await snapshot(f.root, "after"); repo = await repository(f.b);
  assert.equal((await readReceipt(repo, key, event.id))?.status, "delivered");
});

test("Codex SessionStart still delivers its existing unread event", async (t) => {
  const f = await fixture(t), input = { hook_event_name: "SessionStart", session_id: "codex", cwd: f.b };
  const responses: object[] = [], output = async (value: object) => { responses.push(value); };
  await runHook("codex", input, ref, output);
  await snapshot(f.root, "send");
  await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: "SYNTHETIC_CODEX_MARKER" });
  await snapshot(f.root, "resume"); responses.length = 0;
  await runHook("codex", input, ref, output);
  assert.match(JSON.stringify(responses), /SYNTHETIC_CODEX_MARKER/);
});

test("Claude SessionStart may acknowledge an irrelevant event while retaining relevant messages", async (t) => {
  const f = await fixture(t), identity = { adapter: "claude-code", session: "receiver" };
  const input = { hook_event_name: "SessionStart", session_id: identity.session, cwd: f.b };
  const responses: object[] = [], output = async (value: object) => { responses.push(value); };
  await runHook("claude-code", input, ref, output);
  await snapshot(f.root, "irrelevant-send");
  const irrelevant = await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: "irrelevant", files: ["not-present.ts"] });
  await snapshot(f.root, "relevant-send");
  const relevant = await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: "SYNTHETIC_RELEVANT" });
  await snapshot(f.root, "mixed-resume"); responses.length = 0;
  await runHook("claude-code", input, ref, output);
  assert.deepEqual(responses, [{}]);
  await snapshot(f.root, "mixed-before"); const repo = await repository(f.b), key = sessionKey(repo, identity, ref);
  assert.equal((await readReceipt(repo, key, irrelevant.id))?.status, "irrelevant");
  assert.equal(await readReceipt(repo, key, relevant.id), undefined);
  await snapshot(f.root, "mixed-prompt"); responses.length = 0;
  await runHook("claude-code", { ...input, hook_event_name: "UserPromptSubmit" }, ref, output);
  assert.match(JSON.stringify(responses), /SYNTHETIC_RELEVANT/);
});

for (const cancellation of ["output-error", "abort"] as const) {
  test(`Claude SessionStart ${cancellation} leaves relevant notifications unread`, async (t) => {
    const f = await fixture(t), identity = { adapter: "claude-code", session: "receiver" };
    const input = { hook_event_name: "SessionStart", session_id: identity.session, cwd: f.b };
    await runHook("claude-code", input, ref, async () => {});
    await snapshot(f.root, "error-send");
    const event = await sendMessage({ cwd: f.a, adapter: "test", session: "sender", text: "SYNTHETIC_AFTER_FAILURE" });
    await snapshot(f.root, "error-resume");
    if (cancellation === "output-error") {
      await assert.rejects(runHook("claude-code", input, ref, async () => { throw new Error("injected output failure"); }), /injected output failure/);
    } else {
      const abort = new AbortController();
      await runHook("claude-code", input, ref, async () => { abort.abort(); }, abort.signal);
      assert.equal(abort.signal.aborted, true);
    }
    await snapshot(f.root, "error-before"); const repo = await repository(f.b), key = sessionKey(repo, identity, ref);
    assert.equal(await readReceipt(repo, key, event.id), undefined);
    await snapshot(f.root, "error-prompt"); const responses: object[] = [];
    await runHook("claude-code", { ...input, hook_event_name: "UserPromptSubmit" }, ref, async (value) => { responses.push(value); });
    assert.match(JSON.stringify(responses), /SYNTHETIC_AFTER_FAILURE/);
  });
}

test("Claude SessionStart retains relevant legacy catch-up for the next prompt", async (t) => {
  const f = await fixture(t), identity = { adapter: "claude-code", session: "receiver" };
  const input = { hook_event_name: "SessionStart", session_id: identity.session, cwd: f.b };
  const firstRepo = await repository(f.b), key = sessionKey(firstRepo, identity, ref);
  const legacy = join(firstRepo.common, "worktree-agent-sync");
  await mkdir(legacy); await writeFile(join(legacy, `${key}.json`), JSON.stringify({ root: f.b, ref, commit: f.initial }));
  await writeFile(join(f.b, "shared.txt"), "local change\n");
  await f.commit(f.main, "shared.txt", "upstream changed\n");
  await snapshot(f.root, "legacy-sessionstart"); const responses: object[] = [];
  await runHook("claude-code", input, ref, async (value) => { responses.push(value); });
  assert.deepEqual(responses, [{}]);
  await snapshot(f.root, "legacy-inspect"); const repo = await repository(f.b);
  const events = await eventsIn(repo, key), migration = events.find((event) => event.kind === "upstream");
  assert.ok(migration);
  assert.equal(await readReceipt(repo, key, migration.id), undefined);
  await snapshot(f.root, "legacy-prompt"); responses.length = 0;
  await runHook("claude-code", { ...input, hook_event_name: "UserPromptSubmit" }, ref, async (value) => { responses.push(value); });
  assert.match(JSON.stringify(responses), /shared\.txt/);
  await snapshot(f.root, "legacy-after"); const after = await repository(f.b);
  assert.equal((await readReceipt(after, key, migration.id))?.status, "delivered");
});
