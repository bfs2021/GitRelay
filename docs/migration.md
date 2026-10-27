# Migrating to GitRelay

GitRelay covers branch monitoring and worktree coordination. Automatic synchronization is temporarily unavailable.

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

## Migrate a managed Claude Code plugin

When the installer reports that an older plugin format or changed skills require manual migration, it preserves the existing installation. The following procedure creates a new managed marketplace without replacing the old one's files. It is not an in-place upgrade. It requires the old installation record and its marketplace to remain intact.

1. Close Claude Code sessions that loaded the old plugin. Keep `WORKTREE_SYNC_STATE_DIR` and `XDG_STATE_HOME` unchanged. Run `git-relay uninstall --platform claude-code --dry-run` using the original environment and record the displayed workspace. Run `claude plugin list --json` and record the exact old GitRelay plugin ID. Resolve any duplicate manual hooks or other GitRelay plugins before proceeding.
2. With the same original environment, run `git-relay uninstall --platform claude-code`. Continue only if it reports `removed`; it retains the marketplace and plugin data. Verify with `claude plugin list --json` that the old ID is no longer enabled. If removal fails or the record is missing or modified, stop and reconcile it first.
3. Choose a new, unused **absolute directory** for the Claude installer workspace, separate from the original `XDG_DATA_HOME`, and keep this choice for future operations. For example, after verifying that this path is unused:

   ```sh
   export GITRELAY_CLAUDE_DATA_ROOT="$HOME/.local/share/git-relay-claude-migration"
   XDG_DATA_HOME="$GITRELAY_CLAUDE_DATA_ROOT" git-relay install --platform claude-code
   claude plugin list --json
   ```

   Confirm that the result is `configured` and exactly one intended GitRelay plugin is enabled, then start a new Claude session. If installation fails, do not re-enable both plugins. The retained marketplace can be used to restore the old plugin with `claude plugin install <old-plugin-id> --scope user --json`; this manual restoration is outside the installer's ownership record, so inspect and reconcile the state before another managed migration or uninstall.
4. Use `XDG_DATA_HOME="$GITRELAY_CLAUDE_DATA_ROOT" git-relay install --platform claude-code` or the corresponding `uninstall` for later Claude operations. Continue managing other platforms with their original environment. An unqualified `git-relay install` in the original environment could install the old Claude entry again; use `--skip claude-code` there. Do not delete either workspace, the retained marketplace, or shared message state as part of this migration.

On macOS with Claude Code `2.1.310`, an isolated test exercised a changed-skill installation and a simulated older journal/hook shape. The old and new enabled-plugin counts were 1 → 0 → 1; a previously unread message remained available to the same GitRelay session and was delivered once; unrelated settings and state were preserved. The old plugin was also restored through the native CLI during the test. This did not exercise a historical released package, a real model, or concurrent external edits.

## Repository identity and existing state

