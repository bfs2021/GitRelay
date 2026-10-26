# GitRelay: User-level shared message storage

All adapters use the same platform-independent message layer. CLI, hooks, and OpenCode no longer keep separate state inside their Git directories.

## Storage and isolation

The default is `~/.local/state/worktree-agent-sync`, or `$XDG_STATE_HOME/worktree-agent-sync` when `XDG_STATE_HOME` is absolute. An absolute `WORKTREE_SYNC_STATE_DIR` overrides the entire state root. All participants must use the same root.

```text
<state-root>/repos/<repo-id>/
├── repo.json                    # Canonical Git common directory
├── publish.lock                 # Short exclusive publication/registration lock
├── refs/<ref-key>.json           # Position of each monitored ref
├── sessions/<session-key>.json   # Adapter, native ID, worktree, subscription, lastSeen
├── sessions/<session-key>.lock   # Per-session consumption lock
├── events/<event-id>.json        # One shared copy of each event
├── trash/                       # Recovery journal for approved deletions
└── receipts/<session-key>/
    └── <event-id>.json           # Independent delivery/irrelevance receipt
```

- `repo-id` is the SHA-256 of the canonical absolute `git rev-parse --git-common-dir` path. Worktrees of one repository share events; independent clones do not, even with the same remote or repository name.
- Session keys combine the real worktree path, monitored ref, adapter, and native session ID. Identical IDs on different platforms do not consume each other's messages; subscriptions to different refs are independent.
- Hooks with a nonempty `agent_id` return an empty response. Short-lived subagents do not register subscriptions or consume their parent's inbox; the parent receives messages at its next hook.
- Directories are created with mode `0700`, JSON files with `0600`. Messages stay outside version control. Windows permissions still depend on system ACLs.
- This is local cooperation by one OS user, not a sandbox against malicious processes under that user or a cross-user/cross-machine service.

## Event types

### Automatic upstream changes

When a receiver detects a monitored-ref update, it publishes one shared commit-range event under the repository lock, then advances the repository cursor. Repeated polling does not republish it. If a range recurs after a reset, the preceding event ID distinguishes the new occurrence.

Each recipient computes its own file overlap and diff. Events store commit pointers; delivery reads Git objects instead of copying every worktree's diff into shared storage.

Sessions with no relevant local changes record an `irrelevant` receipt without waking the agent. New sessions establish a baseline at the current monitored branch and do not receive earlier history. Registered offline sessions retain their eligibility and catch up on return.

### Explicit cross-agent messages

Register recipients through their native receiver, a hook, or one `check` before sending from another worktree:

```sh
# List registered sessions. lastSeen does not guarantee that they are online.
git-relay sessions --cwd /project/worktree-A

# Send to other registered sessions in this repository.
git-relay send --cwd /project/worktree-A \
  --agent claude-code --session claude-session-A \
  --message 'The configuration interface changed. Check implementations that depend on it.'

# Match only sessions modifying these files. --file is repeatable.
git-relay send --cwd /project/worktree-A \
  --agent claude-code --session claude-session-A \
  --file src/config.ts --file src/types.ts \
  --message 'The interfaces in these files changed. Assess whether your task needs adaptation.'
```

Without `--file`, messages target other registered sessions in the repository. With files, matching happens **at receive time**, against committed, staged, unstaged, untracked, and ignored worktree changes relative to the live monitored ref. Matching includes file/directory prefix overlap and follows Git `core.ignorecase`. The sending session does not receive its own message; other sessions in the same worktree can.

`send` only publishes; it does not create or refresh the sender's receiving subscription. One-time senders do not become future broadcast recipients. Use a receiver, `check`, or `join` to subscribe. A previously closed sender must explicitly `join` before sending.

The response is `{ "eventId": "...", "recipients": 2 }`. The count is the publication-time candidate count, not confirmed delivery. Filtering, offline sessions, and host capabilities can delay or prevent delivery. `recipients: 0` means no other sessions were registered then; later subscribers do not receive that message.

Text must be nonempty and at most 64 KiB; text plus the file list also has a 64 KiB limit. Files must be repository-relative file paths: no absolute paths, directories, or `..` traversal. Existing directories are rejected even without a trailing slash. Deleted or renamed paths and files present only in other worktrees are allowed; a regular file at a sender-side prefix does not invalidate an otherwise valid target.

Historical directory-style paths remain readable and eligible for normal GC. Without file overlap they receive `irrelevant`, rather than becoming broadcasts or blocking the inbox. `./src/config.ts` and `src//config.ts` normalize to `src/config.ts` before deduplication and matching, including retained events. Backslashes are separators on Windows and filename characters on Unix. Existing `irrelevant` receipts are not revoked by upgrades; previously missed messages must be republished. Message text is agent data and grants no task or Git permissions.

