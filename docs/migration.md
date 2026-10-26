# Migrating to GitRelay

GitRelay covers branch monitoring, worktree coordination, and optional fast-forward synchronization.

| Identity | Current value | Compatibility |
| --- | --- | --- |
| Project | GitRelay | Formerly Worktree Relay |
| GitHub repository | `shenyankm/GitRelay` | Existing repository renamed in place |
| npm package / primary CLI | `git-relay` | CLI aliases `worktree-relay` and `worktree-sync` remain |
| Codex plugin | `git-relay@git-relay-local` | Reinstall under the new identity |
| pi command | `/worktree` | Unchanged |

## Update the checkout and CLI

For an existing checkout of this repository:

```sh
git remote set-url origin https://github.com/shenyankm/GitRelay.git
npm ci --ignore-scripts
npm run build
npm install -g .
git-relay --help
```

These instructions install from source; they do not assume an npm registry release. Node.js 22.19+ and Git are required. GitHub queries additionally require authenticated `gh`. Changing the remote URL does not fetch, synchronize branches, or publish local changes.

Update integration entrypoints and commands to `git-relay`. Remove duplicate old OpenCode entrypoints before restarting the host. The plugin emits `metadata.source: "git-relay"` and recognizes both that and the legacy `worktree-relay` source to avoid recursive registration during upgrades.

## Update the Codex plugin

Use a Codex CLI with plugin and lifecycle-hook support:

```sh
npm ci --ignore-scripts
npm run build:codex-plugin
codex plugin marketplace add /absolute/path/to/GitRelay --json
codex plugin add git-relay@git-relay-local --json
codex plugin list --json
```

After confirming the new plugin is installed, remove the old `worktree-relay` plugin if present, using the exact installed identity shown by `codex plugin list`. Disable duplicate manually configured hooks. Reopen the chat and inspect `/hooks`; installation does not grant hook trust. Review and trust hooks through Codex's normal flow.

After changing bundled code, documentation, or skills, rebuild and repeat `codex plugin add git-relay@git-relay-local --json` to refresh the installed copy. CLI installation/enabled status and actual App rendering are separate checks. See [integration details](integrations.md#codex-app-status-and-actions).

## Keep existing state

The following remain unchanged:

- `~/.local/state/worktree-agent-sync`, `XDG_STATE_HOME`, and `WORKTREE_SYNC_STATE_DIR`.
- `WORKTREE_SYNC_*`, `WORKTREE_MAIN_REF`, session IDs, and event types such as `worktree.upstream-change`.
- Existing receipts, unread messages, subscriptions, and `/worktree` commands.

Do not delete state to complete the rename. Repository identity depends on the canonical absolute Git common-directory path, and session identity includes the worktree path. Renaming the GitHub repository is independent of moving a local checkout; moving local directories can change those identities. A checkout may keep its old directory name.

Historical acceptance paths, package names, hashes, and measurements remain in [acceptance](acceptance.md) and [performance](performance.md). They are evidence from those runs, not newly executed checks.

## Monitoring and automatic synchronization

`watch` receives coordination events. `daemon` centralizes monitored-ref checks and acknowledged-event cleanup. `status --watch` independently monitors branch state. None enables automatic synchronization by default.

`status --watch --auto-sync` explicitly enables fetch and fast-forward updates from the configured upstream. Stop that process with Ctrl+C to disable it, then restart with `--no-auto-sync` if read-only monitoring is wanted. Starting a second read-only process, stopping the daemon, or leaving a message subscription does not stop an existing synchronization process.

See [maintenance](maintenance.md) for subscription and cleanup procedures. Repository renaming alone does not commit, push, publish, or release the updated package.
