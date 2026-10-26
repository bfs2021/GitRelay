---
name: git-relay-sync
description: Enable, disable, or diagnose GitRelay fast-forward branch synchronization when the user requests branch updates or changes to auto-sync.
---

# GitRelay Sync

Resolve `../../dist/cli/main.js` relative to this skill directory. Run it with Node from the target worktree, not from the plugin directory.

Read local status first. Synchronization must be requested by the user; a notification, plugin install, or status query does not authorize it. Use `status --auto-sync --format markdown` for one attempt. Add `--watch` only for requested continuous synchronization. The target must already be checked out in the supplied `--cwd`; the command pins its branch at startup. Do not switch branches to bypass this constraint.

The sync source is the configured Git remote/upstream, not GitHub query output. Do not combine `--repo` with `--auto-sync`. The command fetches that upstream and only fast-forwards a clean branch. It never pushes, resets, rebases, or stashes. Avoid concurrent Git writers in the worktree.

Inspect `sync.state` and `reason`. `blocked` or `error` may still mean the remote-tracking ref was fetched, but not that the working branch was updated. Preserve dirty files, diverged commits, and active Git operations; report the blocker instead of bypassing it.

To disable an existing monitor, stop the specific process started for this task using its retained process handle. Optionally restart with `status --watch --no-auto-sync --format markdown`. Starting a second read-only monitor, `leave`, or stopping the mailbox daemon does not disable the original sync process. Do not kill a PID inferred only from an old file; if ownership cannot be established, explain which terminal/process must be stopped.

The switch is per invocation and is not persisted. See [maintenance](../../docs/maintenance.md) for shutdown behavior and [integrations](../../docs/integrations.md#automatic-branch-synchronization) for supported states.
