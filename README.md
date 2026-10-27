# GitRelay

[English](README.md) | [Simplified Chinese](README.zh-CN.md)

Coordinate coding agents across Git branches and worktrees. GitRelay delivers relevant upstream changes, shares agent messages, and monitors local and GitHub branch state. pi also provides interactive worktree management.

The npm package is named `git-relay`, with a matching CLI. The `worktree-relay` and `worktree-sync` CLI aliases and pi's `/worktree` command remain available for existing configurations. The Git detection core is independent of pi and can also be used by Claude Code, Codex, Cursor, OpenCode v2, and other hosts. There are no runtime dependencies; Node.js 22.19+ and Git are required.

Existing `worktree-relay` / `pi-git-worktree` users should update their installation source to the new package or directory. The state root, `WORKTREE_SYNC_*` environment variables, and session identities remain unchanged; existing messages are preserved. Path-keyed repository state requires an explicit migration or fresh-state choice after checking its provenance. Examples use `git-relay`; the old CLI aliases continue to work.

## Choose the workflow

| Goal | Entry point | Changes local branches? |
| --- | --- | --- |
| Receive relevant upstream diffs and agent messages | `check` / `watch`, native adapters or hooks | No |
| Inspect local and live GitHub branch state | `status --github` | No |
| Monitor state changes | `status --github --watch` | No |
| Automatic branch synchronization | Temporarily unavailable; `--auto-sync` reports blocked | No |
| Manage worktrees in pi | `/worktree` | Explicit creation; automatic removal temporarily unavailable |
| Appear in Codex's Plugins directory | Build, register and install the Codex plugin | Installation does not enable sync |

`watch` receives mailbox events; `status --watch` observes branch snapshots. They serve different purposes. See the [migration guide](docs/migration.md) for the GitRelay rename, compatibility and plugin upgrades.

## How it works

```text
A merges into main
  → Any receiver detects an update to the shared Git ref
  → An event is published to the repository's shared user-level store
  → B/C independently check file overlap and generate relevant diffs
  → Each platform adapter injects context or a follow-up into its agent session
  → B/C record separate receipts without consuming each other's messages
```

Events go directly to agent sessions rather than asking a human to relay a notification. Automatic branch synchronization is temporarily unavailable due to a concurrent-checkout race. No daemon is required by default; an optional daemon provides centralized monitoring and cleanup. All platforms share the same user-level messaging layer for both upstream changes and explicit cross-agent coordination messages.

The first check establishes a baseline on the monitored branch; subsequent checks deliver relevant updates. Ordinary merges, fast-forwards, squash merges, and direct commits are supported. Normal first-parent advances are inspected commit by commit, so edits reverted between polls are still detected. If the previous position is not on the current first-parent chain, only the before/after snapshots are compared, without replaying changes already present.

## Platform support

| Platform | Entry point | Delivery |
| --- | --- | --- |
| pi | `src/adapters/pi/` | Every 5 seconds; retains events while busy and automatically starts the agent when idle |
| Claude Code | `src/adapters/claude-code/hooks.json` | Lifecycle hook injection; Stop can request continuation |
| Codex | `src/adapters/codex/hooks.json` | Injection in versions supporting hooks; Stop can request continuation |
| Cursor | `src/adapters/cursor/hooks.json` | Injection after tools; a completed stop can request a follow-up |
| OpenCode v2 | `src/adapters/opencode/` | Every 5 seconds through the host's durable queue; queued while busy, wakes idle sessions |
| Other hosts | `git-relay check/watch` | JSON / NDJSON, routed to the session by the host |

**Hooks cannot wake an already idle session.** Only the native pi/OpenCode adapters include polling and automatic wake-up. See the [integration guide](docs/integrations.md) for platform versions, installation steps, and limitations. The detailed guides in `docs/` are in English.

## Installation and usage

### Automatic setup

