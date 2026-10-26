# GitRelay

[English](README.md) | [简体中文](README.zh-CN.md)

Automatically deliver main-branch changes to coding agents working on related files in different Git worktrees of the same project.

The npm package is named `worktree-relay`, with a matching CLI. The `worktree-sync` CLI alias and pi's `/worktree` command remain available for existing configurations. The Git detection core is independent of pi and can also be used by Claude Code, Codex, Cursor, OpenCode v2, and other hosts. There are no runtime dependencies; Node.js 22.19+ and Git are required.

Existing `pi-git-worktree` users should update their installation source to the new package or directory. The state directory, `WORKTREE_SYNC_*` environment variables, and session identities remain unchanged; existing messages are not migrated or cleared. The examples below use the compatibility command `worktree-sync`, which can be replaced with `worktree-relay`.

## How it works

```text
A merges into main
  → Any receiver detects an update to the shared Git ref
  → An event is published to the repository's shared user-level store
  → B/C independently check file overlap and generate relevant diffs
  → Each platform adapter injects context or a follow-up into its agent session
  → B/C record separate receipts without consuming each other's messages
```

Events go directly to agent sessions rather than asking a human to relay a notification. Worktree Relay does not automatically overwrite files, merge, or rebase. No daemon is required by default; an optional daemon provides centralized monitoring and cleanup. All platforms share the same user-level messaging layer for both upstream changes and explicit cross-agent coordination messages.

The first check establishes a baseline on the monitored branch; subsequent checks deliver relevant updates. Ordinary merges, fast-forwards, squash merges, and direct commits are supported. Normal first-parent advances are inspected commit by commit, so edits reverted between polls are still detected. If the previous position is not on the current first-parent chain, only the before/after snapshots are compared, without replaying changes already present.

## Platform support

| Platform | Entry point | Delivery |
| --- | --- | --- |
| pi | `src/adapters/pi/` | Every 5 seconds; queued while busy, automatically starts the agent when idle |
| Claude Code | `src/adapters/claude-code/hooks.json` | Lifecycle hook injection; Stop can request continuation |
| Codex | `src/adapters/codex/hooks.json` | Injection in versions supporting hooks; Stop can request continuation |
| Cursor | `src/adapters/cursor/hooks.json` | Injection after tools; a completed stop can request a follow-up |
| OpenCode v2 | `src/adapters/opencode/` | Every 5 seconds through the host's durable queue; queued while busy, wakes idle sessions |
| Other hosts | `worktree-sync check/watch` | JSON / NDJSON, routed to the session by the host |

**Hooks cannot wake an already idle session.** Only the native pi/OpenCode adapters include polling and automatic wake-up. See the [integration guide](docs/integrations.md) for platform versions, installation steps, and limitations. The detailed guides in `docs/` are currently in Chinese.

## Installation and usage

### pi

```sh
pi install /absolute/path/to/worktree-relay
# Restart or /reload; load the extension in every worktree.
```

By default, the extension monitors the local `refs/heads/main` and runs automatically only in TUI/RPC modes:

```sh
pi --worktree-main-ref refs/heads/develop
pi --worktree-watch=false
```

### Other agents and the CLI

```sh
npm install -g /absolute/path/to/worktree-relay
worktree-sync --help

# The first call establishes a baseline; reuse the same ID for the same session.
worktree-sync check --cwd /path/to/worktree --session my-agent-session
worktree-sync watch --cwd /path/to/worktree --session my-agent-session
```

Follow the [integration guide](docs/integrations.md) to merge the appropriate hooks or load the OpenCode plugin. Worktree Relay does not fetch automatically. When monitoring `refs/remotes/origin/main`, an external process must update the remote-tracking ref.

### Cross-agent messages

The default state directory is `~/.local/state/worktree-agent-sync/repos/<repo-id>/`. It supports `XDG_STATE_HOME` and an absolute-path override through `WORKTREE_SYNC_STATE_DIR`. Worktrees of the same repository share events; separate clones are isolated by the real path of their Git common directory.

```sh
# Register the receiving session through its native plugin/hooks or a check first.
worktree-sync check --cwd /project/worktree-B --agent codex --session codex-B

# A Claude Code agent publishes a message from its own worktree.
worktree-sync send --cwd /project/worktree-A --agent claude-code --session claude-A \
  --file src/config.ts --message 'The API contract changed; assess whether your task needs adaptation.'

worktree-sync sessions --cwd /project/worktree-A
```

`send` only publishes a message; it does not create a receiving subscription. Senders that also need to receive messages should register through their plugin or hooks, `check`, or `join`. Repeat `--file` to scope a message to multiple paths. Without it, the message is broadcast to other registered sessions; with it, only worktrees currently modifying matching paths receive it. New sessions do not receive broadcasts published before they joined. See the [shared messaging guide](docs/shared-messages.md) for the store layout, receipt semantics, and migration details.

### Leaving sessions, cleanup, and the optional daemon

```sh
worktree-sync leave --agent codex --session codex-B --cwd /project/worktree-B
worktree-sync join  --agent codex --session codex-B --cwd /project/worktree-B

worktree-sync gc --cwd /project/worktree-A          # Preview only; default retention is 7 days
worktree-sync gc --cwd /project/worktree-A --apply  # Remove expired events acknowledged by all recipients

worktree-sync daemon        # Optional centralized monitoring; safe cleanup at startup and hourly
worktree-sync daemon status
```