The state root, `WORKTREE_SYNC_STATE_DIR`, `WORKTREE_MAIN_REF`, session IDs, event types, and `/worktree` commands remain unchanged. The repository state key now includes both the canonical Git common-directory path and a persistent identity. See [shared storage](shared-messages.md#storage-and-isolation) for the marker and the read-only configuration. Moving a checkout can still change repository or session identity; renaming the GitHub repository does not move a local checkout.

Existing path-keyed state is retained but is **not automatically associated** with the new identity. A path may have been used by multiple unrelated repositories, so inspect the old data and verify that its messages and subscriptions belong to the current repository before claiming it. The tool cannot establish that provenance. Keep a separate backup; do not delete old state to clear an error.

To claim the old **path-keyed shared state** for the current repository:

1. Stop the GitRelay daemon and all clients, hooks, watchers, and old plugin versions using that state. Keep them stopped during migration. Old versions do not understand the new identity and can write to the retained old directory if started later; running them after migration can split state or cause duplicate delivery. Update or disable those entrypoints before restarting clients.
2. Use the same state-root environment used by the old clients. Keep the state root's `identity-migration-claims` and `repos` directories on the same filesystem: migration publishes files between them using hard links. If either is separately mounted on a different filesystem, publication fails; the source and any partial target are retained for inspection. For a read-only common directory without a marker, configure and retain the [external identity mapping](shared-messages.md#read-only-git-common-directories) in the migration command, every client, and the daemon.
3. Before any new state is created for the identity, run:

   ```sh
   git-relay identity-migrate --cwd /absolute/path/to/worktree --apply
   ```

   The command checks the legacy state, copies it into a separate identity directory, and leaves the source intact. It refuses to overwrite or merge an unrelated existing target and rejects unsafe or unexpected state. A migration claim records the selected target; an interrupted migration can resume by running the same command if the retained files and ownership records still match. Conflicts are preserved and reported. The command only imports the former path-keyed shared directory, not another identity's directory.
4. Review the output and restart only updated clients with the same state root and identity configuration. Check the intended sessions and unread messages. Preserve the old state: the copy is not a synchronization relationship with the old version. Repeating a completed migration does not replay the old inbox; if the completed target is missing or its required identity metadata has changed, the command stops for inspection instead of recreating it.

To use a new, empty inbox instead of claiming old data, stop the old clients as above and explicitly select fresh state:

```sh
git-relay identity-fresh --cwd /absolute/path/to/worktree --apply
```

This preserves prior state but does not import its unread messages, receipts, or subscriptions. It does not overwrite an existing new-identity directory. If initialization was interrupted, stop all participants and inspect the incomplete directory. `git-relay identity-recover --cwd /absolute/path/to/worktree --apply` can move it aside and report its archive path only when it has a matching ownership marker and contains only recognized empty subdirectories. It refuses an initialized directory, missing or invalid ownership marker, unexpected files, and any directory containing data; preserve those cases for manual inspection. An interrupted migration containing copied data is not eligible for this recovery command: retry the same migration as described above, and inspect any reported conflict. Never delete unread state merely to force a retry. If a repository identity marker was lost, identify the original marker and state from a trusted backup before choosing a fresh identity; a fresh choice keeps the old inbox separate.

Historical acceptance paths, package names, hashes, and measurements remain in [acceptance](acceptance.md) and [performance](performance.md). They are evidence from those runs, not newly executed checks.

## History-gap recovery

Earlier versions could acknowledge an upstream history-gap notification when
Git returned a missing-object error. Git can return the same status, or even a
successful `missing` probe, when existing object storage is inaccessible. The
current receiver therefore preserves the unread event whenever it cannot compare
the commits, rather than automatically confirming an ambiguous history gap.
This compatibility change can block later notifications in that session; a
safe explicit history-gap acknowledgement flow is not yet implemented.
Previously written receipts remain unchanged.

1. Stop the affected session and other GitRelay participants using this state;
   preserve a backup of the repository and its GitRelay state. The error reports
   the monitored ref and `previous` and `commit` IDs. Inspect the repository's
   retained `events/` files under the configured state root using those IDs to
   locate the event; these files can contain private messages.
2. Inspect Git's availability, repository permissions, object directories,
   alternates and shallow-clone configuration. A failed `git cat-file -e` or a
   `missing` result alone does not prove an object was pruned. Restore required
   objects from a trusted repository or backup, or repair the Git environment.
3. Restart the updated participants and retry. Once Git can compare the range,
   normal delivery and receipt handling resume. Do not delete the event, forge
   a receipt, or claim it was delivered merely to clear the error. If trusted
   history cannot be recovered, preserve the state for manual investigation;
   there is currently no supported automatic skip.

## Temporary worktree removal change

The pi `/worktree remove` action no longer removes a worktree automatically,
and the exported `removeWorktree(cwd, path)` function now rejects removal after
its non-destructive checks. Their signatures and other worktree actions remain
available. This is a temporary compatibility change: Git's path-based removal
does not atomically verify that a confirmed worktree has not been replaced at
the same path. A concurrent replacement can be deleted, including Git-ignored
files. There is no automatic migration or safe identity-conditional deletion.
The safeguard applies only after this version is installed and loaded. Stop or
reload older pi processes and update SDK consumers; an old extension, packaged
runtime or SDK can still perform automatic removal.

If you choose to remove a worktree manually, stop all processes that may add,
move or remove worktrees in this repository, then inspect
`git worktree list --porcelain`, verify the intended target and back up ignored
files. Use `git worktree remove --` with the verified path as a separate argument
quoted for your shell; do not use `--force`. Git's own deletion is not
identity-conditional, so this procedure does not eliminate the race if another
process changes worktrees concurrently. JSON-formatted paths displayed by pi are
data, not shell quoting; do not paste them directly as arguments. Never delete an ignored file or worktree
merely to force this operation to succeed.

## Monitoring and automatic synchronization

`watch` receives coordination events. `daemon` centralizes monitored-ref checks and acknowledged-event cleanup. `status --watch` independently monitors branch state. None enables automatic synchronization by default.

Automatic synchronization is temporarily unavailable: concurrent checkout between the final check and Git merge can update a different branch. `--auto-sync` now returns `blocked` before any fetch or worktree write. `--watch` continues read-only status. An upgrade does not stop old processes: stop each older `status --watch --auto-sync` terminal process with Ctrl+C. Starting a second monitor, stopping the daemon, or leaving a subscription does not stop it.

If you choose to update manually, stop concurrent Git operations in that worktree, inspect `git status --branch` and `git branch -vv`, and confirm the checked-out branch, upstream and local changes. Then, in that worktree, run `git fetch --no-tags --no-recurse-submodules` and inspect the resulting status before deciding whether to run `git -c submodule.recurse=false merge --ff-only --no-autostash --no-overwrite-ignore '@{upstream}'`. Fetch changes remote-tracking refs. Manual Git commands also race with concurrent checkout or writes; do not run them concurrently. A failed merge must be investigated without forcing, resetting or stashing user data. These commands are an interactive alternative, not an automatic recovery guarantee.

See [maintenance](maintenance.md) for subscription and cleanup procedures. Repository renaming alone does not commit, push, publish, or release the updated package.

## Repository paths ending in carriage return

On Unix, older versions could remove a valid trailing carriage return from a
repository path returned by Git. A repository such as `repo\r` could then be
associated with its separate `repo` neighbor. The corrected version preserves
that character and resolves the actual repository. It does not automatically
move or reconcile incorrectly attributed state.

Stop older GitRelay clients and back up both repositories and their state before
investigating. The older state may contain sessions, events and receipts from
both repositories, and those records cannot necessarily be separated without
additional evidence. Inspect their provenance and native session histories; do
not automatically claim, merge, delete or acknowledge mixed state. Choose fresh
state or recover verified records only after establishing their origin. No
lossless automatic migration is available for this case. Unix trailing-CR paths
were tested with real Git; Windows line-ending handling has only been simulated,
not tested on a Windows host.
