# GitRelay: Session exit, safe cleanup, and the optional daemon

These features share the existing user-level message store. Plugins, hooks, and manual cleanup work without a daemon.

## Stopping monitoring and synchronization

`git-relay daemon` serves registered message subscriptions; `git-relay status --watch` is a separate branch-monitoring process. Stopping the daemon or running `leave` does not stop a status monitor or auto-sync process in another terminal.

To disable synchronization, press Ctrl+C in the terminal running `status --watch --auto-sync`, then restart with `status --watch --no-auto-sync` if needed. The switch is not persisted. Starting another read-only process does not stop the original writer. On `blocked` or `error`, inspect `sync.reason` and resolve local changes, divergence, active Git operations, or authentication problems before retrying; do not delete message state or force a reset.

Renaming or reinstalling the plugin does not clean up unread messages. See [migration](migration.md).

## 1. Explicitly leave subscriptions

```sh
git-relay leave --cwd /project/worktree-B --agent codex --session native-session-B
git-relay join  --cwd /project/worktree-B --agent codex --session native-session-B
git-relay sessions --cwd /project/worktree-B
```

pi also provides `/worktree leave` and `/worktree join`. Leaving stops its receiver before closing the subscription; a failed join/leave restores a previously enabled receiver.

- `leave` saves `closedAt`, excluding the session from future broadcasts and upstream events.
- Existing unread events, receipts, and baselines remain. **Leaving is not acknowledgement and does not make unread events eligible for cleanup.**
- Ordinary checks, hooks, and receiver restarts do not reopen closed sessions. Use `join` explicitly.
- Rejoining preserves the inbox and deduplication state, but does not backfill broadcasts not addressed to the session while it was closed.
- Leaving an unregistered session does not create a registration.
- Closing a terminal, reloading an extension, or going offline is not permanent departure. These lifecycle events do not automatically call `leave`, and `lastSeen` does not expire subscriptions.
- Messages already queued by the host may not be retractable. An active receiver lock makes leave return busy; retry rather than overriding the lock.

Commands identify a subscription by worktree, ref, adapter, and native session ID. Supply `--ref` for a nondefault branch. Handle the inbox and explicitly leave before deleting a worktree; deleting its directory does not acknowledge messages. After deletion, `leave --cwd` can use the original canonical absolute root path, but only when persistent state uniquely matches that path, ref, adapter, and session. Do not substitute the main worktree path.

The small `closedAt` tombstone remains so later polling cannot register the same closed ID as a new session. Other agents can use the CLI to leave at the user's request; host shutdown hooks are not automatically rewritten.