Leaving does not acknowledge unread messages. Ordinary shutdowns and reloads are treated as offline time, not a permanent opt-out. Cleanup preserves unread events, session records, and monitoring positions. Receivers fall back to local monitoring if the daemon stops or becomes unavailable. See the [maintenance guide](docs/maintenance.md) and [acceptance results](docs/acceptance.md) for details and verification scope.

### Skills

[`skills/worktree-coordination/SKILL.md`](skills/worktree-coordination/SKILL.md) guides agents to re-read local state, inspect full diffs, assess impact, protect unfinished work, and verify adaptations. It is loaded automatically when installed in pi; other platforms can install it in their own skills directories.

## Managing worktrees in pi

| Command | Purpose |
| --- | --- |
| `/worktree` | Open the action menu |
| `/worktree list` | Show paths, branches, commits, and status |
| `/worktree add` | Create a branch or use an existing local branch; optionally choose a starting point for a new branch |
| `/worktree remove` | Remove a worktree after confirmation, keeping its branch |
| `/worktree leave` | Explicitly stop the current session's subscription, preserving unread messages |
| `/worktree join` | Explicitly rejoin and start the receiver |

Paths are entered in dialogs and support spaces, Unicode, and absolute paths. Relative paths are resolved against pi's current directory; `~` and environment variables are not expanded. Start another agent in the new directory after creation; the current pi session's directory does not change. If a starting point matches both a branch and a tag, the command refuses to guess: use a fully qualified `refs/heads/...` or `refs/tags/...` ref.

Removal never uses `--force` and refuses to remove the primary worktree, locked worktrees, or the worktree containing the current pi session, including subdirectory and symlink entry points. Git blocks removal when tracked files are modified or staged, or when untracked files are present. **Git-ignored files may still be deleted with the worktree; back them up first.** This protection does not cover directories used by other agent processes.

## Project layout

```text
src/
├── core/
│   ├── git.ts             # Git/worktree operations
│   ├── changes.ts         # File overlap, commit ranges, diffs, and event formatting
│   ├── store.ts           # User-level state, repository identity, atomic writes, and locks
│   ├── mailbox.ts         # Session registration, broadcasts, and message formatting
│   ├── publisher.ts       # Shared ref synchronization and event chains
│   ├── sessions.ts        # Explicit subscription join/leave
│   ├── cleanup.ts         # Acknowledged-event cleanup and interruption recovery
│   ├── daemon-state.ts    # Singleton heartbeat and fallback checks
│   ├── daemon.ts          # Optional multi-repository monitoring and periodic cleanup
│   └── consumer.ts        # Relevance filtering, independent receipts, and daemon delegation
├── adapters/
│   ├── pi/                # Native commands, lifecycle, and follow-ups
│   ├── claude-code/       # Lifecycle hook configuration
│   ├── codex/             # Lifecycle hook configuration
│   ├── cursor/            # Hook configuration
│   ├── opencode/          # V2 Promise plugin, session enrollment, and durable queue delivery
│   └── hooks.ts           # Hook input validation and protocol conversion
└── cli/main.ts            # Generic CLI / hook runner
scripts/build.mjs           # Publishable JS using Node's built-in type stripping
scripts/benchmark.mjs       # Isolated event-store scale benchmark
.github/workflows/check.yml # macOS/Linux checks on Node 22.19/24
dist/                       # Build output (not committed)
skills/worktree-coordination/
docs/integrations.md
tests/{core,adapters,cli}/
index.ts                    # Compatibility entry point for older pi loading paths
```

The core uses only Node's standard library and local Git. Adding a platform adapter does not require changing the Git detection logic. The project avoids a monorepo or multiple published packages for hypothetical future needs.

## Testing and limitations

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm pack --dry-run
npm run benchmark
```

Typechecking covers the core, adapters, and tests without changing the build process. TypeScript, Node types, and host types are development dependencies only. The pi development dependency pins a patched `undici` through an override, without adding runtime dependencies. CI runs typechecking, tests, and a package dry-run on macOS/Linux with Node `22.19.0` and `24`.

The benchmark uses 3 sessions and 100/1,000/10,000 retained broadcasts. It compares idle polling and recovery of 32 offline messages with and without the daemon. It does not read user messages or call a model. See the [performance results](docs/performance.md) for measurements and limitations.

Tests use temporary repositories and isolated state directories. They cover multi-worktree merges, file overlap, path normalization, non-contiguous first-parent history, reverted edits, renames, large diffs, rewritten history, cross-agent broadcasts, independent receipts, legacy migration, concurrent retries, pi queue deduplication, OpenCode v2 durable queues and cancellation, hook protocols, and communication between separate CLI processes. Real-model receipt and deduplication have been verified locally with pi `1.4.0`, Codex CLI `0.164.0`, Claude Code `2.1.310`, and OpenCode `2.1.2`; see the [acceptance results](docs/acceptance.md) for the tested builds and scope. This does not imply verification of other versions or Cursor.

Worktree Relay provides file-level change awareness, not semantic conflict detection or synchronization. The absence of an event does not rule out cross-file effects, and delivery does not mean an agent has completed its adaptation. Normal operation deduplicates events, but crashes may cause redelivery. CLI/hooks acknowledge successful output; the host must confirm actual acceptance. Only events acknowledged by all recipients and past their retention period are collected; unread messages and closed-session markers are preserved. The daemon does not bypass a host's idle wake-up limitations. See the [integration guide](docs/integrations.md#状态恢复和限制) for more limitations and recovery procedures.