After building and installing the CLI, run `git-relay install --dry-run` to inspect detected clients, then `git-relay install` to configure supported clients. Use repeated `--platform NAME` to select clients or `--skip NAME` to exclude them. `git-relay uninstall --platform NAME` removes only the installation it owns; `--dry-run` previews the action. Codex setup installs user-level hooks only when its hooks file is absent, and requires separate trust through `/hooks`. Claude's launcher supports runtime upgrades when skills are unchanged and its originally installed Node executable remains compatible; older installations and changed skills require manual migration. See the [installation guide](docs/integrations.md#automatic-setup) for conflicts, unverified versions, upgrade limitations and retained files.

Pi detection runs `pi --version` even for a dry run, and pi installation runs
the client again for validation. Pi itself may read settings or clean its
managed staging directory. Use `--skip pi` to exclude those invocations; see
the [installation guide](docs/integrations.md#automatic-setup) for details.

### pi

```sh
pi install /absolute/path/to/GitRelay
# Restart or /reload; load the extension in every worktree.
```

By default, the extension monitors the local `refs/heads/main` and runs automatically only in TUI/RPC modes:

```sh
pi --worktree-main-ref refs/heads/develop
pi --worktree-watch=false
```

### Other agents and the CLI

```sh
npm install -g /absolute/path/to/GitRelay
git-relay --help

# The first call establishes a baseline; reuse the same ID for the same session.
git-relay check --cwd /path/to/worktree --session my-agent-session
git-relay watch --cwd /path/to/worktree --session my-agent-session
```

Follow the [integration guide](docs/integrations.md) to merge the appropriate hooks or load the OpenCode plugin. The default receiver does not fetch automatically; `status --auto-sync` currently reports blocked without fetching. When monitoring `refs/remotes/origin/main`, an external process must update the remote-tracking ref.

### Local and GitHub branch status

```sh
# Local-only snapshot; gh is optional. Defaults to the current branch.
git-relay status --branch main

# Install GitHub CLI and run gh auth login first. Query GitHub without fetching.
git-relay status --branch main --github
git-relay status --branch main --github --watch --interval-ms 30000

# Select the repository explicitly for forks/multiple remotes; broadcast changes.
git-relay status --branch main --github --repo owner/repo --watch \
  --agent cli --session branch-monitor
```

NDJSON includes the current worktree's branch, commit and dirty state, the selected local branch's commit and ahead/behind counts against its locally cached upstream, and the live GitHub branch commit with a local equality check. `gh` resolves the repository by default; `--repo [HOST/]OWNER/REPO` overrides it. `--branch` takes a branch name, not a full ref. Without it, monitoring follows the current branch; detached HEAD requires an explicit branch.

Dirty state follows Git status, including its submodule ignore settings; a
clean result may therefore hide changes inside an ignored submodule.

`--watch` emits an initial snapshot and subsequent changes only. It waits 5 seconds between local checks or 30 seconds between GitHub checks (minimum 5 seconds for GitHub). With `--session`, changes after the baseline also broadcast through the existing mailbox to other registered agents. Receivers still need their host integration. Without `--session`, output is stdout only. Restarting establishes a fresh baseline; offline changes are not replayed.

Status snapshots that exceed the mailbox's 64 KiB serialized message limit are shown locally but are not broadcast. A failed broadcast may already have completed and is not automatically retried for the same snapshot; inspect the mailbox before retrying. Diagnostics use stderr on a best-effort basis. See [monitoring limitations](docs/integrations.md#local-and-github-branch-monitoring).

GitHub failures preserve local results with `github.error`; one-shot checks exit with code 1, while watches retry. Missing branches have a `null` commit; network/auth failures are not treated as deletion. Ahead/behind counts use cached local refs and may be stale. Different cloud/local commits indicate inequality, not direction. By default this command is read-only. Automatic branch synchronization is temporarily unavailable and does not replace relevant-diff delivery. See the [integration guide](docs/integrations.md).

### Install in the Codex plugin directory

Hooks and App actions alone do not create a plugin card. This repository now includes a plugin manifest and a local marketplace:

```sh
npm ci --ignore-scripts
npm run build:codex-plugin
codex plugin marketplace add /absolute/path/to/GitRelay
codex plugin add git-relay@git-relay-local
codex plugin list --marketplace git-relay-local --json
```

Refresh Plugins → Personal in the App and look under **GitRelay**. Restart the App if it has not reloaded the catalog. The package bundles its CLI, skills and hooks without node_modules or a global npm installation. Rebuild and run the install command again after source changes to refresh the installed copy. Installation/enabling does not grant hook trust: review it through `/hooks`. Auto-sync stays off.

The plugin detail page includes a GitRelay logo, three starter prompts, and four skills: **GitRelay**, **GitRelay Sync**, **GitRelay Help**, and **GitRelay Coordination**. Listing text, skills, runtime messages, and App action labels are English; `README.zh-CN.md` is the Chinese documentation entrypoint. Codex controls the page layout and source indicator. Local installation does not publish a Git-backed marketplace.

Avoid duplicate project/user hooks when using the plugin. This checkout removes its earlier `.codex/hooks.json`; non-plugin installations can still use `src/adapters/codex/hooks.json` manually.

### Codex App

This checkout includes `.codex/environments/environment.toml` with actions for a branch snapshot, read-only monitoring, and a synchronization action that currently reports blocked. Actions run in the App terminal. The snapshot action also refreshes `.codex/git-relay-status.md`, which can be opened in the App file panel. Stop the auto-sync terminal process to disable that running monitor; starting a separate read-only monitor does not stop it.

The Codex hook template enables `--branch-status`: SessionStart/UserPromptSubmit provide local status as model context and a UI `systemMessage`. Incoming coordination messages also have visible summaries. Hooks never query GitHub or launch synchronization. Plugin hooks use the bundled CLI. Reopen the chat and verify discovery and trust through `/hooks`.

The file is a snapshot; use the monitoring terminal for live updates. Host configuration discovery/trust and visual rendering must be verified in your App version; writing configuration alone does not prove it was loaded.

### Automatic branch synchronization temporarily unavailable

`status --auto-sync` currently reports `sync.state: "blocked"` without fetching or changing refs or worktree files. One-shot invocations exit 1; `--watch` continues read-only monitoring. `--no-auto-sync` remains available. Earlier versions may still run in another terminal after upgrade: stop each old auto-sync process explicitly before using the new version. Starting a read-only monitor or stopping the daemon does not stop it.

For a user-controlled manual alternative and its concurrency limits, see [migration guidance](docs/migration.md#monitoring-and-automatic-synchronization).

### Cross-agent messages

The default state directory is `~/.local/state/worktree-agent-sync/repos/<repo-id>/`. It supports `XDG_STATE_HOME` and an absolute-path override through `WORKTREE_SYNC_STATE_DIR`. Worktrees of the same repository share events; repository identity combines the canonical Git common-directory path and a persistent marker. Read-only common directories can use an explicit identity mapping. Existing path-keyed state requires an explicit migration or fresh-state choice; see the [migration guide](docs/migration.md#repository-identity-and-existing-state).

```sh
# Register the receiving session through its native plugin/hooks or a check first.
git-relay check --cwd /project/worktree-B --agent codex --session codex-B

# A Claude Code agent publishes a message from its own worktree.
git-relay send --cwd /project/worktree-A --agent claude-code --session claude-A \
  --file src/config.ts --message 'The API contract changed; assess whether your task needs adaptation.'

git-relay sessions --cwd /project/worktree-A
```

`send` only publishes a message; it does not create a receiving subscription. Senders that also need to receive messages should register through their plugin or hooks, `check`, or `join`. Repeat `--file` to scope a message to multiple paths. Without it, the message is broadcast to other registered sessions; with it, only worktrees currently modifying matching paths receive it. New sessions do not receive broadcasts published before they joined. See the [shared messaging guide](docs/shared-messages.md) for the store layout, receipt semantics, and migration details.

### Leaving sessions, cleanup, and the optional daemon

```sh
git-relay leave --agent codex --session codex-B --cwd /project/worktree-B
git-relay join  --agent codex --session codex-B --cwd /project/worktree-B

git-relay gc --cwd /project/worktree-A          # Preview only; default retention is 7 days
git-relay gc --cwd /project/worktree-A --apply  # Remove expired events acknowledged by all recipients

git-relay daemon        # Optional centralized monitoring; safe cleanup at startup and hourly
git-relay daemon status
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
| `/worktree remove` | Inspect a selected worktree and receive manual-removal guidance; automatic removal is temporarily unavailable |
| `/worktree leave` | Explicitly stop the current session's subscription, preserving unread messages |
| `/worktree join` | Explicitly rejoin and start the receiver |

Paths are entered in dialogs and support spaces, Unicode, and absolute paths. Relative paths are resolved against pi's current directory; `~` and environment variables are not expanded. Start another agent in the new directory after creation; the current pi session's directory does not change. If a starting point matches both a branch and a tag, the command refuses to guess: use a fully qualified `refs/heads/...` or `refs/tags/...` ref.

Automatic removal is temporarily disabled because Git cannot atomically bind removal to the selected worktree: concurrent Git operations can replace it at the same path, and the original removal can delete the replacement. The exported `removeWorktree` API also rejects removal. To proceed manually, first stop all processes that may add, move or remove worktrees in the repository; inspect `git worktree list --porcelain`, verify the target and **back up Git-ignored files**, then use `git worktree remove --` with the verified path as one separately quoted argument, without `--force`. The JSON-formatted path shown in pi is data, not shell quoting; do not paste it directly as an argument. Git itself does not provide atomic identity checks, so concurrent operations can still cause the same race. See the [migration note](docs/migration.md#temporary-worktree-removal-change).

## Project layout

```text
src/
├── core/
│   ├── git.ts             # Git/worktree operations
│   ├── branch-status.ts   # Local/upstream state and optional GitHub CLI queries
│   ├── branch-sync.ts     # Automatic synchronization temporarily blocked
│   ├── status-format.ts   # Markdown status snapshots
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
scripts/build-codex-plugin.mjs # Standalone Codex plugin package
scripts/benchmark.mjs       # Isolated event-store scale benchmark
.codex-plugin/plugin.json   # Plugin identity and display metadata
.agents/plugins/marketplace.json # Local plugin catalog
.codex/environments/environment.toml # App terminal actions
.github/workflows/check.yml # macOS/Linux checks on Node 22.19/24
dist/                       # Build output (not committed)
skills/worktree-coordination/
docs/{integrations,migration,maintenance,acceptance}.md
tests/{core,adapters,cli}/
index.ts                    # Compatibility entry point for older pi loading paths
```

The default runtime uses Node's standard library and local Git; live GitHub queries additionally require an authenticated `gh` executable. Adding a platform adapter does not require changing the Git detection logic. The project avoids a monorepo or multiple published packages for hypothetical future needs.

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

Tests use temporary repositories and isolated state directories. They cover multi-worktree merges, file overlap, path normalization, non-contiguous first-parent history, reverted edits, renames, large diffs, rewritten history, cross-agent broadcasts, independent receipts, legacy migration, concurrent retries, pi queue deduplication, OpenCode v2 durable queues and cancellation, hook protocols, and communication between separate CLI processes. Real-model receipt and deduplication have been verified locally with pi `1.4.0`, Codex CLI `0.164.0`, Claude Code `2.1.310`, and OpenCode `2.1.2` on the recorded snapshots. A later isolated pi real-model check covered message use and restart on an earlier source snapshot; full acceptance of the current source remains incomplete. See the [acceptance results](docs/acceptance.md) for tested builds and scope. This does not imply verification of other versions or Cursor.

GitRelay provides file-level change awareness, not semantic conflict detection. Automatic synchronization is temporarily unavailable. The absence of an event does not rule out cross-file effects, and delivery does not mean an agent has completed its adaptation. Normal operation deduplicates events, but crashes may cause redelivery. CLI/hooks acknowledge successful output; the host must confirm actual acceptance. Only events acknowledged by all recipients and past their retention period are collected; unread messages and closed-session markers are preserved. The daemon does not bypass a host's idle wake-up limitations. See the [integration guide](docs/integrations.md#state-recovery-and-limitations) for more limitations and recovery procedures.
