# GitRelay: Agent integration and message delivery

The npm package is `git-relay`. The CLI aliases `worktree-relay` and `worktree-sync` use the same entrypoint. Existing state directories and environment variables remain unchanged. See [migration](migration.md) for renaming and plugin upgrades.

## Host capabilities

| Platform | Integration | Busy agent | Already idle agent |
| --- | --- | --- | --- |
| pi | Native extension | Retains events in GitRelay until the current run is idle | Starts another run automatically |
| OpenCode v2 | Promise plugin with `id/setup` | Delivers through the durable host queue | Checks registered sessions every five seconds and starts a run |
| Claude Code | Synchronous lifecycle hooks | Injects after tools; Stop can request continuation | Waits for the next hook |
| Codex | Synchronous lifecycle hooks | Injects after tools; Stop can request continuation | Waits for the next hook |
| Cursor | Synchronous hooks | Injects after tools; completed stop can request follow-up | Waits for the next hook |
| Other clients | CLI JSON / NDJSON | Host routes events into the session | Host must implement wake-up |

Platforms cooperate through a shared user-level message store, without calling each other. For example, A merges into main using Claude Code, a receiver publishes the shared event, and B using pi and C using OpenCode each deliver it to their own agent. `git-relay send` publishes explicit coordination messages. See [shared storage](shared-messages.md) for identities, broadcasts, and receipts.

GitRelay does not simulate terminal keystrokes, edit transcripts, or start a separate agent to impersonate delivery into the original session.

## Automatic setup

Build and install the CLI first (`npm install -g /absolute/path/to/GitRelay`). The installer configures **Codex, Claude Code, pi and OpenCode** within the limitations below. It reports each detected platform separately, and an error on one does not prevent attempts on the others. The exit status is nonzero when a selected client cannot be configured.

```sh
git-relay install --dry-run
git-relay install --platform claude-code --platform opencode
git-relay install --skip pi --skip codex
git-relay uninstall --platform opencode --dry-run
git-relay uninstall --platform opencode
```

`--platform` and `--skip` may be repeated; do not select and skip the same client. Missing clients, failed detection, incompatible versions and versions without sufficient compatibility evidence have distinct results. OpenCode v1 and earlier are incompatible; versions in the declared `^2.1.2` peer range may be configured, while other versions remain unverified. Stable pi versions below 0.78.1 lack an API required by the watcher and are incompatible. This API floor does not establish full compatibility for later versions; pi pre-releases are unverified. Other clients default to the historically exercised versions shown in the [matrix](platform-matrix.md). `--allow-unverified` explicitly attempts an unverified version; it does not override an incompatible result, establish compatibility or bypass platform trust. A dry run is detection or a removal preview, not a full ownership check or successful installation. An uninstall preview reports `would-check-and-remove` when a managed record exists; the actual uninstall still checks the current entry and may preserve it and refuse removal.

If a client or its wrapper prints more than one distinct version to stdout or stderr during the version check, detection reports `unavailable` instead of guessing which version identifies the client. A version must appear on stdout to identify the client; stderr only contributes to ambiguity checks. Thus a version printed only to stderr, or a warning mentioning a different dependency version, can cause `unavailable`. Inspect the wrapper output and retry with an unambiguous version response. Repeating the same version does not make the output ambiguous.

Version detection also reports `unavailable` when a version token exceeds 256 characters (including a leading `v`) or a major, minor, or patch number exceeds JavaScript's safe integer range. This follows the package manager's version-range limits rather than treating an unrepresentable version as compatible.

If a client entry on `PATH` is a broken symbolic link or fails the static executable check, detection continues looking for another entry and reports `unavailable` if none is usable. It also checks later entries if the version command fails to start with `ENOENT` or `EACCES`, such as when a script interpreter is missing or not executable. If a command starts but exits unsuccessfully, times out, or returns an unrecognized or ambiguous version, detection stops with `unavailable`. Other spawn errors also stop detection. Inspect the entry and its target, or adjust `PATH`, before retrying. This does not protect against an entry changing between inspection and execution; Windows PATH behavior remains unverified.

Pi detection currently executes `pi --version`, including during
`install --dry-run`. In pi 1.4.0 that entry reads settings before reporting its version;
an official managed launcher can also initiate its own staging cleanup. The
pi installer separately starts the client to validate its staged extension and
skill. A wrapper can have additional side effects. Use `--skip pi` to exclude
these pi invocations from an automatic install or its preview; use the manual
pi integration below if this limitation is unacceptable. Static, side-effect
free recognition is not yet implemented for all pi installation types.

