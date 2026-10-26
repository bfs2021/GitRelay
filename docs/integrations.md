# GitRelay: Agent integration and message delivery

The npm package is `git-relay`. The CLI aliases `worktree-relay` and `worktree-sync` use the same entrypoint. Existing state directories and environment variables remain unchanged. See [migration](migration.md) for renaming and plugin upgrades.

## Host capabilities

| Platform | Integration | Busy agent | Already idle agent |
| --- | --- | --- | --- |
| pi | Native extension | Queues a follow-up after the current run | Starts another run automatically |
| OpenCode v2 | Promise plugin with `id/setup` | Delivers through the durable host queue | Checks registered sessions every five seconds and starts a run |
| Claude Code | Synchronous lifecycle hooks | Injects after tools; Stop can request continuation | Waits for the next hook |
| Codex | Synchronous lifecycle hooks | Injects after tools; Stop can request continuation | Waits for the next hook |
| Cursor | Synchronous hooks | Injects after tools; completed stop can request follow-up | Waits for the next hook |
| Other clients | CLI JSON / NDJSON | Host routes events into the session | Host must implement wake-up |

Platforms cooperate through a shared user-level message store, without calling each other. For example, A merges into main using Claude Code, a receiver publishes the shared event, and B using pi and C using OpenCode each deliver it to their own agent. `git-relay send` publishes explicit coordination messages. See [shared storage](shared-messages.md) for identities, broadcasts, and receipts.

GitRelay does not simulate terminal keystrokes, edit transcripts, or start a separate agent to impersonate delivery into the original session.

## pi

```sh
pi install /absolute/path/to/GitRelay
```

Restart or run `/reload` to load the extension and skill. Load the extension in every participating worktree. TUI/RPC mode monitors `refs/heads/main` by default:

```sh
pi --worktree-main-ref refs/heads/develop
pi --worktree-watch=false
```

`/worktree leave` closes the subscription while preserving unread events; `/worktree join` resumes it. Normal exit/reload retains subscriptions for offline recovery. See [maintenance](maintenance.md) for CLI equivalents, safe GC, and the optional daemon.

Print/JSON mode does not start background polling. `/worktree` management remains available; root `index.ts` preserves the legacy extension loading path.

pi uses shared user-level storage and native session IDs for receipts. Queueing a follow-up does not acknowledge it; appearance in session history does. Repeated join and leave/join in the same session retain pending-batch deduplication. If Esc discards the queue, the next idle check retries without reloading. Old custom-entry/message cursors can be imported. Initial registration establishes a baseline without replaying earlier changes.

Global hooks return `{}` outside Git repositories. OpenCode does not register or poll non-Git locations; reload after initializing a repository.

## CLI and hook installation

```sh
npm install -g /absolute/path/to/GitRelay
git-relay --help
```

Node.js 22.19+ is required. The hook environment must find `git-relay` on PATH, or commands must use correctly quoted absolute Node/script paths. GUI applications may not inherit an interactive shell's PATH.

Merge example `hooks` entries into existing host settings rather than overwriting them, then review and enable hooks through the host's trust flow.

### Claude Code

Merge [`src/adapters/claude-code/hooks.json`](../src/adapters/claude-code/hooks.json) into `.claude/settings.json` or user settings.

- `SessionStart` establishes or restores the baseline.
- `UserPromptSubmit` / `PostToolUse` return model context in `hookSpecificOutput.additionalContext`.
- `Stop` with new events returns `decision: block` and event content to request continuation; `stop_hook_active` prevents another continuation request.

Subagent hooks with a nonempty `agent_id` return `{}` without registering or consuming the parent inbox. The parent receives events at its next supported hook.

Hook input is limited to 16 MiB of JSON bytes, allowing large tool payloads. Oversized input is drained and returns `{}` with a diagnostic, without acknowledging events; a later smaller hook retries. Input is not buffered without bounds, and relay failure does not fail the user's tool call.

### Codex

Use a Codex version supporting lifecycle hooks. User-level hooks were exercised with Codex CLI `0.164.0`; prefer merging [`src/adapters/codex/hooks.json`](../src/adapters/codex/hooks.json) into `$CODEX_HOME/hooks.json` (default `~/.codex/hooks.json`) when not installing the plugin. Review and trust individual hooks via `/hooks`; trusting the project alone is insufficient.

Project `.codex/hooks.json` discovery also requires the host to enable that configuration layer. Discovery failed in the temporary local-worktree acceptance run, so it is not claimed as verified. Check `/hooks`, then confirm registration with `git-relay sessions`. The isolated test used a separate `CODEX_HOME` and a one-time trust bypass for reviewed package hooks; ordinary installation uses the host trust flow.

