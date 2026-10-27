---
name: git-relay-sync
description: Explain the temporary GitRelay automatic synchronization limitation and how to stop older sync monitors.
---

# GitRelay Sync

Resolve `../../dist/cli/main.js` relative to this skill directory. Run it with Node from the target worktree, not from the plugin directory.

Automatic synchronization is temporarily unavailable: `--auto-sync` reports blocked without fetching or updating the worktree. Read status only, explain the limitation, and follow the manual guidance in [migration](../../docs/migration.md#monitoring-and-automatic-synchronization) if the user authorizes manual synchronization.

Manual Git commands also race with concurrent checkout or other Git writers. Stop concurrent operations and verify the branch and upstream before acting.

Inspect `sync.state` and `reason`. Preserve dirty files and diverged commits; do not bypass the blocker with reset, stash or rebase.

To disable an existing monitor, stop the specific process started for this task using its retained process handle. Optionally restart with `status --watch --no-auto-sync --format markdown`. Starting a second read-only monitor, `leave`, or stopping the mailbox daemon does not disable the original sync process. Do not kill a PID inferred only from an old file; if ownership cannot be established, explain which terminal/process must be stopped.

The switch is per invocation and is not persisted. See [maintenance](../../docs/maintenance.md) for shutdown behavior and [integrations](../../docs/integrations.md#automatic-branch-synchronization) for supported states.
