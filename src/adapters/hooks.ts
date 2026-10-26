import { consumeMailbox } from "../core/consumer.ts";
import { formatNotifications } from "../core/mailbox.ts";

export type HookAgent = "claude-code" | "codex" | "cursor";
export type HookInput = Record<string, unknown>;

/** Pure protocol conversion; the hook runner handles Git and persistence. */
export function hookResponse(agent: HookAgent, event: string, message: string): object {
  if (agent === "cursor") {
    return event === "stop" ? { followup_message: message } : { additional_context: message };
  }
  return event === "Stop"
    ? { decision: "block", reason: message }
    : { hookSpecificOutput: { hookEventName: event, additionalContext: message } };
}

export async function runHook(agent: HookAgent, input: HookInput, ref: string, output: (value: object) => Promise<void>): Promise<void> {
  const event = input.hook_event_name;
  const events = agent === "cursor" ? ["postToolUse", "stop"] : ["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop"];
  if (typeof event !== "string" || !events.includes(event)) { await output({}); return; }
  if (input.stop_hook_active === true || (agent === "cursor" && event === "stop" && (input.status !== "completed" || Number(input.loop_count ?? 0) >= 1))) {
    await output({});
    return;
  }
  const sessionId = agent === "cursor" ? input.conversation_id : input.session_id;
  if (typeof sessionId !== "string" || !sessionId) throw new Error("Hook input is missing a session/conversation ID.");
  const session = typeof input.agent_id === "string" && input.agent_id ? `${sessionId}/${input.agent_id}` : sessionId;
  let cwd = input.cwd;
  if (typeof cwd !== "string") {
    const roots = input.workspace_roots;
    if (!Array.isArray(roots) || roots.length !== 1 || typeof roots[0] !== "string") throw new Error("Hook input must identify one worktree (cwd or a single workspace root).");
    cwd = roots[0];
  }
  let sent = false;
  await consumeMailbox({
    cwd: cwd as string, ref, adapter: agent, session,
    async deliver(notifications) {
      await output(hookResponse(agent, event, formatNotifications(notifications)));
      sent = true;
    },
  });
  if (!sent) await output({});
}