`send` does not establish a receiving subscription. Older send-only identities or `parent-session/agent_id` subagent registrations are not automatically deleted. Inspect `sessions`. To acknowledge their old unread events, pause other participants, repeatedly `check` and review output while subscribed, then `leave`; closed identities need `join` first. Only acknowledged messages can be collected. See [legacy migration](shared-messages.md#legacy-state-migration-and-maintenance).

## 2. Collect only acknowledged events

```sh
# Preview only. Default retention is seven days.
git-relay gc --cwd /project/worktree-A
git-relay gc --cwd /project/worktree-A --dry-run

# Apply after reviewing the preview.
git-relay gc --cwd /project/worktree-A --apply

# Explicitly collect acknowledged events immediately; unread messages remain.
git-relay gc --cwd /project/worktree-A --apply --retention-days 0
```

An event is eligible only when:

1. Every publication-time recipient has a valid `delivered` or `irrelevant` receipt.
2. Retention has elapsed since the **latest** event creation or acknowledgement timestamp. An old event just read by an offline session is not immediately deleted because of its age.
3. Every recipient's legacy migration is complete, preventing reimport of collected history.
4. Every recipient's consumption lock can be acquired, preventing receipt removal while a consumer still caches the event.

Reports contain `dryRun`, eligible event IDs in `eligible`, successful deletions in `removed`, and retained items in `kept` with reasons `unconfirmed`, `retention`, `migration`, or `busy`.

Closed/offline sessions and deleted worktrees do not replace acknowledgement. Missing receipts retain events; corrupt events or receipts fail rather than count as acknowledged. Events with no recipients can be collected after retention.

### Concurrency and interrupted cleanup

Cleanup shares the repository `publish.lock` with publication and acquires recipient locks per event. Receiving, sending, join/leave, and GC retry repository-lock contention with jitter for up to five seconds, then report the path and PID. GC does not wait for recipient locks: it marks the event busy and skips it, avoiding deadlock with consumers that lock the session before the repository. Lock age does not establish a stalled owner, and locks are not stolen.

Approved events move atomically from `events/` to `trash/` before their receipts and journal files are deleted. This move commits the deletion:

- Failure before the move retains the original event and receipts.
- Interruption afterward leaves only approved events in `trash/`; the next `gc --apply` completes deletion.
- Preview lists pending journal entries but does not delete them.
- Increasing retention later does not undo a committed deletion.

GC preserves ref cursors, registrations, closed markers, and legacy migration sources. Do not manually move unread events into `trash/` or edit events/receipts during cleanup.

## 3. Optional daemon

```sh
# One instance per user state root; runs in the foreground for supervision.
git-relay daemon

# Defaults: poll every 5000 ms and retain acknowledged events for seven days.
git-relay daemon --interval-ms 5000 --retention-days 7

git-relay daemon status
```

The daemon is not limited by the current `--cwd`. It discovers all registered repositories in the state root and monitors refs subscribed to by sessions that have not closed.

- Each repository/ref is checked once per round without creating synthetic recipients.
- Clients use cached ref positions only with a matching daemon lock/process, fresh heartbeat, and fresh successful ref check. File-scoped message relevance still resolves the live ref so stale caches do not misclassify integrated changes.
- New sessions and missing/stale ref caches perform their own checks to establish the correct baseline. An active session lock skips a receiving round; repository locks wait up to five seconds. Empty stdout does not prove registration; use `join` and `sessions` to confirm.
- Missing daemons, stale heartbeats, or repeatedly failed ref checks fall back to client-side checking.
- One bad repository or subscription does not block others. A missing common directory produces one `daemon.repository-missing` report per missing episode in each run; monitoring resumes when it returns. Maintenance still collects eligible events while preserving unread events, sessions, and repository directories.
- GC runs at startup and **hourly**, with the same retention and safety rules. Busy items remain for later maintenance or manual GC.
- The daemon does not fetch, answer messages, or call models. Host adapters still determine local relevance, inject messages, and write receipts.

### Background operation and shutdown

On macOS/Linux, use an existing service manager or explicitly start it from a shell:

```sh
umask 077
nohup git-relay daemon > "$HOME/git-relay-daemon.log" 2>&1 &
daemon_pid=$!
# Use the process handle from this launcher, not an unverified old PID file.
kill -TERM "$daemon_pid"
```

All CLI commands install signal handlers before operating. Ctrl+C/SIGTERM cancels lock waits and Git checks, then waits for acquired locks to be released in cleanup. The daemon also clears its own heartbeat and process lock. Incomplete stdout writes can be canceled without acknowledging messages. Diagnostics are emitted outside publication locks, so blocked output does not prevent clients checking after caches expire. Shutdown finishes state cleanup without waiting for blocked stdout; final diagnostics may be truncated. Output-pipe failure also cleans up resources. A conflicting second instance cannot remove the first instance's lock or heartbeat.

No launchd/systemd/Windows service is installed, no automatic detachment occurs, and no stop command blindly kills a PID read from disk. Windows can run the daemon in the foreground or under a user-chosen service manager. Normal operation does not require a daemon, and it never starts automatically.

### Files and recovery

```text
<state-root>/daemon.lock     # Singleton lock with PID and instance token
<state-root>/daemon.json     # Heartbeat, instance token, polling interval
<repo-store>/trash/          # Journal for approved deletions
```

Heartbeat freshness is `max(15 seconds, 3 × interval-ms)`; successful recent checks of the particular ref are also required. `daemon status` is a local liveness hint, not process authentication or proof that a host session is online.

SIGKILL or power loss can leave locks. Confirm the original relay operation exited before removing only its `.lock`. PID files cannot reliably distinguish PID reuse or suspended processes. Lock timeouts report paths and PIDs without recommending removal of occupied locks; even a healthy daemon lock older than 60 seconds remains busy. Nonregular lock files, including dangling symlinks, fail immediately. Dead-PID diagnostics and release both recheck lock identity; never replace locks while participants are running. Upgrade and reload all participating CLIs/plugins to versions supporting the current state fields.

## Acceptance

See [acceptance records](acceptance.md). Automated maintenance tests use temporary repositories, isolated state, and real CLI subprocesses; they do not modify existing user messages or install services.