## Receiving and receipts

Native adapters and hooks receive both event types. Manual integration:

```sh
git-relay check --cwd /project/worktree-B --agent codex --session codex-session-B
git-relay watch --cwd /project/worktree-B --agent codex --session codex-session-B
```

Use the host's adapter name and stable session ID. The default CLI adapter is `cli`; omitting `--agent` creates an independent CLI consumer rather than using a native agent's identity.

CLI output is NDJSON: `worktree.upstream-change` for upstream changes and `worktree.agent-message` for explicit messages. A check can output multiple lines; empty stdout means no delivery this time.

Every consumer has independent receipts. B receiving an event neither deletes it nor changes C's consumption. Receipt states are:

- `delivered`: accepted by the adapter, not proof that the model completed adaptation.
- `irrelevant`: no relevant file overlap at the time of checking.

Unreadable required Git objects produce an explicit history-unavailable notification with `unavailable: true`. Its empty file list does not mean no impact. A `delivered` receipt is written only after the host accepts the diagnostic; failure or queueing retains the event. Later messages and new upstream ranges remain consumable. An unavailable Git executable, corrupt state, or intact commits without a common ancestor still produce errors rather than pretending to be history gaps.

pi acknowledges only after the message appears in session history, not merely after follow-up queueing. Other adapters acknowledge successful host calls or completed hook/CLI output. A host crash before reading hook output may still lose model-level delivery; this is not exactly-once processing.

A batch contains at most eight events and targets roughly 64K characters. A single larger event can occupy a batch to allow progress. Unsent events remain for the next check. Failure or cancellation writes no successful receipt; a crash after sending but before receipt persistence can cause redelivery.

## SDK integration

Node hosts import built JavaScript:

```js
import { consumeMailbox } from './dist/core/consumer.js';
import { sendMessage, formatNotifications } from './dist/core/mailbox.js';

await consumeMailbox({
  cwd: '/project/worktree-B',
  ref: 'refs/heads/main',
  adapter: 'my-agent',
  session: 'stable-native-session-id',
  async deliver(notifications) {
    await host.acceptMessage(formatNotifications(notifications));
    // Returning acknowledges; throw on failure or return false if only queued.
  },
});
```

`signal` cancels Git checks and lock waits; sending, join/leave, and GC also support cancellation. Repository publication locks retry with jitter for up to five seconds, then report the lock path and PID rather than silently skipping. An active per-session consumption lock skips that round to prevent duplicate delivery. Lock age does not prove a stalled owner; locks are not stolen.

`isDelivered(eventId)` lets hosts with durable history confirm previous acceptance on retry. `consumeChanges({ deliver })` remains an upstream-only compatibility API and does not acknowledge explicit messages.

## Legacy state migration and maintenance

- Legacy `<git-common-dir>/worktree-agent-sync/<key>.json` cursors are imported read-only into session-specific catch-up events. Source files are not deleted or overwritten.
- pi imports positions from old `worktree-watch-state` entries and change messages. New receipts use native session IDs and do not roll back with tree navigation in the same session.
- Upgrades do not delete or close old subscriptions. Old send-only identities or `parent-session/agent_id` subagent identities may have left stale registrations. Inspect `sessions` first. Explicit `leave` prevents future delivery while retaining unread events. To acknowledge old messages, pause other publishers/receivers, repeatedly `check` with the matching `--cwd`, `--agent`, and `--session`, review output until empty, then `leave` and use normal GC. Closed identities need `join` first. Do not automatically retire genuinely offline sessions.
- A killed process may leave a `.lock`. Confirm the owner has exited before removing only that lock, never its events or receipts. Locks possibly held by live processes are not stolen.
- `leave` stops future subscriptions; `join` resumes them. Leaving does not acknowledge messages. `gc` previews by default and only collects fully acknowledged events past retention. The optional daemon runs GC at startup and hourly. There is no offline TTL; `lastSeen` is diagnostic. See [maintenance](maintenance.md).
- Polling scans retained event and session receipt filenames, validates receipts first, and loads only unacknowledged event bodies, with up to 32 concurrent reads per batch. Delivery remains ordered by timestamp and ID. Corrupt receipts fail rather than count as read. That session no longer validates acknowledged event bodies during polling, but GC validates all events. No cache, index, or state migration was added. Safe periodic cleanup reduces scanning. Before clearing state, stop the daemon and all participants and back it up; clearing loses pending messages and deduplication records.
- Shared storage does not bypass host delivery limits. Claude Code/Codex/Cursor hooks cannot wake an already idle session; pi/OpenCode polling can. Local cancellation cannot retract a request already accepted by a remote host.
