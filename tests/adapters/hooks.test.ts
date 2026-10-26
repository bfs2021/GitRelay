import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { hookResponse, runHook, type HookAgent } from "../../src/adapters/hooks.ts";
import { fixture } from "../helpers.ts";
import { consumeMailbox } from "../../src/core/consumer.ts";
import { collectGarbage } from "../../src/core/cleanup.ts";
import { listSessions, sendMessage } from "../../src/core/mailbox.ts";

test("protocols return model context or continuation rather than a human notification", () => {
  for (const agent of ["claude-code", "codex"] as const) {
    assert.deepEqual(hookResponse(agent, "PostToolUse", "diff"), { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "diff" } });
    assert.deepEqual(hookResponse(agent, "Stop", "diff"), { decision: "block", reason: "diff" });
  }
  assert.deepEqual(hookResponse("cursor", "postToolUse", "diff"), { additional_context: "diff" });
  assert.deepEqual(hookResponse("cursor", "stop", "diff"), { followup_message: "diff" });
});

test("multiple shared messages produce one valid hook response", async (t) => {
  const f = await fixture(t);
  const input = { hook_event_name: "SessionStart", session_id: "B", cwd: f.b };
  const responses: object[] = [];
  const output = async (value: object) => { responses.push(value); };
  await runHook("codex", input, "refs/heads/main", output);
  responses.length = 0;
  await sendMessage({ cwd: f.a, adapter: "opencode", session: "A", text: "first shared note" });
  await sendMessage({ cwd: f.a, adapter: "claude-code", session: "C", text: "second shared note" });
  await runHook("codex", { ...input, hook_event_name: "PostToolUse" }, "refs/heads/main", output);
  assert.equal(responses.length, 1);
  assert.match(JSON.stringify(responses[0]), /first shared note/);
  assert.match(JSON.stringify(responses[0]), /second shared note/);
});

test("subagent tool hooks neither subscribe nor consume the parent's inbox or pin GC", async (t) => {
  const f = await fixture(t);
  const parent = { hook_event_name: "SessionStart", session_id: "S", cwd: f.b };
  const responses: object[] = [];
  const output = async (value: object) => { responses.push(value); };
  await runHook("claude-code", parent, "refs/heads/main", output);
  const consumer = { cwd: f.c, ref: "refs/heads/main", adapter: "codex", session: "C", async deliver() {} };
  await consumeMailbox(consumer);
  const event = await sendMessage({ cwd: f.a, adapter: "cli", session: "send-only", text: "for parent" });
  await runHook("claude-code", { ...parent, hook_event_name: "PostToolUse", agent_id: "sub1" }, "refs/heads/main", output);
  assert.deepEqual(responses.at(-1), {});
  assert.deepEqual((await listSessions(f.b)).map((session) => session.session).sort(), ["C", "S"]);
  await runHook("claude-code", { ...parent, hook_event_name: "PostToolUse" }, "refs/heads/main", output);
  assert.match(JSON.stringify(responses.at(-1)), /for parent/);
  await consumeMailbox(consumer);
  assert.deepEqual((await collectGarbage(f.b, { apply: true, retentionDays: 0 })).removed, [event.id]);
});

test("global hooks in a non-Git directory quietly return an empty protocol response", async (t) => {
  const f = await fixture(t);
  for (const agent of ["claude-code", "codex", "cursor"] as const) {
    const responses: object[] = [];
    await runHook(agent, { hook_event_name: agent === "cursor" ? "postToolUse" : "SessionStart", session_id: "S", conversation_id: "S", cwd: f.root }, "refs/heads/main", async (value) => { responses.push(value); });
    assert.deepEqual(responses, [{}]);
  }
  assert.deepEqual(await listSessions(f.b), []);
});

for (const agent of ["claude-code", "codex", "cursor"] as HookAgent[]) {
  test(`${agent} hook establishes baseline, resumes once on update and prevents stop loops`, async (t) => {
    const f = await fixture(t);
    await writeFile(join(f.b, "shared.txt"), "local\n");
    const responses: object[] = [];
    const input = agent === "cursor"
      ? { hook_event_name: "postToolUse", conversation_id: "chat", cwd: f.b }
      : { hook_event_name: "SessionStart", session_id: "chat", cwd: f.b };
    const output = async (value: object) => { responses.push(value); };
    await runHook(agent, input, "refs/heads/main", output);
    assert.deepEqual(responses.pop(), {});
    await f.commit(f.main, "shared.txt", "upstream\n");
    const stop = { ...input, hook_event_name: agent === "cursor" ? "stop" : "Stop", status: "completed" };
    await runHook(agent, stop, "refs/heads/main", output);
    const response = responses.pop() as Record<string, string>;
    assert.match(response.reason ?? response.followup_message, /shared.txt/);
    await runHook(agent, stop, "refs/heads/main", output);
    assert.deepEqual(responses.pop(), {});
    await f.commit(f.main, "shared.txt", "another\n");
    await runHook(agent, { ...stop, stop_hook_active: true }, "refs/heads/main", output);
    assert.deepEqual(responses.pop(), {});
    await runHook(agent, { ...input, hook_event_name: agent === "cursor" ? "postToolUse" : "PostToolUse" }, "refs/heads/main", output);
    assert.ok(JSON.stringify(responses.pop()).includes("another"));
    await sendMessage({ cwd: f.a, adapter: "opencode", session: "OC-A", text: "来自 OpenCode 的共享消息" });
    await runHook(agent, { ...input, hook_event_name: agent === "cursor" ? "postToolUse" : "PostToolUse" }, "refs/heads/main", output);
    assert.ok(JSON.stringify(responses.pop()).includes("来自 OpenCode"));
  });
}
