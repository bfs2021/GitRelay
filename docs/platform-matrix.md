# Platform capability and verification matrix

This matrix describes the repository implementation and the scope of local
real-client checks. It is not a claim of complete lifecycle acceptance. See
[acceptance](acceptance.md) and its
[recorded results](acceptance-results.json) for the test procedure, build hashes and
limitations. A successful host delivery or receipt does not prove that the agent
completed the requested work.

**Implemented** means code exists, not that every lifecycle or failure case has
been verified on a real host. Model checks refer only to the versions and source
snapshots in the acceptance record; they do not automatically verify subsequent
changes. **Not established** means the minimum version or required end-to-end
evidence is not yet established.

Automatic branch synchronization is temporarily disabled on every platform:
a concurrent branch checkout can otherwise cause a fast-forward to update the
wrong branch. Status monitoring remains available; explicit output and session
options can still write their requested files or events. Automatic worktree
removal is also disabled pending an identity-safe implementation.

| Capability | Codex | Claude Code | pi | OpenCode |
| --- | --- | --- | --- | --- |
| Entry point | Lifecycle hooks or packaged plugin; implemented | Lifecycle hooks; implemented | Native extension and skill; implemented | v2 Promise plugin; implemented. v1 API is not supported |
| Installation | Managed user hooks only when no hooks file or GitRelay plugin exists; manual plugin registration also available; trust is separate | Managed native plugin or manual hook merge | Managed global extension and skill or manual `pi install` | Managed global entry or manual local entry |
| Client detection, selection and safe lifecycle | Managed hooks install/upgrade/uninstall on non-Windows; conflicts and previous plugin records are preserved; `/hooks` trust remains required | New stable-launcher installs support runtime upgrades with unchanged skills while the originally recorded Node executable remains compatible; legacy migration and skill changes are refused; host-reported plugin version stays unchanged | Managed install/upgrade/uninstall implemented on non-Windows systems with `ln -P`; real-host lifecycle acceptance remains partial | Detection, selection, managed install/upgrade/uninstall implemented; retained archives and real-host coverage have limits |
| Session registration and event detection | Implemented at supported hook boundaries | Supported hook sessions; nonempty `agent_id` calls, including in-process teammate calls carrying it, are skipped | Implemented in extension | Root sessions receiving a prompt; failed first lookups have bounded retries with local regression coverage; historical sessions are not enumerated |
| Delivery while active | Hook context or Stop continuation; implemented | Hook context or Stop continuation; implemented | Retains events until pi is idle, then starts a follow-up | Host durable queue; implemented |
| Already-idle wake-up | Hook-only integration waits for another hook | Hook-only integration waits for another hook | TUI/RPC polling can start a turn; print/JSON do not poll | Polling can start a turn |
| Restart and error recovery | Shared state and receipts implemented; complete real-host failure coverage not established | Same | Queue retries are covered by controlled tests; old pending native entries without a new delivery proof remain unread and require manual review | Same; real-host response-loss and restart windows need further validation |
| Historical model acceptance | Partial: 0.164.0, isolated user hooks and resumed session | Partial: 2.1.310, settings hooks and resumed session | Partial: 1.4.0, native extension and idle wake | Partial: 2.1.2, v2 plugin and idle wake |
| Later local model checks on earlier snapshots | Partial: 0.164.0, managed hooks, busy delivery and clean recovery; interactive user-level hook trust also exercised without bypass | Partial: 2.1.310, managed plugin, busy delivery and clean recovery | Partial: 1.4.0, managed extension, real-model message use and restart after an offline message through a buffered test proxy; busy, cross-client and repository isolation remained unverified on that snapshot | Partial: 2.1.2, managed plugin, busy delivery, idle wake and recovery |
| Latest fixed-source model acceptance (2026-10-27) | 0.164.0: normal interactive trust, upstream/message delivery, busy tool, offline resume, stable receipts | 2.1.310: managed native plugin, upstream/message delivery, busy tool, offline resume, stable receipts | 1.4.0: managed extension, idle wake, upstream/message delivery, busy tool, offline restart, stable receipts | 2.1.2: managed v2 plugin, idle wake, upstream/message delivery, busy tool, offline server restart, stable receipts |
| Cross-client host checks with local mock models | Received from pi via managed hook; one-time hook-trust bypass and mock HTTP 503 | Sent to OpenCode via the real Bash tool | Sent to Codex via the real Bash tool | Received from Claude via managed plugin |
| Minimum supported version | Not established | Not established | Not established; 0.78.1 is a necessary API floor | v2 API required; exact minimum not established |