A shared app-server daemon must inherit the required CLI PATH and state environment. Isolated tests can use `codex --no-daemon exec ...` without stopping an existing user daemon.

Codex uses the same event names and corresponding additional-context/Stop-continuation protocol as Claude Code. Old outbound-only `notify` support cannot inject into the original session. Upgrade, read CLI output at task checkpoints, or implement an App Server host consuming NDJSON and calling `turn/start` / `turn/steer`. GitRelay does not manage App Server connections.

### Codex App status and actions

The hook template enables `--branch-status`. SessionStart/UserPromptSubmit read a local snapshot, return it in `hookSpecificOutput.additionalContext`, and expose `systemMessage` for UI display. Mailbox deliveries also include a short `systemMessage`. Status alone never forces Stop continuation. Subagents do not register or display separate status. Hooks neither query the network nor auto-sync.

The plugin manifest and marketplace are `.codex-plugin/plugin.json` and `.agents/plugins/marketplace.json`. Build and install:

```sh
npm ci --ignore-scripts
npm run build:codex-plugin
codex plugin marketplace add /absolute/path/to/GitRelay
codex plugin add git-relay@git-relay-local
codex plugin list --marketplace git-relay-local --json
```

The package includes its runtime, docs, skills, and visual assets. Hooks resolve the CLI through `${PLUGIN_ROOT}`, including paths containing spaces. There is no duplicate project `.codex/hooks.json`; do not enable duplicate user-level commands. Reopen the chat and inspect `/hooks` for discovery and trust. Installation does not automatically trust hooks.

The listing uses the same presentation fields as Ponytail: display name, developer, description, three starter prompts, brand color, logo/composer icon, skills, and lifecycle hooks. GitRelay provides focused status, synchronization, help, and coordination skills. Each has English display metadata. Codex owns the listing layout, management controls, and source indicator; a local marketplace remains a local source. Local installation does not publish a Git-backed marketplace or prove the App has refreshed its view.

App actions in `.codex/environments/environment.toml` provide **Branch status**, **Monitor branches (read-only)**, and **Auto-sync (fast-forward)**. The snapshot action writes `.codex/git-relay-status.md`; monitors stream output. Actions use Node 22.19+ native TypeScript support without requiring generated `dist`. GitHub queries require authenticated `gh` on the terminal PATH. Only the explicit sync action enables synchronization; stop its terminal process to disable it.

`status --format markdown` produces readable output; JSON remains the default. `--output FILE` is only valid for a single Markdown snapshot and overwrites the explicitly supplied path, relative to the process cwd. Snapshots do not refresh automatically. The App must load the environment config to show actions; if it does not, add those commands through Local environments settings. Configuration generation, protocol tests, installed-cache verification, and native App rendering are separate acceptance checks.