Windows client detection is not yet verified on a real Windows host. It can select a `.cmd` or `.bat` entry from `PATHEXT`, but the current version probe starts it without a shell; [Node's Windows documentation](https://nodejs.org/download/release/v22.23.2/docs/api/child_process.html#spawning-bat-and-cmd-files-on-windows) says these files require `cmd.exe` or a shell. Such an installation may therefore be reported as `unavailable` even when the client exists. Claude's plugin operations also start `claude` without a shell and can pass variable marketplace paths, so a `.cmd`-only Claude installation cannot be assumed to work even if another detection entry succeeds. Cancellation of a Windows shell and its descendants has not been validated. Do not treat these limitations as Windows host acceptance; use the platform's manual integration instructions when automatic setup cannot detect or run the client.

The managed workspace is `${XDG_DATA_HOME:-~/.local/share}/git-relay`. A new workspace is published through an owned sibling directory and a symbolic link; systems that cannot create directory symlinks cannot use this installer. An existing unowned directory or conflicting platform entry is preserved and reported. OpenCode installs a stable entry in `${XDG_CONFIG_HOME:-~/.config}/opencode/plugins/`, with immutable runtime snapshots and append-only revision markers in the workspace. Restart OpenCode to load a changed snapshot. Uninstall moves its entry into a retained `.git-relay-removed-*` directory and reports its path, preserving possible concurrent writes. If the entry changed, the installer stops and preserves it; during a concurrent uninstall edit, recovery may require the reported archive path.

If publication of a new workspace or Claude setup directory fails or races another installer, GitRelay retains the staged directory and reports its path. It may contain externally added data or be referenced by a live link; inspect references and contents before considering manual cleanup. Repeated installation into an existing valid workspace does not create a new workspace stage. These retained stages are not automatically deleted.

Installer snapshot checks for Codex, OpenCode and Claude currently use a
locale-dependent ordering. A locale or runtime environment change can make a
previously valid snapshot appear modified and stop an upgrade. Preserve the
reported files and inspect the original installation environment and snapshot;
a mismatch can also indicate a real modification. The old record does not
retain enough information to reconstruct every historical digest, so restoring
the former locale alone is not a guaranteed recovery. Pi uses a different
digest ordering. See [acceptance](acceptance.md) for the reproduced scope.

Runtime publication currently has an unresolved race: if another process creates an empty destination directory after the installer checks that it is absent but before it renames its staged snapshot, the rename can replace that directory. This was reproduced for all four platform installers in isolated tests. Do not run concurrent GitRelay installers or edit the managed workspace during installation or upgrade; platform-specific locks do not coordinate every external process or all platform installers. A destination already present when checked is preserved and reported.

Codex uses user-level hooks only if `$CODEX_HOME/hooks.json` is absent. Existing hooks, a previous GitRelay plugin-install record, an installed GitRelay-compatible Codex plugin, or an unreadable plugin list block automatic setup without replacing them. The result is `pending-trust`: review and trust each hook through `/hooks` in Codex. This is a hook integration and does not create a Plugins card. Project-level hooks or a plugin installed later can still duplicate delivery; inspect `/hooks`. Windows automatic hook setup is unsupported. The recorded absolute Node executable must remain available; if it moves, uninstall and reinstall the hooks, then review trust again. Uninstall retains an archive and reports its path.

Each Codex install records a distinct operation generation. If its later
conflict check fails, automatic withdrawal checks that generation under the
installation lock; a newer repeated install, upgrade or reinstall is preserved
and requires inspection instead. Cancellation of a normal uninstall is
honored while waiting for the lock and before journal or archive changes. If
interrupted after a journal or archive change, rerun uninstall to finish;
inspect the retained files first. A failed install's protective rollback is
not canceled midway merely because the original request was canceled. These
checks coordinate GitRelay operations using the installation lock; they do not
make changes by unrelated processes atomic.

When Codex or OpenCode installation is interrupted, uninstall preserves any
pending revision in its installation record so a later reinstall can recover
the retained state. A modified revision or missing runtime still stops the
reinstall rather than being silently replaced. SIGKILL can leave an installer
lock: verify its owner is no longer running before removing only that lock.
Process-interruption tests do not establish recovery after power loss.

There is an unresolved startup race during Codex and OpenCode upgrades: a
generated launcher can read the old installation record, then observe a new
revision marker and reject it. Isolated tests of the generated launchers and
real installer reproduce this for both platforms; actual host error reporting
has not been verified. Stop sessions that can invoke these launchers while
upgrading and restart them after the upgrade completes. A later clean launch
loaded the new runtime in the controlled tests. See the failing TODOs in
`tests/cli/bootstrap-upgrade-race.test.ts`; older running launchers and other
processes are not fenced automatically.

Claude uses its native user-scoped marketplace and plugin commands. New installations use a stable launcher: rerunning installation can upgrade the runtime when the bundled skills are unchanged and the originally recorded Node executable remains compatible, while the native plugin's reported version remains the original installation version. The installer checks the recorded executable even if the current CLI uses another Node path; if it is unavailable or incompatible, migrate or reinstall the plugin. Older installation formats are not automatically migrated, and changes to the skills require [manual plugin migration](migration.md#migrate-a-managed-claude-code-plugin); the installer stops and preserves the existing installation. Uninstall retains the marketplace registration and plugin data because other projects may reference it. The installer serializes its own updates, but cannot protect against a separate process concurrently rewriting its internal `claude/journal.json`; do not edit that file during installation or recovery. Native plugin installation does not replace any host trust or approval flow. Do not install duplicate manual hooks alongside these managed integrations.

If an interrupted Claude upgrade has already published its revision, rerunning
installation validates that revision before preserving it as the current
launcher target and attempting a newer package. If the installer was killed,
confirm that its process has exited before removing only its stale installer
lock; do not remove the journal or snapshots to force recovery. Process
interruption checks do not establish durability after power loss.

Do not edit Claude's user settings or run other plugin changes concurrently with its plugin commands. In isolated tests of Claude Code `2.1.310`, `plugin disable` sometimes restored an older value of an unrelated setting, and simultaneous native updates of two plugins sometimes left one at its old recorded version despite both commands reporting success. GitRelay's lock does not serialize other host processes. See [acceptance](acceptance.md#claude-node-path-and-settings-concurrency-checks-2026-10-27-asiasingapore) for the tested scenarios and limits.

pi uses its global extension and skill discovery directories without editing settings. Automatic pi installation and uninstall are unavailable on Windows, and require `ln -P` support on other systems. An interrupted upgrade can make pi reject the extension until the installer is rerun to complete it. If the package changed meanwhile, the installer validates and completes the retained pending snapshot before upgrading to the current package; it refuses a missing or modified pending snapshot and preserves the existing state for inspection. Cross-volume pi archive handling is covered by simulated tests, not a real multi-volume host acceptance. Existing GitRelay package registrations or manually installed entries are preserved and reported instead of being adopted.

Installer metadata, old runtime snapshots, OpenCode ownership anchors and retained archives, shared event state, receipts and subscriptions are not removed by uninstall. Shared state remains at `WORKTREE_SYNC_STATE_DIR` or the documented `worktree-agent-sync` state directory, partitioned by repository identity; uninstalling a plugin does not close sessions or delete messages. A killed process may leave an installer lock. Recheck whether its owner is still running before manually removing only that lock; empty locks can have an unknown owner. Never remove a live lock or user data to force recovery.

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

Concurrent `/worktree join` and `/worktree leave` commands for the same pi
session ID are serialized within one process, including extension reloads;
the next command waits for the previous command's watcher and subscription
operation to finish. A stalled operation can therefore delay later commands
for that ID. Separate processes and direct SDK callers do not share this queue.
Before upgrading from an older extension without the queue, finish its active
join or leave commands; a reload cannot add an already-running old command to
the new queue. Different repositories using the same session ID also wait for
one another in the same process. Existing filesystem locks still govern state
access; the queue does not recover stale locks.

When adding a worktree through pi, surrounding ASCII whitespace is removed from branch and starting-point input, while Unicode whitespace is preserved as part of the Git name. Worktree paths are passed through as entered; a path made only of Unicode whitespace is valid. Existing local pi package paths are checked without stripping Unicode whitespace, so the installer can detect an already configured GitRelay package.

`/worktree remove` currently reports manual guidance and never invokes Git to
remove the selected directory; the exported `removeWorktree` API likewise
rejects automatic removal. This temporary compatibility change protects against
a confirmed same-path replacement race. Before a manual Git removal, stop
concurrent worktree changes, verify the target and back up ignored files;
Git itself has no atomic identity condition and still races with other
processes. This safeguard takes effect only in an updated, reloaded extension;
older pi processes and SDK versions can still remove worktrees automatically.
See the [migration note](migration.md#temporary-worktree-removal-change).

Print/JSON mode does not start background polling. `/worktree` management remains available; root `index.ts` preserves the legacy extension loading path.

pi uses shared user-level storage and native session IDs for receipts. While pi is busy, events stay unread in GitRelay rather than entering the host's unobservable custom follow-up queue. The watcher checks every five seconds and starts a follow-up when pi becomes idle. Seeing a message only in the host's in-memory branch does not acknowledge it: the matching native session entry and its parent chain must also be present in the session file. The file identity and timestamps are rechecked immediately before each confirmation, but this cannot make the receipt atomic with unrelated processes replacing the native file. A session file makes host acceptance visible, but does not prove that storage hardware has flushed the bytes. If an observed session file disappears, or a persisted session's branch is missing entries or has a broken parent chain, the watcher preserves unread events, stops further delivery and warns: stop the affected session and resume from an intact native session file. It does not modify that file; merely restoring write permission cannot reconstruct missing entries. In `--no-session` mode pi does not provide a persistent session file: in-memory messages can be delivered during the run, but their GitRelay receipts remain unconfirmed and may retain events for cleanup. Repeated join, leave/join, and extension reloads retain in-process pending-batch coordination for the same session. If a host accepts a deferred send without reporting whether it started, the watcher preserves the event and warns instead of sending it again; restarting pi alone does not resolve the unknown outcome. Restart pi after upgrading from older GitRelay versions if their follow-ups may already be queued. Old custom-entry/message cursors can be imported. Initial registration establishes a baseline without replaying earlier changes.

**Do not reuse a pi session ID for a different session file** in the same
worktree and ref, even when using different `--session-dir` directories with
the same GitRelay state root. The current subscription key does not bind the
native file: an isolated pi 1.4.0 RPC test confirmed that the replacement can
receive the earlier session's unread messages. This requires deliberate ID
reuse in the test; it does not establish that randomly generated IDs collide.
Use a distinct native ID and preserve the old inbox until its owner is known.
There is not yet a safe automatic binding or migration for existing inboxes.

The watcher also stops before sending or confirming if it observes a nonempty
session file whose last line has no newline. An active pi process can otherwise
append its next entry to that unfinished line. Preserve the file and restore a
trusted intact copy; adding a newline alone cannot reconstruct an incomplete
record. A complete malformed line ending in a newline remains compatible with
pi's existing parser. This check and its later file-signature revalidation are
not an atomic condition on another process: an unrelated writer can still
append a partial line after the last check but before pi appends, or replace the
file after the confirmation check but before the receipt is committed. In the
first case the native entry can become corrupt; in the second a delivered
receipt can refer to a replaced file. Stop other writers before recovery and do
not treat the check as a guarantee against concurrent external changes.

Before handing a message to pi, GitRelay records a per-event, per-session hash of the entire native message. Proof publication requires hard-link support in the state directory; if it fails, GitRelay does not send the message. On confirmation it checks the native entry, the original shared event, its rendered contents, and this independent proof. The native session file must also be valid UTF-8. A missing, corrupt, or mismatched proof leaves the event unread and produces a warning; it is not proof that pi did or did not act on the earlier message. Older GitRelay versions did not write these proofs. An old native entry without a corresponding existing receipt therefore cannot be automatically confirmed or safely resent: preserve the session and event and review them manually. Existing receipts are not revoked. Successful writes are not a power-loss durability guarantee, and non-cooperating processes can still alter files outside GitRelay's locks.

Upgrade and stop all older participants before sharing this state. An isolated
test of an earlier development snapshot using the same repository-identity
namespace found that its pi watcher ignored a pending proof and sent the event
again, while the current watcher retained it. The test used a simulated host
and does not establish that this older snapshot is running in any user's
environment. Its source hashes and reproduction are recorded in
`/private/tmp/gitrelay-proof-compat-evidence-3b1d33m8/manifest.json`; temporary
evidence may be removed by the operating system. The current state format does
not enforce a version fence against older processes.

If a proof exists but no matching native record is visible, GitRelay treats the host outcome as unknown: it does not mark the event irrelevant or send it again, including after restart. This can also block later events in the same session. Stop the affected pi session, inspect its native session file alongside the retained event and proof, and restore any missing or corrupt files from a trusted backup. `git-relay pi-inspect --cwd /absolute/worktree --session SESSION_ID --event EVENT_ID` is a read-only evidence preview: it lists the observed proof paths, digest-related event IDs and receipt states without printing message contents. It checks for changes while reading, but matching proofs may be only part of a batch if publication was interrupted, and the output does not establish whether the host accepted or acted on a message. If the outcome cannot be established, there is no safe automatic confirmation or resend; preserve the files for manual review. A proof created by the current operation is removed only if that operation fails before calling pi and the proof still has the same file identity; once the host call begins, or after a forced termination, the proof is retained.

In pi 1.4.0, another extension can delay an `agent_settled` handler while pi reports idle. A session switch during that delay may leave an old deferred host action running after the old session is disposed. A controlled SDK test observed an additional model invocation without a matching persisted session entry; its request did not contain the relay message. GitRelay keeps an unconfirmed event unread across a switch back to that session and warns if it cannot determine the action's outcome. If the warning persists, inspect the retained session and proof as described above; restarting does not establish whether the action was accepted. Avoid switching or forking until the pending action has settled. The extension cannot cancel an action already deferred inside pi.

The watcher retries a failed initial Git lookup every five seconds. It warns
for most failures, but suppresses Git exit 128 because Git does not reliably
distinguish a non-repository from some damaged or inaccessible repositories.
Even a non-repository session retains a watcher and runs one Git lookup per
interval until stopped; see the [measurement](performance.md#pi-non-repository-startup-retries-2026-10-27-asiasingapore).

Controlled pi 1.4.0 SDK tests previously reproduced overlapping start/shutdown
leaving a watcher polling and a stale `/worktree` menu closing a different
session. The current extension tracks ongoing watcher stops and rechecks the
session around dialogs and operations. Isolated simulated-host regressions
cover those interleavings and a real Git `join` started before shutdown; they
do not establish that ordinary pi RPC or TUI naturally produces them. Already
started Git or subscription operations cannot be revoked by a session change;
the extension logs that their outcome should be inspected if the session
changes. Log visibility depends on the host. The in-process queue does not
coordinate older extension instances without the queue, other processes or
direct SDK calls; inspect the subscription if an operation was interrupted.
Git cancellation may also return before a child process
exits. See the [local evidence](acceptance.md#pi-startup-and-session-lifecycle-regressions-2026-10-27-asiasingapore).

Global hooks normally return `{}` outside Git repositories. If Git cannot start
or its subprocess is terminated, the hook instead reports an error and leaves
events unconfirmed. A missing working directory, an inaccessible or damaged
repository, or unsafe Git ownership may still be silently treated as non-Git:
Git's numeric exit status does not reliably distinguish all of these cases.
Check Git manually if an expected notification is missing. Claude Code usually
treats exit code 1 as a non-blocking hook error, but host configuration such as
`onFailure: "block"` can change that behavior. OpenCode does not persist a
subscription while its location is outside a Git repository.

## CLI and hook installation

```sh
npm install -g /absolute/path/to/GitRelay
git-relay --help
```

Node.js 22.19+ is required. The hook environment must find `git-relay` on PATH, or commands must use correctly quoted absolute Node/script paths. GUI applications may not inherit an interactive shell's PATH.

Merge example `hooks` entries into existing host settings rather than overwriting them, then review and enable hooks through the host's trust flow.

Codex, Claude Code and Cursor hooks report Git discovery failures other than
exit 128, along with spawn errors, timeouts and cancellation. Exit 128 is
still ignored for compatibility with ordinary non-repositories; Git also uses
that exit code for damaged or inaccessible repositories, so this cannot
distinguish every failure. If relay context is absent in an expected repository,
inspect its Git status and the host's hook diagnostics.

### Claude Code

Merge [`src/adapters/claude-code/hooks.json`](../src/adapters/claude-code/hooks.json) into `.claude/settings.json` or user settings.

- `SessionStart` establishes or restores the baseline, but defers relay notifications to the next supported hook. A SessionStart response can be discarded if the user switches conversations or clears the session while it runs. Configure `UserPromptSubmit`, `PostToolUse`, or `Stop` as well; a SessionStart-only installation will not receive notifications. The managed plugin configures all four events.
- `UserPromptSubmit` / `PostToolUse` return model context in `hookSpecificOutput.additionalContext`.
- `Stop` with new events returns `decision: block` and event content to request continuation; `stop_hook_active` prevents another continuation request.

During `SessionStart`, normal relevance checks still run and can mark an irrelevant event as such; relevant notifications are left unread. Other hook outputs can also be discarded after a timeout, cancellation or host failure. A relay receipt records successful hook output, not proof that Claude applied the context; a message can be lost in that window.

Hooks carrying a nonempty `agent_id` return `{}` without registering or consuming the parent inbox. Claude documents this field for both subagents and in-process agent-team teammates, so those teammate hook calls are also skipped; GitRelay does not currently provide an independent inbox for them through these hooks. A separately started Claude Code session without `agent_id` follows the normal session path. The parent can check its inbox at its next supported hook.

Claude's [hook reference](https://code.claude.com/docs/en/hooks) describes `TeammateIdle` as a teammate about to become idle, not as a termination event; a stopped in-process teammate may later resume. GitRelay does not use that event to close a subscription. The relationship between teammate hook IDs across its lifecycle has not been verified in a real host, and the existing hooks do not establish teammate delivery or cleanup.

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

App actions in `.codex/environments/environment.toml` provide **Branch status**, **Monitor branches (read-only)**, and **Auto-sync (fast-forward)**. The snapshot action writes `.codex/git-relay-status.md`; monitors stream output. Actions use Node 22.19+ native TypeScript support without requiring generated `dist`. GitHub queries require authenticated `gh` on the terminal PATH. The sync action currently reports blocked. Stop any older running sync process in its terminal after upgrading.

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

If Git root discovery fails at startup, the plugin emits a best-effort warning
and registers its prompt hook. A root session's next user prompt begins retries;
repeated root failures are retried with backoff up to one minute and identical
warnings are suppressed until the root is healthy. A directory initialized as a
repository can therefore become active without a plugin reload. A new session
is not registered until Git discovery succeeds and registration completes, so
events sent before then cannot be recovered for that session. Existing persisted
subscriptions remain. Existing sessions that never
receive another user prompt are not discovered. Git can report the same error
for an ordinary non-Git directory and a damaged repository; both produce this
warning. It includes Git's diagnostic output and is not sanitized. The initial
Git lookup and first session prompt can each wait for Git's 30-second timeout.
If the resolved root path changes, the plugin stops processing and warns to
reload; the same root path does not prove that the repository was not replaced.

If the host's session lookup fails during the first user prompt, the plugin
warns and retries that session without requiring another prompt. It retains at
most 128 pending session IDs and starts up to eight retries per five-second
poll. It does not start a second background lookup for an ID until the host's
underlying lookup settles, even if the host ignored cancellation. If 128
underlying retries never settle, later background retries cannot start; a
manual user prompt can attempt a fresh lookup. An initial lookup that never
settles can still leave the prompt hook waiting. When the pending-ID limit is
reached, the plugin warns and the affected session needs another user prompt.
Sessions are registered only after a successful lookup verifies that the
session is a root session in this directory. Messages sent before registration
are not retroactively addressed to it. A deletion event cancels pending retry
work, but missed events, moved sessions and reused session IDs remain subject
to the identity and event-order limitations below.

- `ctx.session.hook("prompt", ...)` registers root sessions receiving user input and establishes/restores their baselines.
- Registered sessions are checked every five seconds, with at most one check in flight per session. Delivery uses `ctx.session.prompt({ sessionID, id, text, delivery: "queue", metadata })`. Busy sessions queue; idle sessions start. Each event is submitted separately with a stable message ID derived from the worktree, session, and event ID. This can create more queued turns and model usage than combining a batch into one prompt. A receipt is written after each individual event is accepted.
- The [OpenCode plugin documentation](https://opencode.ai/v2/docs/build/plugins/) says retrying an ID already pending or delivered returns the original admission. This lets the adapter retry an uncertain response or failed receipt without creating another admission while the host retains that ID. A local OpenCode 2.1.2 test verified this for a pending queue item, not after model processing. Permanent deduplication and exactly-once agent work are not claimed.
- `metadata.source: "git-relay"` marks automatic messages. Both that and legacy `worktree-relay` sources are recognized, preventing recursive registration.
- `ctx.event.subscribe()` observes `session.deleted` and cancels in-flight checks, but **does not close the GitRelay subscription**. Later sends can still select that deleted session, and unread messages remain ineligible for GC. Inspect `git-relay sessions --cwd /absolute/worktree`, verify the session is no longer needed in the correct OpenCode data directory, then run `git-relay leave --cwd /absolute/worktree --agent opencode --session SESSION_ID`. `leave` prevents future targeting without acknowledging existing unread messages. The adapter resubscribes after an event-stream error or early end using a 1–60 second backoff; OpenCode exposes no replay cursor here, so events missed during disconnection or while the plugin is unloaded are not replayed. OpenCode can recreate a session using the same ID, and another OpenCode data directory can report a live session as not found; neither a delayed deletion event nor a host lookup failure alone safely identifies the session incarnation. Automatic deleted-session cleanup remains unresolved.
- **Avoid reusing an OpenCode session ID**, including across OpenCode data directories sharing the same GitRelay state. A recreated session at the same worktree and ref can receive the old session's unread GitRelay messages. Use a distinct native session ID for the replacement; verify and leave the old subscription separately. Leaving preserves its unread events rather than transferring them to the new session.
- The plugin does not enumerate historical sessions or enroll subagents. Before delivery, it checks the session's `location.directory` against `ctx.location.directory` rather than mapping other directories to this worktree. This check and host prompt admission are not atomic; a concurrent session move can occur between them.
- Shutdown cancels polling and waits for known in-flight scans, even if the host's hook disposal fails. The locally inspected 2.1.2 Promise adapter ignores cancellation options for `session.get` and `session.prompt`. GitRelay stops waiting for a pending read-only `get` after shutdown or session deletion, but the underlying host operation can still run. An in-flight `prompt` can already have been accepted, so GitRelay waits for it while holding the session lock; if it never settles, cleanup can remain pending. No bounded shutdown time or cancellation of a submitted prompt is guaranteed.

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

stdout carries data; stderr carries diagnostics. Watch errors, hook input warnings and fatal command errors are bounded and best effort: a blocked stderr can cause these diagnostics to be dropped or truncated, and a completed command waits at most 250 ms for pending stderr before exiting. **Successful output is not completed agent work.** The CLI writes and acknowledges each event separately; a later failed write leaves earlier receipts intact. Custom hosts use `consumeMailbox({ deliver })`, acknowledging after successful return; `return false` means only queued, not durably accepted. `consumeChanges` remains upstream-only. Node hosts import built `dist/core/consumer.js`. A crash between delivery and receipt persistence can redeliver; deduplicate by event ID. See [shared messages](shared-messages.md).

## Refs and remote changes

The default monitored ref is local `refs/heads/main`. CLI/hooks/OpenCode accept `WORKTREE_MAIN_REF`; CLI also accepts `--ref`, for example `refs/remotes/origin/main`. In contrast, `status --branch` takes a short branch name such as `main`.

Existing check/watch, hooks, and daemon do not fetch, access the network, or install Git hooks. Remote-tracking refs need an external fetch before they reflect remote merges. Patch generation disables external diff and textconv programs.

## Local and GitHub branch monitoring

`git-relay status [--cwd PATH] [--branch NAME]` needs no session. `--github` queries through authenticated GitHub CLI. `--repo [HOST/]OWNER/REPO` overrides gh's inferred repository; use it explicitly for forks when appropriate. Queries target the same branch name. Each gh call has a 30-second timeout, honors SIGINT/SIGTERM, and disables login prompts. Missing gh, authentication, permission, or network errors remain explicit while preserving local results.

Output type is `worktree.branch-status`:

HEAD and dirty state are point-in-time observations, not an atomic snapshot. When Git's HEAD label is ambiguous, GitRelay rechecks the symbolic reference and commit; `dirty` still comes from the first status read. Concurrent changes, including a switch away and back, can remain undetected.

- `worktree`: current worktree `branch`, `commit`, and `dirty`, even when another branch is selected. Dirty follows Git's porcelain status, includes staged, unstaged, and untracked files that Git reports, excludes ignored files, and is a boolean rather than a file-content change stream. Git's submodule ignore settings can hide modifications inside a submodule, so a clean result does not establish that every submodule is clean.
- `local`: selected `ref`, `commit`, and `tracking`. Tracking has the upstream ref, cached commit, and `ahead`/`behind`. No upstream is null; a missing upstream ref retains its name with null commit/counts. A missing or unborn local target has null commit and can still be queried remotely.
- `github`: present only when enabled. Success contains repository URL, branch, commit, and `matchesLocal`. Missing branches have null commit; comparison is null when either side lacks a commit. Failure is `{ "error": "..." }`, not branch absence or sync success. Only a successful exact-ref match establishes existence.

`--watch` emits a full initial snapshot, then deduplicated changes. Local intervals default to 5000 ms with a 50–3600000 range; GitHub intervals default to 30000 ms with a 5000–3600000 range. Each interval begins after the round finishes; requests do not overlap. Sampling may miss transient states. One-shot GitHub errors exit 1; watch emits errors and retries, including a recovery snapshot. Local Git errors go to stderr and retry; stdout failures exit.

`--watch --session ID [--agent NAME]` broadcasts changes after the baseline as ordinary agent messages. Receivers must already be registered; the monitor itself does not subscribe. Initial/restart snapshots are not broadcast. There is no persistent status history while stopped, and crash/retry boundaries can duplicate broadcasts. Normally run one monitor per target. Status messages are untrusted data and cannot authorize code/history changes or bypass idle hook limitations.

Status messages share the 64 KiB serialized message limit. An oversized snapshot is shown locally but is not broadcast. If another broadcast error occurs, delivery may have completed; the monitor shows the status locally and does not automatically retry that same snapshot, so inspect the mailbox before retrying manually. Diagnostics go to stderr on a best-effort basis and may be lost if the stream is closed or blocked. These cases can leave recipients without an update; the monitor does not provide durable, exactly-once status delivery.

Watch diagnostic content is capped at 4,096 UTF-16 code units, with a marker appended when truncated. While stderr is backpressured, additional diagnostics, including distinct errors and broadcast-outcome warnings, can be dropped until it drains. This limit does not truncate status output. Synchronous terminal or file writes can still block.

Default GitHub queries neither update remote-tracking refs nor download objects. Fetch through an existing workflow for diffs and monitor the corresponding `refs/remotes/...` with check/watch. `--auto-sync` currently reports blocked and does not fetch. This feature does not merge PRs or monitor CI/review status.

## Automatic branch synchronization

Automatic branch synchronization is temporarily unavailable because concurrent checkout can redirect a merge to a different branch. `--auto-sync` returns `blocked` before fetching or changing the worktree. A one-shot invocation exits 1; watch continues monitoring without Git writes. The CLI can still write a requested `--output` file or publish status changes when `--session` is supplied. `--no-auto-sync` still selects read-only monitoring. Existing older processes continue running across upgrades and must be stopped in their own terminals. See [migration guidance](migration.md#monitoring-and-automatic-synchronization) for the manual alternative and its concurrency limits.

## State, recovery, and limitations

- Shared state uses `worktree-agent-sync/repos/<repo-id>/`, with `XDG_STATE_HOME` / `WORKTREE_SYNC_STATE_DIR` overrides. Events are repository-wide; receipts are per session. Repository identity combines the canonical Git common-directory path with a persistent marker, or an explicit mapping for a read-only directory. Earlier path-keyed shared state needs an explicit migration or fresh-state choice; [see the migration procedure](migration.md#repository-identity-and-existing-state). Legacy Git-directory cursors are imported read-only.
- Session locks prevent concurrent duplicate delivery; active contention skips a round. Publication locks retry with jitter for up to five seconds. Lock age does not prove a stalled holder. CLI operations honor SIGINT/SIGTERM and release locks, including under output backpressure; watch exits on EPIPE rather than retrying indefinitely. SIGKILL/power loss can leave locks. Verify ownership before removing one; PID reuse cannot be resolved by a PID file alone.
- Related-history reset/force-push updates are marked rewritten and compared as snapshots. If Git cannot compare the range, GitRelay reports its ref and commit IDs and retains the unread event: an error or a `cat-file` missing result can also reflect an inaccessible object store. Unlike earlier versions, newly uninspectable ranges are not automatically acknowledged as `unavailable: true`; such a range may block later messages in that session. [History-gap recovery](migration.md#history-gap-recovery) explains how to inspect and restore trusted history. Existing receipts are not revoked, and the legacy `unavailable` notification format remains readable.
- Detection includes ignored local filenames, file/directory prefix overlap, and `core.ignorecase`. Git can report an untracked nested repository as an opaque directory; its contents are treated as potentially overlapping. Every tracked submodule path is also treated as a potential overlap, even when clean or uninitialized, because Git can hide its local contents. This can produce extra notifications. Older versions could incorrectly mark nested-repository or submodule events irrelevant; existing receipts are not revoked or replayed by this fix. Ignored file contents are not sent. A user's `diff.submodule` setting can cause committed submodule changes to appear in a bounded upstream diff. Large ignored trees and index scans can slow enumeration; Git output-limit failures retain unread events. Detection reflects current local files, not future edits. Cross-file semantic dependencies and cross-machine worktrees are outside scope.
- Changes before registration are not replayed. `irrelevant` events are not redelivered if the session later edits the file. New sessions do not receive earlier broadcasts.
- Automatic wake-up consumes model quota. Transport does not prove completed adaptation. Notification adapters do not mutate, stash, merge, rebase, or commit code; status auto-sync is temporarily blocked before writes. GC retains unread messages and closed markers, with no lastSeen expiry. See [maintenance](maintenance.md).

## Official interface references

- [pi extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)
- [Claude Code hooks](https://code.claude.com/docs/en/hooks)
- [Codex hooks](https://developers.openai.com/codex/hooks)
- [Codex App Server](https://developers.openai.com/codex/app-server)
- [Cursor hooks](https://cursor.com/docs/agent/hooks)
- [OpenCode v2 Promise plugins](https://opencode.ai/v2/docs/build/plugins/) / [client](https://opencode.ai/v2/docs/build/client/)

See the [platform matrix](platform-matrix.md) and [acceptance](acceptance.md) for tested boundaries. Local model interactions covered pi `1.4.0`, Codex CLI `0.164.0`, Claude Code `2.1.310`, and OpenCode `2.1.2`. Other versions and Cursor still need verification. pi's optional `*` peer follows its packaging convention, not a claim that all versions were tested.