The pi delivery-proof change has local regression coverage and fixed-source real-model idle, busy and clean-restart checks. Forced-termination and power-loss durability are not established. Its legacy
pending-record limitation and recovery boundary are described in the [pi
integration guide](integrations.md#pi).

Pi detection currently invokes its launcher even during install previews, and
pi installation invokes it again for runtime validation. Pi 1.4.0 reads settings
before `--version` returns; its managed launcher can also initiate its own
staging cleanup. The [setup guidance](integrations.md#automatic-setup) describes
how to skip pi. Read-only recognition across installation types is not established.

Codex and OpenCode launchers select a retained revision named in the captured installation record, so an interleaved runtime upgrade no longer makes a newer global marker invalidate that snapshot. Controlled regression tests cover this race and owned legacy-launcher replacement. Stop sessions during the first legacy-launcher migration: its short publication gap and already-running old code are not fenced. See the [installation guide](integrations.md#automatic-setup).

The latest real-model cross-client run used Claude Code and pi in two linked worktrees, sent both messages through their actual Bash tools, and checked both receiving model responses. A separate repository sharing the state root received neither message. This is one verified pair; all pairwise combinations, forced termination and permanent deduplication are not established. Earlier mock-host checks remain historical evidence only.

OpenCode deletion events cancel checks but do not close or retain a durable
deletion record for the GitRelay subscription. Reuse of a native session ID and
changes of repository or OpenCode data root make delayed deletion attribution
unsafe; manual `leave` is required after verifying the session. Event-stream
errors or early termination trigger resubscription, but missed events are not
replayed. Automatic deleted-session cleanup remains unimplemented.

The package declares optional peer ranges of `*` for pi and `^2.1.2` for
OpenCode; these are dependency constraints, not proof that all matching host
versions have been validated.

The pi extension relies on `ctx.mode` to start its watcher. This API was added
in [pi 0.78.1](https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/CHANGELOG.md),
so earlier stable releases are classified as incompatible. This necessary API
floor does not establish complete compatibility in 0.78.1 or later releases;
pre-releases remain unverified.

The historical run checked two independently marked events, model responses,
receipts and a subsequent normal deduplication check in isolated test
repositories. It did not establish complete busy-session, forced-termination,
cross-client collaboration, repository isolation, or install/upgrade/uninstall
acceptance for every platform. Controlled tests and CLI tests provide additional
evidence but do not substitute for those real-client scenarios. Different
repositories use separate state; worktrees of the same repository share events
with per-session receipts. The previous path-only identity could expose unread
messages to a replacement repository at the same path. Isolated tests of the new
persistent identity check that this case requires an explicit state choice and
does not expose the old event; the latest run includes real-model repository separation for the Claude/pi pair, not replacement recovery on every host. See [shared messages](shared-messages.md) for external-identity and
cleanup boundaries.

Codex and Claude Code hooks are synchronous integration points: they do not
independently wake an already idle session. Codex may spill large hook output to
a file and show a preview to the model, so a successful hook response alone does
not prove every item was read. OpenCode v2 and pi can wake idle sessions, but
the current acceptance record does not establish exactly-once delivery after a
host accepts a message and the relay fails before writing its receipt. Normal
operation deduplicates; crashes can cause redelivery. OpenCode assigns each event
a stable host message ID per receiving worktree and session, submitting each
event separately. This may create additional queued turns. Its documented
pending/delivered ID retry behavior reduces duplicate admissions; a local 2.1.2
test verified the pending case only, and does not establish permanent deduplication
or completed agent work.

Pi binds each inbox to its canonical native history file and creation timestamp; OpenCode binds it to the data root and native creation time. Recreated IDs therefore select separate inboxes. Both reject missing native metadata. Resumes retain their binding; old unbound inboxes remain intact for manual review. Manual CLI access must include the exact `--instance` from `sessions`. Neither native metadata checks nor prompt admission are atomic against unrelated host mutations. See [migration](migration.md#native-session-identity-upgrade).

Upstream publication chains and recognized legacy migration predecessors are consumed in causal order. An unconfirmed upstream range holds its successors, while independent messages rotate through a durable scheduling cursor. Historical unlinked records and existing receipts are not rewritten. Uninspectable history remains unread by default; `check --acknowledge-history-gap --apply` is an explicit operator recovery action.

Official interface references: [Codex hooks](https://developers.openai.com/codex/hooks),
[Claude Code hooks](https://code.claude.com/docs/en/hooks),
[pi extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md),
and [OpenCode v2 plugins](https://opencode.ai/v2/docs/build/plugins/).

OpenCode host message IDs include GitRelay repository identity, the receiving session key (including native instance), and event ID. Controlled regression tests cover repository replacement collisions. Host ID retention still determines the scope of host-level deduplication.