Official references: [Local environments](https://learn.chatgpt.com/docs/environments/local-environment), [Hooks](https://developers.openai.com/codex/hooks), [Plugin listing metadata](https://developers.openai.com/plugins/deploy/submission), and [skill UI metadata](https://developers.openai.com/plugins/deploy/submission-errors).

### Cursor

Merge [`src/adapters/cursor/hooks.json`](../src/adapters/cursor/hooks.json) into `.cursor/hooks.json` or user settings, retaining `version: 1`.

- `postToolUse` returns `additional_context`.
- A `stop` with `status: completed` and unread relevant events returns `followup_message`. Cumulative `loop_count` is not treated as permanent disablement. Acknowledged events do not repeat; no new events returns `{}`.
- The first supported hook establishes a baseline. Later tool completions/stops check for messages without waking already stopped sessions.
- Multi-root workspaces must supply an explicit `cwd`. Without it, multiple roots are rejected rather than guessed.

## OpenCode v2

Only the **v2 Promise plugin API** is supported, exercised with `2.1.2`. The default export is an `{ id, setup(ctx) }` object, statically checked against official `@opencode/plugin@2.1.2` types without requiring the SDK at runtime.

Add a thin `.opencode/plugins/git-relay.ts` or global plugin entrypoint:

```ts
export { default } from "/absolute/path/to/GitRelay/dist/adapters/opencode/index.js";
```

Run `npm run build` for source use; npm packaging builds automatically. Remove old duplicate entrypoints and restart OpenCode.

- `ctx.session.hook("prompt", ...)` registers root sessions receiving user input and establishes/restores their baselines.
- Registered sessions are checked sequentially every five seconds, without overlapping polling batches. Delivery uses `ctx.session.prompt({ sessionID, text, delivery: "queue", metadata })`. Busy sessions queue; idle sessions start. Promise success means durable host acceptance, then a receipt is written.
- `metadata.source: "git-relay"` marks automatic messages. Both that and legacy `worktree-relay` sources are recognized, preventing recursive registration.
- `ctx.event.subscribe()` observes `session.deleted`, canceling checks even during registration queries. Failed session queries warn without failing user prompts. Cleanup cancels subscriptions, polling, and in-flight operations.
- The plugin does not enumerate historical sessions or enroll subagents. Before delivery, it checks the session's `location.directory` against `ctx.location.directory` rather than mapping other directories to this worktree.

Load an entrypoint in each receiving worktree. Local acceptance used an isolated authenticated loopback-only `opencode serve`, without replacing the user's service.

## Bundled skills

The plugin includes `git-relay`, `git-relay-sync`, `git-relay-help`, and [`worktree-coordination`](../skills/worktree-coordination/SKILL.md). The coordination skill covers event handling, full diffs, current local state, authorization boundaries, and integration checks.

pi discovers its coordination skill from the package manifest. For manual use, copy/link the desired skill folders into `.claude/skills/`, `.agents/skills/` for Codex, `.opencode/skills/`, or `.cursor/skills/` in versions supporting skills. Otherwise put relevant guidance in existing project rules. Skills provide instructions, not a cross-process delivery channel; install extensions or hooks as well.

## Custom agents and orchestrators

```sh
# Reuse the same native session ID; the first call establishes a baseline.
git-relay check --cwd /path/to/worktree-B --session conversation-B

# Stream NDJSON; SIGINT/SIGTERM exits.
git-relay watch --cwd /path/to/worktree-B --session conversation-B
```

Upstream events include `type: worktree.upstream-change`, shared `eventId`, `root`, `ref`, `previous`, `commit`, `rewritten`, `snapshot`, `unavailable`, `files`, `commits`, bounded `patch`, and `message`. Explicit `worktree.agent-message` events include `sender`, `text`, `files`, and `message`. One check can emit multiple lines.

stdout carries data; stderr carries diagnostics. **Successful output is not completed agent work.** The CLI acknowledges successful writes. Custom hosts use `consumeMailbox({ deliver })`, acknowledging after successful return; `return false` means only queued, not durably accepted. `consumeChanges` remains upstream-only. Node hosts import built `dist/core/consumer.js`. A crash between delivery and receipt persistence can redeliver; deduplicate by event ID. See [shared messages](shared-messages.md).

## Refs and remote changes

The default monitored ref is local `refs/heads/main`. CLI/hooks/OpenCode accept `WORKTREE_MAIN_REF`; CLI also accepts `--ref`, for example `refs/remotes/origin/main`. In contrast, `status --branch` takes a short branch name such as `main`.

Existing check/watch, hooks, and daemon do not fetch, access the network, or install Git hooks. Remote-tracking refs need an external fetch before they reflect remote merges. Patch generation disables external diff and textconv programs.

## Local and GitHub branch monitoring

`git-relay status [--cwd PATH] [--branch NAME]` needs no session. `--github` queries through authenticated GitHub CLI. `--repo [HOST/]OWNER/REPO` overrides gh's inferred repository; use it explicitly for forks when appropriate. Queries target the same branch name. Each gh call has a 30-second timeout, honors SIGINT/SIGTERM, and disables login prompts. Missing gh, authentication, permission, or network errors remain explicit while preserving local results.

Output type is `worktree.branch-status`:

- `worktree`: current worktree `branch`, `commit`, and `dirty`, even when another branch is selected. Dirty includes staged, unstaged, and untracked files, excludes ignored files, and is a boolean rather than a file-content change stream.
- `local`: selected `ref`, `commit`, and `tracking`. Tracking has the upstream ref, cached commit, and `ahead`/`behind`. No upstream is null; a missing upstream ref retains its name with null commit/counts. A missing or unborn local target has null commit and can still be queried remotely.
- `github`: present only when enabled. Success contains repository URL, branch, commit, and `matchesLocal`. Missing branches have null commit; comparison is null when either side lacks a commit. Failure is `{ "error": "..." }`, not branch absence or sync success. Only a successful exact-ref match establishes existence.

`--watch` emits a full initial snapshot, then deduplicated changes. Local intervals default to 5000 ms with a 50–3600000 range; GitHub intervals default to 30000 ms with a 5000–3600000 range. Each interval begins after the round finishes; requests do not overlap. Sampling may miss transient states. One-shot GitHub errors exit 1; watch emits errors and retries, including a recovery snapshot. Local Git errors go to stderr and retry; stdout failures exit.

`--watch --session ID [--agent NAME]` broadcasts changes after the baseline as ordinary agent messages. Receivers must already be registered; the monitor itself does not subscribe. Initial/restart snapshots are not broadcast. There is no persistent status history while stopped, and crash/retry boundaries can duplicate broadcasts. Normally run one monitor per target. Status messages are untrusted data and cannot authorize code/history changes or bypass idle hook limitations.

Default GitHub queries neither update remote-tracking refs nor download objects. Fetch through an existing workflow for diffs and monitor the corresponding `refs/remotes/...` with check/watch. Explicit `--auto-sync` separately enables the following fetch/fast-forward flow. This feature does not merge PRs or monitor CI/review status.

## Automatic branch synchronization

`status --auto-sync` runs one fetch/fast-forward attempt; `--watch` repeats it. It defaults off; `--no-auto-sync` explicitly disables it, and the flags are mutually exclusive. The switch is not persisted: stop a monitor and restart with new arguments. The default target is pinned at startup so a later checkout does not change it. The target must exist and be checked out in `--cwd`, otherwise synchronization is blocked; it does not update another worktree.

Synchronization uses the branch's configured Git remote/upstream. Missing, local, or multiple-source upstreams are rejected, as is combining sync with `--repo`. It fetches only that source branch into its tracking ref, without writing FETCH_HEAD, fetching tags, or recursing into submodules. It rechecks HEAD, local state, and history, then only runs `merge --ff-only --no-autostash --no-overwrite-ignore` when fast-forwarding is possible. Ahead commits are not pushed, divergence is not reset/rebased, dirty/untracked files are not stashed, and ignored-file collisions are rejected by Git. Active merge/rebase/cherry-pick/revert/bisect operations block updates.

The `sync` object reports `state` and available `remote`/`reason`. `updated` means this round changed the branch; the next can be `up-to-date`. `ahead` preserves local commits. `blocked`/`error` means no completed branch update, although fetch may already have refreshed its tracking ref. One-shot blocked/error exits 1; watch retries. State changes use the existing broadcast mechanism. Sync intervals default to 30000 ms and have a 5000 ms minimum even without `--github`.

An exclusive repository lock serializes relay sync writers, but does not constrain external Git processes. Avoid concurrent checkout, commit, or other Git writes. GitHub queries do not authorize synchronization; the explicit switch authorizes updates from configured upstream. Deleted remotes or failed authentication report errors rather than merging stale cached commits.

## State, recovery, and limitations

- Shared state uses `worktree-agent-sync/repos/<repo-id>/`, with `XDG_STATE_HOME` / `WORKTREE_SYNC_STATE_DIR` overrides. Events are repository-wide; receipts are per session. Clones remain separate; legacy Git-directory cursors are imported read-only.
- Session locks prevent concurrent duplicate delivery; active contention skips a round. Publication locks retry with jitter for up to five seconds. Lock age does not prove a stalled holder. CLI operations honor SIGINT/SIGTERM and release locks, including under output backpressure; watch exits on EPIPE rather than retrying indefinitely. SIGKILL/power loss can leave locks. Verify ownership before removing one; PID reuse cannot be resolved by a PID file alone.
- Related-history reset/force-push updates are marked rewritten and compared as snapshots. Missing commit objects produce explicit `unavailable: true` notifications, acknowledged only after acceptance. Intact commits without a common ancestor, incomparable worktree HEADs, or unavailable Git executables still fail and retain events.
- Detection includes ignored local filenames, file/directory prefix overlap, and `core.ignorecase`. Ignored file contents are not sent. Large ignored trees can slow enumeration; Git output-limit failures retain unread events. Detection reflects current local files, not future edits. Cross-file semantic dependencies and cross-machine worktrees are outside scope.
- Changes before registration are not replayed. `irrelevant` events are not redelivered if the session later edits the file. New sessions do not receive earlier broadcasts.
- Automatic wake-up consumes model quota. Transport does not prove completed adaptation. Notification adapters do not mutate, stash, merge, rebase, or commit code; only explicit status auto-sync enables its documented writes. GC retains unread messages and closed markers, with no lastSeen expiry. See [maintenance](maintenance.md).

## Official interface references

- [pi extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)
- [Claude Code hooks](https://code.claude.com/docs/en/hooks)
- [Codex hooks](https://developers.openai.com/codex/hooks)
- [Codex App Server](https://developers.openai.com/codex/app-server)
- [Cursor hooks](https://cursor.com/docs/agent/hooks)
- [OpenCode v2 Promise plugins](https://opencode.ai/build/plugins) / [client](https://opencode.ai/build/client)

See [acceptance](acceptance.md) for tested boundaries. Local model interactions covered pi `1.4.0`, Codex CLI `0.164.0`, Claude Code `2.1.310`, and OpenCode `2.1.2`. Other versions and Cursor still need verification. pi's optional `*` peer follows its packaging convention, not a claim that all versions were tested.
