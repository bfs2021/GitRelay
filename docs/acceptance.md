# GitRelay local acceptance records

The historical records below preserve the original command names, paths, measurements, and results from before the rename. Translating them does not constitute a new acceptance run.

## Fixed-source lifecycle completion (2026-10-27 UTC)

The latest run tests executable source commit `bc69a5285dfdf685ef62bb75395045e3f5fc68e3` from a `git archive` snapshot. Its tracked source was compared byte-for-byte with that commit after the runs; SHA-256 values for all 108 source/build/vendor/script files are recorded in `acceptance-results.json` under `latestRun`. Later edits update documentation and bundled skill guidance only. Earlier records below remain historical and their unresolved findings must be read with this update.

On macOS arm64 (27.0.1), Node 22.23.2 and Git 2.54.0, the fixed snapshot passed `npm run typecheck`, build, and `npm test`: **647 tests, 631 passed, 0 failed, 0 cancelled, 1 skipped, 15 TODO**. The skip is the Windows-specific Codex installer test; all TODOs concern intentionally disabled automatic synchronization or worktree removal. `npm pack --dry-run --ignore-scripts` also passed. Dependencies were reused from the existing checkout; no fresh `npm ci` was performed for this local run. Hosted CI is separate.

| Real client | Tested entry | Real-model observations |
| --- | --- | --- |
| Codex 0.164.0 | Managed user hooks, normal interactive review and trust; no trust bypass | Upstream and explicit markers, a message published during a real `sleep 15` tool, offline resume, stable receipts |
| Claude Code 2.1.310 | Managed native plugin, isolated user settings | Upstream and explicit markers, real busy tool, offline resume, stable receipts |
| pi 1.4.0 | Managed extension discovered by the installed runtime bundle, RPC | Idle wake, upstream and explicit markers, real busy tool, same-history offline restart, stable receipts |
| OpenCode 2.1.2 | Managed v2 plugin, isolated authenticated loopback server | Idle wake, upstream and explicit markers, real busy tool, server restart and offline resume, stable receipts |

All four then loaded a marked test upgrade through their actual native entry, received a fresh marker in a real model response, uninstalled twice, reinstalled the fixed source, and received another fresh marker. Uninstall/reinstall preserved the relay state byte-for-byte; previous receipt bytes and local uncommitted edits remained intact. The upgrade variant changes only `src/core/consumer.ts` and its compiled module to append a test-only load marker. This is **not** acceptance of an upgrade between published releases. Claude skill changes still require the documented migration/reinstall procedure.

A separate real-model Claude Code ↔ pi check sent messages through both clients' actual Bash tools in linked worktrees. Each receiving model quoted the other marker, with two new independent receipts; a different repository sharing the same state root received neither. This verifies one pair in both directions, not all pairwise combinations.

Native identity checks deliberately reused a pi ID in a different native history file and deleted/recreated an OpenCode session using the same ID. Both replacement models responded without receiving the old unread marker, and their instances differed. Pi's original native history then resumed and the model reported its retained marker; OpenCode's old unread event remained unacknowledged. The core regressions additionally cover durable message rotation, oversized-message fairness, causal upstream gating after false/pending callbacks, clock rollback/reset chains, legacy migration order, explicit history-gap acknowledgement, late daemon metadata, and startup interleaved with upgrade.

Evidence remains under `$TMPDIR/gitrelay-final-acceptance-ufn9r0og/`; exact sessions, events, file hashes and outcomes are in `acceptance-results.json`. Earlier unsuccessful auth/configuration and harness attempts are disclosed there and do not count as passes. Nine temporary credential/configuration copies were removed after validation; retained fixture files were scanned for known test credentials. Original user settings and services were not replaced. Pi's installed runtime bundle was invoked directly to avoid its managed launcher's staging cleanup; this does not validate that launcher's cleanup behavior.

Forced termination, power loss, Windows, every client version, and permanent exactly-once model work remain unverified. Automatic branch synchronization and worktree removal remain disabled. Older processes are not protocol-fenced; stop them before the native identity/legacy launcher migration and retain unbound inboxes for review. The existing installer locale-sensitive digest and external destination-directory publication race remain documented in [integrations](integrations.md#automatic-setup).

## Local regression suite (2026-10-27, Asia/Singapore)

Session validation previously accepted non-string timestamp values that
`Date.parse` coerces. An isolated real-Git probe showed that `closedAt: 0`
was accepted and the damaged session was included in a broadcast's recipients.
The source now rejects non-string session timestamps while retaining existing
parseable strings. Two isolated regression tests passed against the private
copy; the previous source failed both. They validate all three timestamp fields
and preserve the malformed session and event directory during the send check.
The source and test matched the workspace except for disabling fixture cleanup;
Node `rm` was replaced with a no-op and `unlink` was blocked. Git's own file
operations were not intercepted. This does not establish real-client, GC,
Windows or automatic recovery behavior. Evidence:
`/tmp/gitrelay-session-time.loUNyOZp/`,
`/tmp/gitrelay-session-old.hsaq1qzS/` and
`/tmp/gitrelay-session-fix.n9ul4V6u/`. Command:

```sh
env -i PATH=/usr/bin:/bin HOME=/tmp/gitrelay-session-fix.n9ul4V6u \
  TMPDIR=/tmp/gitrelay-session-fix.n9ul4V6u GIT_CONFIG_GLOBAL=/dev/null \
  GIT_CONFIG_NOSYSTEM=1 GIT_TERMINAL_PROMPT=0 \
  /Users/sheny/.nvm/versions/node/v22.23.2/bin/node \
  --import /tmp/gitrelay-session-fix.n9ul4V6u/no-delete.mjs \
  --disable-warning=ExperimentalWarning --experimental-strip-types --test \
  /tmp/gitrelay-session-fix.n9ul4V6u/tests/core/session-timestamps.test.ts
```

An earlier per-ref daemon token change prevented a client from trusting a fresh global
heartbeat as proof that the same daemon checked that ref. An isolated real-Git
probe with synthetic heartbeat files reproduced the previous delayed check;
an old-version daemon was not actually started. A private source copy passed
five focused tests covering missing or mismatched tokens, matching and stale
hints, unknown historical fields, direct synchronization, cancellation and
pending-event recovery. The recovery test copied state without retained lock
files; it does not establish original-location lock recovery. The source and
test matched the workspace at that time. The later always-synchronize change
removes the cache fast path; see the current evidence at the end of this file.
The run used a clean environment and a preload that
replaced Node `fs.promises.rm` with a no-op and rejected `unlink`; Git's own
file operations were not intercepted. The three existing fake-daemon fixture
files were adjusted and typechecked, but their tests were not run because they
include real daemon or GC operations. No real daemon, GC, client, full suite,
Windows, power-loss or concurrent-host test was run. Evidence:
`/tmp/gitrelay-daemon-hint.T4RfwY9x/` and
`/tmp/gitrelay-daemon-token-final.G5KbxiiX/`. Test command:

```sh
env -i PATH=/usr/bin:/bin HOME=/tmp/gitrelay-daemon-token-final.G5KbxiiX \
  TMPDIR=/tmp/gitrelay-daemon-token-final.G5KbxiiX \
  GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 GIT_TERMINAL_PROMPT=0 \
  /Users/sheny/.nvm/versions/node/v22.23.2/bin/node \
  --import /tmp/gitrelay-daemon-token-final.G5KbxiiX/no-delete.mjs \
  --disable-warning=ExperimentalWarning --experimental-strip-types --test \
  /tmp/gitrelay-daemon-token-final.G5KbxiiX/tests/core/daemon-ref-token.test.ts
```

An isolated real-Git probe reproduced an incorrect acknowledgment when an
upstream event listed a recipient subscribed to a different ref: no message
was delivered, but the event received an `irrelevant` receipt. Normal built-in
publication selects recipients by ref; the probe used a synthetic mismatched
event and does not show that normal publication produces one. The consumer now
stops before host delivery checks or receipt writes for this mismatch. An
isolated source copy passed the persistent regression test, covering four
mismatch modes, both existing receipt states, a valid same-ref upstream event,
and an unrelated-ref event alongside a message. Existing receipts were left
unchanged. The source and test match the workspace; fixture cleanup was
disabled, `rm` was replaced with a no-op and `unlink` was blocked, and state
was copied without retained locks between scenarios. This does not establish
original-location lock recovery, replay already-confirmed or collected events,
or verify real clients. Registration and receipts for earlier events can be
written before the mismatch is encountered; this is not an atomic rollback.
If a native host already accepted an event without a receipt, inspect its
history and proofs before retrying. Evidence: `/tmp/gitrelay-cross-ref.HTeajNTc/` and
`/tmp/gitrelay-cross-ref-fix.tWPwEN5x/`. The regression command was:

```sh
cd /tmp/gitrelay-cross-ref-fix.tWPwEN5x
env -i PATH=/usr/bin:/bin HOME="$PWD" TMPDIR="$PWD" \
  GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 GIT_TERMINAL_PROMPT=0 \
  GIT_TEMPLATE_DIR="$PWD/template" NODE_OPTIONS="--import=$PWD/no-delete.mjs" \
  /Users/sheny/.nvm/versions/node/v22.23.2/bin/node \
  --disable-warning=ExperimentalWarning --experimental-strip-types --test \
  "$PWD/tests/core/upstream-ref-mismatch.test.ts"
```

Claude's [hook reference](https://code.claude.com/docs/en/hooks) describes
`PostToolUseFailure` as the separate event for tools that fail after execution
starts. The current
Claude hook entrypoint and configurations do not subscribe to it, so GitRelay
does not check for messages at that event; a later supported hook can still
check. An isolated real-Git test with a simulated host found that the current
source ignored the event, while a private candidate returned a marked message
and wrote its receipt. The candidate's pure hook-format checks distinguish old
four-event and new five-event installation records and use distinct snapshot
suffixes. The candidate was reviewed but not integrated: actual Claude
installation, upgrade, interruption recovery and downgrade were not run. A
previously installed stable launcher retains its original hook configuration,
so simply upgrading its runtime would not add this event; plugin migration
needs separate verification. Evidence:
`/tmp/gitrelay-claude-failure.FuEtKFe0/probe.mjs` and
`/tmp/gitrelay-claude-failure.FuEtKFe0/format-test.mjs`.

The [Claude hooks reference](https://code.claude.com/docs/en/hooks) identifies
`agent_id` with both subagents and in-process teammates. The current hook code
returns an empty response for any nonempty `agent_id`, so such teammate hook
calls do not register or consume. `TeammateIdle` means a teammate is about to
be idle, and its `agent_id` may be absent; it is not evidence of permanent
termination. The installed entrypoints do not establish a teammate lifecycle.
A direct simulated hook input with a teammate-shaped `agent_id` returned `{}`
without invoking the repository path; this is code-level evidence, not a real
teammate session. No real host or message-delivery acceptance was run for this
case.

An isolated real-Git, simulated-host probe showed that the current Claude and
Codex hook paths write a delivered receipt after output whether the host
subsequently accepts or discards it. Claude documents that a timed-out
UserPromptSubmit hook can have its output discarded. The Codex case was
simulated, not observed in a real host. A separate explicit-ack prototype
retained and retried events without an acknowledgment, then stopped after a
valid one; wrong tokens and closed sessions were rejected. It did not bind the
event's contents, integrate with CLI or GC, or solve mixed-version behavior,
reused session IDs or duplicate delivery. It was not merged. The tests copied
state without retained locks to simulate another invocation, so they do not
prove original-location lock recovery. Evidence:
`/tmp/gitrelay-hook-ack-HlsCr8Ii/`. References:
[Claude hooks](https://code.claude.com/docs/en/hooks) and
[Codex hooks](https://developers.openai.com/codex/hooks).

Version-range validation now rejects version tokens longer than 256 characters,
including a leading `v`, and core components above `Number.MAX_SAFE_INTEGER`.
Previously a synthetic OpenCode wrapper reporting an oversized minor version
was classified as installed despite the local npm SemVer implementation
rejecting it from `^2.1.2`. A clean-environment private copy passed all four
`platform-version-ambiguity.test.ts` cases, including 22 range assertions
across synthetic OpenCode, Codex, and pi wrappers. Its source matched the
workspace; the copy omitted four temporary-fixture cleanup callbacks. The
local npm SemVer implementation was separately checked at the 256/257-character
and safe-integer boundaries. This did not run any real client or installer,
and Windows remains unverified. Evidence: `/tmp/gitrelay-version-safe.7H2CJRaY/`
and `/tmp/gitrelay-version-large.fn4Q7pnm/`.

Version detection now treats a distinct version on stderr, or attached to a
wrapper name, as ambiguous. Only stdout can identify the client; stderr-only
versions remain unavailable. The private copy of
`tests/cli/platform-version-ambiguity.test.ts` passed 3/3; it omitted fixture
cleanup and used a preload that rejects rm/unlink. Its two source files matched
the workspace. The test used synthetic wrapper scripts, not real clients or
installers; Windows output remains unverified. Evidence:
`/var/folders/1b/b19xbzjx7xqc4kl0k9x_y4y80000gp/T/gitrelay-stderr-fix-v5g01fv_/regression/`.


Hook Git-discovery diagnostics were corrected after a real isolated Git
repository with a wrapper returning exit 77 caused all three simulated hook
adapters to return `{}`. An isolated source copy passed four focused tests:
unexpected exits 1, 77 and 129, a signal, actual non-repository exit 128, a
healthy repository, and a simulated killed timeout. All three adapters were
covered. The earlier implementation failed the unexpected-exit regression.
The private source and tests match the workspace; the run used an empty
environment, an isolated home and Git configuration, an empty Git template,
and a preload blocking `rm` and `unlink`. Independent review separately
checked the 77 and actual non-repository cases for each adapter. Evidence:
`/tmp/gitrelay-hook-errors.QOQK9eRS/`,
`/tmp/gitrelay-hook-errors-old.9rpK4Ga0/`, and
`/tmp/gitrelay-hook-review.lBUpHkuQ/`. Exit 128 can also indicate damaged or
inaccessible Git metadata and is still ignored; actual hosts and Windows were
not tested.

An installer digest locale defect was reproduced without running an installer:
the same existing workspace `dist/` yielded different runtime digests in
`en_US.UTF-8`, `th_TH.UTF-8` and `cs_CZ.UTF-8` on Node 22.23.2. The
Claude `dist`/`skills`/`docs` fingerprint differed as well; the current
`skills`-only fingerprint happened to match in those runs. Codex and
OpenCode revalidate the prior runtime digest during an upgrade, and Claude
revalidates its prior snapshot, so a changed locale can cause a false
modified-runtime error. This does not establish that any particular installed
snapshot is unchanged. Pi's current digest uses a different ordering rule.

A private v2 digest model uses a version-and-kind prefix, stable string
ordering and slash-separated hash paths on Windows. Across four locales it
produced one digest for an ASCII/non-ASCII fixture, while matching the current
legacy digest under each original locale and rejecting changed bytes. A
separate in-memory model found that legacy comparison treats `é` and `e` plus
a combining accent as equal: their relative enumeration order can affect the
legacy digest even when the locale is known. Windows path behavior was only
simulated. Old records do not contain their original locale, ICU version or
tie order, and v2 has not been integrated with any journal, snapshot,
downgrade or recovery process. The defect remains unresolved. Evidence:
`/tmp/gitrelay-digest-locale.PFDwCZcH/` and
`/tmp/gitrelay-digest-versioned.nStrE8RI/`.

A later private prototype computes the old digest and a domain-separated v2
digest from the same verified file reads. V2 encodes path components and
includes empty directories. In a read-only check of this workspace's `dist`
tree under three locales, each paired old digest exactly matched the current
implementation, the old results differed, and the v2 results matched. A
synthetic model checked exact old-value matching, preserving an old Claude
skills value, change detection, copied trees and empty directories. Its first
empty-directory assertion compared old values across different locales and
failed; after correcting that test condition, it passed. Private installer
source was adapted for old-or-v2 exact verification and new v2 publication,
and passed type checking; an independent read-only review found no confirmed
old-value adoption bug in its limited review. These are not installation
tests. Old values that cannot be reconstructed still fail closed, older
installers may reject v2 snapshots, and no automatic downgrade is provided.

A warm local read benchmark on `dist`, eight alternating runs per variant,
measured median old-digest time 4.20 ms and paired-digest time 4.67 ms; it
does not establish cold-cache, large-tree memory, concurrent, Windows or
real-client performance. macOS returned EILSEQ when the test attempted to
create an invalid-UTF-8 filename, so rejection of such names was not validated
on an actual filesystem. The prototype has not been integrated, and no real
install, upgrade, interrupted recovery, Windows or downgrade test ran.
Evidence: `/tmp/gitrelay-digest-candidate.P6f4jiKD/` and
`/tmp/gitrelay-digest-integration.7wLFh9vK/`.


An isolated real-Git probe of the previous hook behavior simulated a host
discarding a Claude `SessionStart` response: the marker was absent from the
next prompt while the receipt said `delivered`. Claude's [hook documentation](https://code.claude.com/docs/en/hooks)
says a background `SessionStart` result can be discarded when the user clears
or switches conversations; it does not establish the minimum affected client
version. The hook now leaves relevant `SessionStart` events unread until a
later supported hook. Six isolated tests passed for deferral, Codex behavior,
irrelevant events, output failure, cancellation, and legacy catch-up. They
used a simulated host, clean Git settings, and disabled rm/unlink; state was
copied without lock files between operations, so these tests do not prove lock
release. The old and new probes are retained at
`/tmp/gitrelay-hook-discard.WTlQed5o/` and
`/tmp/gitrelay-claude-defer.pHLfQAsE/`. No Claude client was run. Other hook
outputs can still be discarded after timeout, cancellation or host failure,
and a hook receipt does not prove host acceptance.

Platform detection now rejects version output with multiple distinct version
candidates instead of mistaking a wrapper or dependency version for the
client version. The private `platform-detection.ts` matched the workspace;
the private test matched except for omitted temporary fixture cleanup. Two tests passed in an empty environment,
covering ambiguous and repeated versions, prereleases, malformed output and
cancellation. They used only a synthetic `opencode` executable and a bounded
local sleep, not a real client or installer. Test directories were retained.
Windows and real-client version output were not checked. Evidence:
`/tmp/gitrelay-version-fix-t9g105bo/`. Command:

```sh
env -i HOME=/tmp/gitrelay-version-fix-t9g105bo \
  TMPDIR=/tmp/gitrelay-version-fix-t9g105bo PATH=/usr/bin:/bin \
  GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 \
  /Users/sheny/.nvm/versions/node/v22.23.2/bin/node \
  --disable-warning=ExperimentalWarning --experimental-strip-types --test \
  /tmp/gitrelay-version-fix-t9g105bo/tests/cli/platform-version-ambiguity.test.ts
```

An independent real-Git and simulated OpenCode host check reproduced an
unhandled rejection when logging a failed background session query threw.
The same reporting failure also rejected event-stream cleanup. Making the
diagnostic best-effort resolved both isolated regression cases: they failed
before the change and passed 2/2 afterward. The isolated source and test
matched the workspace; the run used an empty environment, isolated HOME,
Git configuration and template, with `rm` and `unlink` disabled. An
independent review checked error and disposal propagation; existing cleanup
tests were not rerun because they require removing lock files. This does not
establish real OpenCode behavior. Evidence:
`/tmp/gitrelay-opencode-warn-fix.lrvkn6n2/`.

An OpenCode startup-retry candidate was tested on the current source after
the read-only lookup cancellation change. Two isolated real-Git tests using a
simulated host passed: a previously registered inbox delivered a marker after
an injected Git failure recovered, and a non-Git directory registered after it
was initialized as a repository. Three existing initialization-error tests
and all five read-only lookup cancellation tests passed with recovery hooks.
A separate fake-consumer harness covered concurrent
root lookups, backoff under wall-clock rollback, delayed first delivery and
session deletion during lookup. Its consumer was simulated. An independent
review checked the cancellation interaction. These tests retained fixtures by
disabling rm/unlink; they do not establish real OpenCode behavior, repeated
lock release, or recovery of events sent before registration. The extra root
query measured a 5.21 ms median over 40 warm local calls (p95 5.63 ms); this
is not end-to-end or concurrent-host performance. Evidence:
`/tmp/gitrelay-opencode-retry2.ULuduPhR/`.

The installed `@opencode/plugin` 2.1.2 Promise adapter ignores the optional
signal argument of `session.get` and `session.prompt`. GitRelay now stops
waiting for read-only lookups on shutdown or deletion, while retaining the
original wait and lock for prompt calls with an uncertain delivery outcome.
Five tests in an isolated source copy passed with fixture cleanup disabled and
`rm`/`unlink` blocked, covering lookup cancellation and late results. Four
additional probes using the actual SDK Promise adapter and a controlled Effect
host covered pending registration and scan lookups with late success or error.
They do not start OpenCode, cancel the SDK's underlying request, or establish
real-host resource release or prompt deduplication. The shared source and test
matched the private copy. Evidence:
`/tmp/gitrelay-opencode-cancel-private.67hBbFTm/`.

An isolated source copy passed 13/13 leave-repository-id tests after adding
checks for dangling worktree and ancestor links. The tests cover default and
explicit leave, trailing separators, existing paths whose raw and normalized
forms differ, valid ancestor links, injected lstat errors and a missing root
boundary. The private source and test match the workspace; an inherited preload
blocked rm and unlink, and the run used an empty environment with isolated
HOME and TMPDIR. The checks are not atomic with path replacement; Windows and
real-client behavior were not verified. Evidence:
`/tmp/gitrelay-leave-dangling-fix.MDMZpHOp/` and
`/tmp/gitrelay-leave-review2.ecJKquIw/`. The private test command was:

```sh
cd /tmp/gitrelay-leave-dangling-fix.MDMZpHOp
env -i PATH=/usr/bin:/bin HOME="$PWD" TMPDIR="$PWD" \
  GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 \
  NODE_OPTIONS="--import=$PWD/no-delete.mjs" \
  /Users/sheny/.nvm/versions/node/v22.23.2/bin/node \
  --disable-warning=ExperimentalWarning --experimental-strip-types --test \
  tests/core/leave-repository-id.test.ts
```

A private causal-delivery model passed 17 in-memory assertions covering
publication interruption, pending and rejected delivery, missing chain links,
and corrupt sidecars. It assumes a single writer and a queryable native
receipt; it does not implement the production protocol or establish real-host,
GC, mixed-version or power-loss behavior. See
`/tmp/gitrelay-causal-model.vdtO4Lw0/model.mjs`. A separate pi incarnation
binding model passed seven synthetic assertions, but independent review found
missing cross-process locks, bounded file reads, interrupted-write recovery
and safe legacy-inbox claiming; it does not exercise the consumer or actual
pi proofs and was not integrated. See `/tmp/gitrelay-pi-binding.biJZl17t/`.


An isolated source copy passed 6/6 tests for explicitly selecting a retained
repository when leaving a removed worktree. The cases cover two synthetic repository states
with the same session key, an unrelated invalid directory link, invalid or
missing IDs, damaged state, session mismatch, CLI option validation and the
actual CLI leave command. The source and test matched the workspace; a preload
blocked `rm` and `unlink`, including in the CLI subprocess. Tests used an
empty environment with isolated HOME, TMPDIR and Git configuration. This is
local regression coverage, not a real-client or concurrent path-recreation
check. Evidence and preload: `/tmp/gitrelay-leave-id.vBC939My/`.

Static internal-directory and receipt-file link checks were added after an
isolated real-Git reproduction wrote a synthetic event through a linked
`events` directory. The isolated copy of `state-path-safety.test.ts` passed
7/7; its source matched the workspace except for disabling fixture cleanup,
and its seven changed core source files matched the workspace. Its preload
replaced `fs.promises.rm` with a no-op and rejected `unlink`, retaining locks
and temporary files. The run used `env -i`, a private HOME and TMPDIR, no
system or global Git configuration, and an empty Git template:

```sh
env -i PATH=/usr/bin:/bin HOME=/tmp/gitrelay-static-dir-proto.D70vR86g \
  TMPDIR=/tmp/gitrelay-static-dir-proto.D70vR86g GIT_CONFIG_GLOBAL=/dev/null \
  GIT_CONFIG_NOSYSTEM=1 GIT_TERMINAL_PROMPT=0 \
  /Users/sheny/.nvm/versions/node/v22.23.2/bin/node \
  --import /tmp/gitrelay-static-dir-proto.D70vR86g/no-delete.mjs \
  --disable-warning=ExperimentalWarning --experimental-strip-types --test \
  /tmp/gitrelay-static-dir-proto.D70vR86g/tests/core/state-path-safety.test.ts
```

Private source type checking passed. Additional isolated probes covered first
initialization, daemon rejection before GC, and legacy identity migration;
interrupted migration recovery used a copy excluding retained locks, not
automatic original-location recovery. No GC, installer, pi/Claude client,
full suite, Windows or power-loss tests ran. External directory replacement,
hard links and other state JSON file links remain outside these checks. The
private benchmark measured median `repository()` time of 12.268 versus
12.279 ms over 40 alternating runs, and 1,000 sequential receipt reads of
56.84 versus 64.56 ms over six alternating rounds. Both used local warm caches
and do not establish cold-cache, concurrent or real-client latency. Evidence:
`/tmp/gitrelay-event-symlink.WdJ0dYKN/` and
`/tmp/gitrelay-static-dir-proto.D70vR86g/`.

OpenCode initialization previously suppressed an unexpected Git failure in a
real repository. The initial diagnostic change reported startup failures,
including missing Git, and remained inactive until reloaded. The later retry
change described above supersedes that behavior; ordinary non-Git directories
still warn because Git can report the same error for damaged metadata.
A clean-environment private copy of the current source passed three targeted
Git-failure, missing-Git and throwing-logger tests, plus one existing non-Git
test. Its fixture cleanup was disabled. An independent review checked the
shared source and tests against the private copy. The separate test file that
also invokes the pi adapter was not run. A local typecheck passed; real
OpenCode log visibility and automatic recovery are not established. Evidence:
`/var/folders/1b/b19xbzjx7xqc4kl0k9x_y4y80000gp/T/gitrelay-opencode-diagnostic-tests-modpr7u9/`.

An independent real-Git probe reproduced legacy catch-up ordering failures:
a later B→C event is delivered before the older A→B migration event, including
after interrupted publication; an existing B→C receipt hides that delivery
while A→B is subsequently delivered. An old baseline at C also produced
overlapping B→C and A→C events. An existing A→B receipt was respected, and
an unconfirmed pi proof for B→C failed closed. Previously collected events
and receipts cannot establish historical order. No fix is claimed. The probe
and isolated repositories are retained at `/tmp/gitrelay-legacy-review.4Tgwz5/`,
`/tmp/gitrelay-legacy-probe.rRkJjp/` and
`/tmp/gitrelay-legacy-probe.iFhpQ3/`. A private fail-closed stopgap was
not adopted: independent review found that it would also block recoverable
pi confirmations and normal legacy imports, while missing histories already
removed by GC. There is currently no automatic repair for ambiguous history;
preserve the original session and state for inspection.

The two delivery-fairness TODOs were independently reproduced against real
Git: a rejected earlier batch can indefinitely prevent the ninth message
from being attempted, and a rejected oversized event can block a small later
event. The TODO failures are not passing tests. Simple rotation changes the
documented ordering contract; historical timestamps and IDs do not always
reconstruct causal publication order. A private sequence prototype remains
unmerged: independent review found that rewriting message JSON can prevent
pi from recognizing a previously delivered message when its receipt is
missing; its first-observed ordering is also not publication ordering. New
state files require identity-migration compatibility, and scanning all events
under the publication lock requires measurement. No scheduling fix is claimed.
Evidence: `/tmp/gitrelay-fairness-prototype.2SYIRB02/`. A subsequent
sidecar prototype retained original event bytes, but independent review
reproduced writing outside the state directory through a symlink and found
unbounded sidecar growth, lock-held scans and migration incompatibility. A
later private directory check passed a modified probe; concurrent replacement
of that directory remains unverified. Its experimental GC could remove
corrupt index evidence and is not integrated. During isolated prototype
testing, GC was applied to test state. After a stop instruction, an
ineffective test-name filter accidentally ran two more GC cases, deleting
event, receipt and sidecar files within their isolated fixtures; subsequent
testing stopped and temporary directories were retained. The prototype and
probe are retained at
`/tmp/gitrelay-sidecar-prototype.Y50Fcvib/` and
`/tmp/gitrelay-sidecar-review.mumFUqOm/`. A warm local synthetic probe
with one receiver rejecting every message measured median full consume times
of 48, 144 and 390 ms for 100, 1,000 and 3,000 events, respectively (three
polls per size; excludes setup and index creation). These include Git and
consumer overhead and do not measure cold cache, concurrent consumers, pure
lock time or real-host latency. Script:
`/tmp/gitrelay-sidecar-prototype.Y50Fcvib/sidecar-bench.mjs`.

After the one-shot interruption change, seven focused CLI cases passed in an
isolated source copy: repeated SIGINT during four locked operations, SIGTERM
after a send was published but its output was blocked, and SIGTERM while
`check` and `watch` used a full OS stdout pipe. The private test copy retained
its temporary directories; the shared source and test matched it, except for
test/build cleanup disabled in that copy. Independent review checked the
diff, but did not rerun these tests. TypeScript checking passed separately.
These cases do not establish real-host behavior or that a canceled send was
rolled back. Evidence: `/tmp/gitrelay-signal-tests-8niSz67J/` and
`/tmp/relay-signal-evidence-2df8gzfz`.

An isolated Git regression for ambiguous porcelain HEAD labels exercised local
branches named `(detached)` and `(null)`, detached HEAD, a symbolic HEAD that
points outside `refs/heads/`, explicit branch selection, UTF-8 and Git errors.
The tested private copy used the current source and omitted its temporary
directory cleanup; it completed 1/1. A separate review checked an unborn
`(detached)` branch. An independent wrapper performed a real checkout to
detached HEAD before the second symbolic-ref read; the query reported that
HEAD changed. This single interleaving does not establish atomicity or exclude
ABA switches. Evidence:
`/var/folders/1b/b19xbzjx7xqc4kl0k9x_y4y80000gp/T/gitrelay-status-private-i3103e2v/`
and `/tmp/git-relay-real-race-kinPn3`.

After the independently committed path-matcher change, the full remaining
working tree passed an isolated `npm test` run with 512 tests: 490 passed,
zero reported failures, one Windows-only skip and 21 unresolved TODOs. The
run used a fresh home, a minimal Git template, empty hooks, and disabled global and
system Git configuration. Evidence:
`/var/folders/1b/b19xbzjx7xqc4kl0k9x_y4y80000gp/T/gitrelay-next-verify-BtR5KIZO/npm-test.log`.
This local result is separate from the CI run for the earlier partial commit
and does not establish full real-client acceptance.

### Pi real-model check on an earlier source snapshot

An isolated pi `1.4.0` RPC session used the managed extension and the
user-specified `deepseek-v4.1-flash` Responses service through a loopback proxy.
The proxy buffered complete responses and supplied the service credential
without passing it to pi or its children. Two installer invocations exited
successfully; the RPC command list showed the extension loaded. The recorded
result reports that the model recognized a synthetic marker and calculated
`19 + 23 = 42`, then recognized a second marker and calculated `14 + 15 = 29`
after the session was stopped, the event was sent, and the same session ID
was restarted. The two event receipts were `delivered`, each remained unchanged
over a short polling interval, and a subsequent independent inspection found
one receipt file per event. Uninstall and repeat uninstall reported `removed`
and `not-managed`; isolated relay state, an unrelated sentinel and a local
worktree edit were retained.

The proxy blocks some literal or split credential echoes; it is not a general
secret filter. A separate offline test confirmed that an encoded test secret
can pass the filter. The user-selected service remains a trust boundary, and
the isolated native session may contain content returned by that service.

The test used one pi receiver and a synthetic CLI sender. The separate test
repository did not run a receiving session. Busy delivery, cross-client
collaboration, actual cross-repository isolation, crashes, long-term
deduplication and exactly-once model processing were not established. The
result is the script's sanitized report; model output and upstream requests
were not retained, and the marker and arithmetic checks can match different
assistant text fragments. Installer statuses were not recorded, only successful
process exits. Evidence:
`/var/folders/1b/b19xbzjx7xqc4kl0k9x_y4y80000gp/T/gitrelay-pi-accept-plan-0dhzIWT2/real-pi-1fneh11j/result.json`.
At the time of the check, the 73-file source manifest and seven recorded
source hashes matched the test snapshot and workspace; a later independent
check found all 40 `dist` files byte-identical. The workspace has since
changed, so this is not acceptance of the current source. Neither comparison
verifies `node_modules`, the model service or the runtime environment.

After the exclusive-temporary creation and submodule relevance fixes, the
isolated full `npm test` run reported 511 tests: 489 passed, zero reported
failures, one Windows-only skip and 21 TODOs. TODOs include the two new
confirmed delivery-fairness failures and remain unresolved. The previous full
run reported two failures because UTF-8 fault-injection wrappers did not match
the new Git options; the fixtures were corrected and independently reviewed
before this rerun. An auto-sync TODO fixture was also corrected so it reaches
its intended assertion with an empty Git template. The local TypeScript
compiler passed in an isolated home. Evidence:
`/var/folders/1b/b19xbzjx7xqc4kl0k9x_y4y80000gp/T/gitrelay-all-final-OyzglaOf/npm-test.log`.
These checks do not establish Windows, hosted CI or real-model acceptance.

After the submodule relevance change, isolated targeted tests of submodule
delivery, streamed index parsing and existing change inspection passed 17/17;
the local TypeScript check also passed. The Git tests cover tracked and ignored
submodule changes, an uninitialized directory with local data, a clean
submodule, staged deletion, and an existing `irrelevant` receipt. A simulated
pipe-error test and wrapper-backed malformed-index, oversized-record and
cancellation tests exercise the scan's failure paths. This is local regression
coverage, not Windows or real-model acceptance. Log:
`/var/folders/1b/b19xbzjx7xqc4kl0k9x_y4y80000gp/T/gitrelay-submodule-final2-WtexOtZS/tests.log`.

After fixing nested-repository relevance and parallelizing recovery reads, an
isolated `npm test` run reported 490 tests: 470 passed, zero reported failures,
one Windows-only skip and 19 TODOs. The new TODO reproduces legacy migration
ordering; TODOs are unresolved rather than passing tests. Evidence:
`/var/folders/1b/b19xbzjx7xqc4kl0k9x_y4y80000gp/T/gitrelay-round-verify-lgRNajts/npm-test.log`.
The local TypeScript compiler and `git diff --check` also passed. The isolated
tests used an empty HOME and Git template with system/global Git configuration
and external hooks disabled. These results do not establish hosted CI,
Windows or real-model acceptance.

After the Unicode ref fixes and automatic-sync stopgap, an isolated `npm test`
run reported 486 tests: 467 passed, zero reported failures, one Windows-only
skip and 18 failing TODOs. Fourteen TODOs cover the temporarily disabled
automatic sync; the other four cover OpenCode session-ID reuse, safe automatic
worktree removal, upstream ordering after clock rollback and safe history-gap
acknowledgement. TODOs are unresolved, not passing tests. Two tests in the
preceding run failed because their fixture assumed an `info` directory exists
in an empty Git template; the fixture was fixed before this run. Evidence:
`/private/var/folders/1b/b19xbzjx7xqc4kl0k9x_y4y80000gp/T/gitrelay-unicode-final-0hpli2xn/npm-test.log`.
TypeScript checking with the local compiler in an isolated home and an offline
package check also passed. The package check used an explicit temporary npm
consumer and simulated repeated Codex and OpenCode installs and uninstalls;
its log is
`/private/var/folders/1b/b19xbzjx7xqc4kl0k9x_y4y80000gp/T/gitrelay-package-verify-wbwu9pb0/package.log`.
These results do not establish Windows, real-model or hosted CI acceptance.

A four-platform coexistence check used isolated homes, config and state roots
with simulated version probes and clients reporting Codex `0.164.0`, Claude Code
`2.1.310`, pi `1.4.0` and OpenCode `2.1.2`. Two unified installs, individual
installs after modifying the isolated package snapshot, individual uninstalls
and a repeated uninstall completed successfully. The test checked that each
other platform's entry remained present after individual operations, and that
unrelated pi, Codex and OpenCode settings remained unchanged. It did not prove
that every host loaded the changed runtime, did not use real clients or models,
and did not exercise concurrent installation. Codex reported `pending-trust`.
Evidence: `/tmp/gitrelay-isolated-four-coexist.py` and
`/private/tmp/gitrelay-coexist-four-065hokzc/results.json`. The tested installer
source SHA-256 values were `33f00e4b08f60853f42492d258c8eddf8679e7c6f270f9154cfa525d9b44d1dc`
for `src/cli/install.ts`, `8beb71d2b2bbc92cca07cca466d63caea6cc59c58b27af975cb48702d179d1a3`
for `install-codex.ts`, `716f8e9ce780533e42523db5d821168797adaab847ac638cf2b34867e19bfd27`
for `install-opencode.ts`, `29e8d2acbb168204ebce90171bdd164b0a4342225be4c2b5fed1a2ecfe8475b1`
for `install-pi.ts`, and `706e294c30ac995bacf9655877c6a6de209fdfca42c29222c959265eccf3df7e`
for `install-claude.ts`. Temporary evidence may be removed by the OS.

A second run using the same four simulated clients asserted that each
platform's recorded runtime revision changed after the isolated snapshot's
source and built files were modified. Other simulated platform entries and
unrelated settings remained intact. Evidence:
`/tmp/gitrelay-isolated-four-coexist-revision.log` and
`/private/tmp/gitrelay-coexist-four-qmcdorr8/results.json`. The log records
successful assertions but not the individual before/after revision values;
this does not establish that a real client loaded any upgraded runtime.

On macOS, `npm run typecheck` passed and `npm test` completed with 240 passed, zero failed and one skipped (the Windows-only Codex installation check). This working-tree run includes the strict UTF-8 state reader, installer record checks, version detection and pi queue tests; it does not establish real-model or hosted CI acceptance. The captured test output was `/tmp/gitrelay-continuation-final.log`.

After the repository identity and pi interrupted-install changes, a stable-source `npm test` run completed with 275 passed, zero failed and the same Windows-only test skipped; `npm run typecheck` also passed. Output: `/tmp/gitrelay-identity-stable-test.log`. These are local tests, not real-model or hosted CI acceptance.

After the pi confirmation, OpenCode event-stream and shared-state fixes, `npm test` completed with 321 passed, zero failed, one Windows-only test skipped and one explicitly failing TODO for the OpenCode incarnation defect; `npm run typecheck` passed. The prior attempt reproduced an ENOENT/atomic-creation race and failed one test; that race was fixed and independently exercised before this rerun. Output: `/tmp/gitrelay-goal-final-test.log`. The TODO is not a passing test.

After the pi inspection and proof guard, installer digest checks, and Claude test-fixture changes, `npm test` completed with 347 passed, zero failed, one Windows-only test skipped, and the same failing OpenCode incarnation TODO; `npm run typecheck` passed. The preceding full run exposed a Claude timeout test startup race; the fixture was corrected and independently reviewed. Output: `/tmp/gitrelay-inspect-digest-final.log`. The TODO remains unresolved, and these local results are not hosted CI or real-model acceptance.

After workspace-stage protection and further Claude fixture checks, `npm test` completed with 356 passed, zero failed, one Windows-only test skipped and the same failing OpenCode incarnation TODO; `npm run typecheck` passed. A preceding run failed when the fixture's process-group check reported an error; a transient `EPERM` was independently observed and the fixture now retries without treating it as proof that the group exited. A separately observed orphaned test child was cleaned up, but its cause remains unconfirmed. Output: `/tmp/gitrelay-final-20261027.log`. This is local verification, not hosted CI or real-model acceptance.

After upstream-publication recovery and the per-repository daemon maintenance scheduler, `npm test` completed with 372 passed, zero reported failures, one Windows-only skip and two explicitly failing TODOs: OpenCode session-ID reuse and upstream ordering after a wall-clock rollback. `npx tsc --noEmit --pretty false` and `git diff --check` also passed. Output: `/tmp/gitrelay-daemon-schedule-full.log`. The TODOs are unresolved defects, not passing tests; these local results do not establish hosted CI or real-model acceptance.

After CLI per-record acknowledgement and lock-error propagation changes,
`npm test` completed with 380 passed, zero reported failures, the same Windows
skip and the same two failing TODOs; `npx tsc --noEmit --pretty false` and
`git diff --check` passed. Output: `/tmp/gitrelay-individual-busy-final.log`.
Independent tests also exercised real broken stdout pipes and GC/session lock
contention on macOS. A successful pipe write is not evidence that the reader
processed the record, and a crash before its receipt can still cause redelivery.
These tests do not establish Windows, hosted CI or real-model acceptance.

After OpenCode per-event acknowledgement, interrupted-install journal
preservation and pi session-tail checks, `npm test` reported 408 passed, zero
reported failures, one Windows-only skip and the same two failing TODOs.
TypeScript and `git diff --check` passed. Output:
`/tmp/gitrelay-pending-opencode-pi-final.log`. A subsequent offline package
check succeeded with an explicit temporary consumer `package.json`, including
simulated Codex/OpenCode repeated install and uninstall; its log is
`/tmp/gitrelay-pending-isolated-package.log`. An earlier attempt without that
file installed into `/private/tmp` rather than the intended consumer and is
not counted as a passing package check. These are local checks, not real-model
or hosted CI acceptance.

After the Codex installation-generation and cancellation changes, OpenCode
cleanup handling and hook diagnostics, an isolated `npm test` run reported
429 passed, zero reported failures, one Windows-only skip and the same two
failing TODOs. `npx --offline tsc --noEmit --pretty false` and
`git diff --check` passed. The test log is
`/private/var/folders/1b/b19xbzjx7xqc4kl0k9x_y4y80000gp/T/gitrelay-verify-isolated-321rw9jd/npm-test.log`.
The isolated run used separate npm user and global configs; an earlier attempt
with the same file for both was rejected by npm before tests started. These
are local results, not Windows, hosted CI or real-model acceptance.

After the Claude interrupted-upgrade fix, Git history fail-closed behavior,
worktree-removal stopgap and strict Git path/ref decoding, an isolated
`npm test` run reported 462 passed, zero reported failures, one Windows-only
skip and four explicitly failing TODOs: OpenCode session-ID reuse, restoring
identity-safe automatic worktree removal, upstream ordering after clock
rollback, and explicit safe history-gap acknowledgement. TypeScript and
`git diff --check` passed. The log is
`/private/var/folders/1b/b19xbzjx7xqc4kl0k9x_y4y80000gp/T/gitrelay-final-isolated-0glssrz1/npm-test.log`.
An isolated offline package and simulated repeat-install check also passed;
its parent temporary npm files were checked unchanged. Evidence:
`/private/var/folders/1b/b19xbzjx7xqc4kl0k9x_y4y80000gp/T/gitrelay-package-verify-5agk756g/package.log`.
These are local checks, not Windows, real-model or hosted CI acceptance.

An isolated offline package check of this later source snapshot passed `npm pack --offline`, tarball global installation with an empty cache and no optional dependencies, CLI help including `pi-inspect`, and execution of the packaged Codex SessionStart hook without `node_modules`. The archive included both source and compiled `installer-digest` and `inspect-pi` modules and the vendored TOML licenses. Its 126-file tarball SHA-256 was `c85a0218c23d7088e72c3d9e6b53eb63661f40cec606dbb16e7f933b15179ac3`; evidence: `/tmp/gitrelay-package-current-verification.py` and `$TMPDIR/gitrelay-package-final.83jvrf6p/result.json`. This does not establish a model or CI result.

An isolated fault injection replaced a runtime source file with a FIFO after enumeration; the earlier OpenCode installer blocked while holding its installation lock. The shared installer digest now reads through a nonblocking descriptor, checks that the opened file is regular and stable, and rechecks recorded file and directory witnesses after traversal. The injected FIFO was rejected promptly, and installer digest tests cover the runtime, pi and Claude hash modes. Evidence: `/tmp/gitrelay-runtime-fifo-parent.mjs` and `/tmp/gitrelay-runtime-fifo-fixed-parent.mjs`. This is a macOS fault-injection test, not validation on a real special-purpose mount or Windows. The recheck is not an atomic snapshot: an unrelated process can still change an entry after that entry has been rechecked.

### Host-only identity checks

A later offline attempt to prepare a real pi-to-OpenCode or pi-to-Codex check
used fresh temporary homes and synthetic credentials. In one default-deny
macOS sandbox, file and child-process canaries outside the test directory were
denied and OpenCode `2.1.2` could print its version; its local service did not
become ready for `debug config` or model enumeration. The cause was not
established. Another restricted Codex `0.164.0` attempt stopped during
managed-preference synchronization before a model request. Neither establishes
client compatibility or adequate isolation for a real credential. The
experimental profiles also have unverified IPC and network boundaries. Evidence:
`/private/tmp/gitrelay-sandbox-probe.8u7osI/profile.sb`,
`/private/tmp/gitrelay-opencode-offline-b_ujp6kn/` and
`/private/tmp/gitrelay-cross-accept-prep.djHCeI9l/PLAN.md`.

Two isolated fault-injection tests exercise the actual generated Codex and
OpenCode launchers while their corresponding installers publish a new runtime.
The launcher reads the old record, the installer finishes the upgrade, and the
launcher then sees the new revision and rejects it. Each test verifies that
the upgrade completed and a separate clean launcher loaded the new runtime.
Both cases remain failing TODOs in `tests/cli/bootstrap-upgrade-race.test.ts`;
the TODO status is not a passing result. These tests use synthetic runtimes,
not real host sessions, and are skipped on Windows. A compatible migration
and startup fix have not been adopted. An isolated focused run produced both
expected revision errors; evidence:
`/var/folders/1b/b19xbzjx7xqc4kl0k9x_y4y80000gp/T/gitrelay-bootstrap-target-E9w2FqeK/test.log`.

Source review of local pi 1.4.0 found that its version entry constructs a
settings manager before returning `--version`; its managed launcher can set
`PI_MANAGED_INSTALL_ROOT` and initiate its own staging cleanup. GitRelay's pi
detection invokes this entry even for an install preview, and pi installation
also launches the client for runtime validation. This is source-level evidence,
not a reproduction against a user's managed install. A private static-detection
prototype recognized a local npm package and a synthetic current managed layout,
but cannot establish runnable behavior, recognize arbitrary wrappers, or remove
the separate installation-validation side effect; it was not adopted. See the
[setup limitations](integrations.md#automatic-setup).

Before the submodule fix, an isolated real-Git reproduction found that
`submodule.<name>.ignore=all` hid a tracked local submodule edit and an
upstream gitlink update, producing an `irrelevant` receipt. An ignored-only
local file was still hidden when Git diff used `--ignore-submodules=none`.
Evidence: `/var/folders/1b/b19xbzjx7xqc4kl0k9x_y4y80000gp/T/gitrelay-submodule-audit-YJ2ldoGo/repro.mjs`.
The current implementation treats index gitlinks as potential overlaps; a
private prototype delivered the ignored-only case in
`/var/folders/1b/b19xbzjx7xqc4kl0k9x_y4y80000gp/T/gitrelay-gitlink-ignored-kz5ujSnk`,
and the shared-source regression results are recorded above. Existing
`irrelevant` receipts are not revoked. Windows, remote filesystems and
concurrent index changes have not been verified for the new scan.

An isolated Git 2.54.0 experiment tested whether a reference transaction could
make automatic synchronization safe. While `update-ref --stdin` held a
prepared `symref-verify HEAD` transaction, both `git switch` and
`git merge --ff-only` failed on `HEAD.lock`, but each had already changed worktree and
index content in its respective test while HEAD or the branch remained old.
This rules out using that lock alone as an atomic worktree guard for the tested
Git version; it does not establish the behavior of every Git version. Evidence:
`/var/folders/1b/b19xbzjx7xqc4kl0k9x_y4y80000gp/T/gitrelay-syncref-lock-9q5f_540`
and `/var/folders/1b/b19xbzjx7xqc4kl0k9x_y4y80000gp/T/gitrelay-synccheckout-lock-66an9e3t`.

The Claude-to-OpenCode and pi-to-Codex mock-model cross-client tests below
were repeated after the Unicode ref and automatic-sync changes. Both passed
their one-directional host checks and independent-repository isolation checks.
The tested copies matched the current source for `git.ts`, `branch-sync.ts`
and the pi and OpenCode adapter entry points. Their logs are under
`/private/var/folders/1b/b19xbzjx7xqc4kl0k9x_y4y80000gp/T/gitrelay-native-check-uwhn8by8/`.
These are mock-model host checks, not real-model acceptance.

An isolated pi 1.4.0 RPC test deliberately created independent native session
files in different session directories with the same session ID, worktree and
ref. After the first session stopped with an unread marked event, the second
session received that event. The test used a project-local pi binary, empty
authentication, temporary Git state and disabled external Git hooks; its model
provider was unavailable. This confirms an ID-reuse isolation defect, not a
natural random-ID collision or real-model acceptance. Evidence:
`/private/var/folders/1b/b19xbzjx7xqc4kl0k9x_y4y80000gp/T/gitrelay-pi-life-session-review-ncphnenz/tests/adapters/review-rpc-collision.test.ts`.

Independent isolated host checks exercised source snapshots after the identity change. They did not read, copy or refresh user credentials and do not establish real-model acceptance:

- Codex `0.164.0`: managed hooks registered three real sessions across two linked worktrees and an independent repository; a marked event selected the first two. Resuming one session wrote its delivered receipt, while the independent repository had none. The test used an unreachable local provider and a one-invocation hook trust bypass. Evidence: `/tmp/gitrelay-codex-host-identity.py`, `/tmp/gitrelay-codex-host-resume.py` and `$TMPDIR/gitrelay-codex-host-identity-ksadkb2k/`; tested `store.ts` SHA-256 `a472c52e923748fdd7675743551e34bcb0da89b5db6e5a18ff15d70493e7ed56`.
- Claude Code `2.1.310`: its enabled managed plugin registered three real sessions, and an HTTP mock model saw the marked event in requests from both linked worktrees but not the independent repository. Another run recreated the first repository at the same path; after an explicit fresh-state choice, its mock request did not contain the old unread marker and the old event bytes were preserved. Evidence: `/tmp/gitrelay-claude-identity-host-check.py` and `$TMPDIR/gitrelay-claude-identity-host-rhsbxn63/result.json`; the latter snapshot's `store.ts` SHA-256 was `46473bbaf1de69b1cade98f30648ef8306bf93cf577e725607b409657ba5e547`.
- OpenCode `2.1.2`: three independent real servers and native sessions registered in two linked worktrees and an independent repository. A marked event selected exactly the first two after server shutdown. A separate running-session check used a local mock model: the two linked sessions' requests contained a second marker, the unrelated session's request did not, and their two delivered receipts remained unchanged for six seconds. A further mock-model test held one session busy while a marked message was accepted into its host queue; after releasing the request, the next model request contained that marker once, and the unrelated repository saw none. Evidence: `/tmp/gitrelay-opencode-isolation-multiserver.py`, `/tmp/gitrelay-opencode-live-mock.py`, `/tmp/gitrelay-opencode-busy-mock.py`, and `/private/tmp/gitrelay-opencode-identity.ar2y8r/probe3/` and `probe4/`. A delivered receipt confirms host acceptance, not completed model work. No real model was called.

These checks cover host loading, registration and selected delivery or recipient isolation only. They do not prove real-model understanding, all busy-session or crash windows, or complete lifecycle acceptance. The snapshots were taken during parallel development; later source edits require separate verification.

An additional cross-client host check used isolated Claude Code `2.1.310` and OpenCode `2.1.2` installations with mock-only authentication and local mock model endpoints. Claude's real Bash tool invoked `git-relay send` from one worktree; the managed OpenCode plugin in another worktree delivered the unique marker to one mock model request and wrote one delivered receipt. The receipt remained unchanged for six seconds. A separate repository's OpenCode request, event store and receipts did not contain the marker. Evidence: `/tmp/gitrelay-claude-opencode-cross-mock.py` and `$TMPDIR/gitrelay-cross-co-mock-wfsq10vc/result.json`, including source hashes and event IDs. This is one-directional host delivery evidence, not real-model understanding, restart recovery, or a guarantee of long-term deduplication.

Another isolated check used pi `1.4.0` and Codex `0.164.0`, with an empty pi authentication file and local mock endpoints. The real pi Bash tool invoked `git-relay send` in one worktree. A Codex session resumed in another worktree, wrote a delivered receipt through its managed hook, and submitted the marker in a request to the mock endpoint. A separate repository's Codex request did not contain that marker and had no corresponding receipt. Codex used a one-invocation hook-trust bypass; the mock returned HTTP 503, so the request and receipt do not establish a successful model response. Evidence: `/tmp/gitrelay-pi-codex-mock-cross.py` and `$TMPDIR/gitrelay-pi-codex-cross-916_yxdj/result.json`, including source hashes and event IDs. This was a single-direction host check, not real-model acceptance, crash recovery, or long-term isolation.

Both cross-client checks were repeated after the CLI acknowledgement and
lock-error changes, with a cleared parent environment, temporary homes and
local mock endpoints. Claude-to-OpenCode again produced one marked request and
one stable receipt over six seconds; its unrelated repository contained no
matching event or receipt. Pi-to-Codex again produced a marked mock request and
a receipt, while the unrelated Codex request and receipts lacked the marker.
The Codex mock again returned HTTP 503 and used a one-invocation hook-trust
bypass; pi's isolated authentication file was empty. Results are
`/private/tmp/gitrelay-cross-co-mock-ulu_puxl/result.json` and
`/private/tmp/gitrelay-pi-codex-cross-kky484xo/result.json`. The tested
`src/core/consumer.ts` SHA-256 was
`a8a2210295e35afa2bb78ea15c4e785df0ef46445041f80c3b318cf023ec8784` and
`src/core/store.ts` was
`6fb304a311cd29f8b6d2770040af269796e748e0743828971a07cd19d4d215d5`.
These remain host-only, single-direction observations, not real-model
acceptance or evidence of durable exactly-once processing.

The two mock-host checks were repeated after the changes above, again using
isolated homes and loopback endpoints. Claude-to-OpenCode produced one marked
request and one receipt stable for six seconds; pi-to-Codex produced a marked
request and receipt, while the unrelated repository's request did not contain
the marker. The Codex endpoint returned 503 and used a one-invocation trust
bypass; pi's test authentication file was empty. Evidence:
`/private/tmp/gitrelay-cross-co-mock-g25yatfh/result.json` and
`/private/tmp/gitrelay-pi-codex-cross-_wsu8zan/result.json`. The tested
pi watcher SHA-256 was
`919ea3d7c14ac2cd8dc0d113da90ed401a6368e8540e2f10bd4a96da940bd5ac`, and
the OpenCode adapter SHA-256 was
`30294244be2a6f7e8512183dcfe497e81fc899805f0c5114b8a41e67cc453a06`.
This is not real-model acceptance or a crash-recovery test.

After the later Codex generation and cancellation, OpenCode cleanup and hook
diagnostic changes, both mock-host paths were repeated with a cleared parent
environment and a dedicated temporary HOME. Claude-to-OpenCode had one marked
request and a receipt stable for six seconds; the unrelated repository's mock
request lacked the marker. Pi-to-Codex produced the marked request and receipt;
the unrelated request and receipt lacked the marker. The pi authentication
file was empty. Codex used a one-invocation hook-trust bypass and the mock
returned HTTP 503; no successful real-model response is claimed. Evidence:
`/private/var/folders/1b/b19xbzjx7xqc4kl0k9x_y4y80000gp/T/gitrelay-native-check-i0oaz9a0/`.
The tested OpenCode adapter SHA-256 was
`c2baba1ca7f12119d7e0e8a81c3d1cdb3bed55cc14aab575fb6ace7e41aac50a`,
and `install-codex.ts` was
`7f8073f92790276cbf0de042df94f8a9423273c0e977d4fcfca58105eacd7abd`.
These checks do not cover every recovery window or real-model understanding.

The two mock-host paths were repeated on the later strict Git decoding
snapshot in isolated homes: Claude-to-OpenCode produced one marked request
and a receipt stable for six seconds; pi-to-Codex produced a marked request
and receipt while the unrelated request and receipt lacked the marker. Codex
used a one-invocation hook-trust bypass and its mock returned HTTP 503; pi's
test authentication file was empty. Evidence:
`/private/var/folders/1b/b19xbzjx7xqc4kl0k9x_y4y80000gp/T/gitrelay-native-check-iu0f59mr/`.
The tested `src/core/git.ts` SHA-256 was
`41268fedf4057565ab3af9a856c9e2a2bb682474fde31eeb1ea3c0c657b0fe43`.
No successful real-model response or long-term isolation is established.

On the same code generation, a separate pi 1.4.0 RPC test selected a worktree,
replaced it at the same path using Git, then resumed the old menu. The new
worktree and its ignored sentinel remained, and pi displayed the temporary
removal restriction and manual-operation warning. The test used a temporary
home, empty authentication and a project-local pi binary. RPC output had no
agent or message start; the fixture did not independently monitor network
traffic. Evidence:
`/private/var/folders/1b/b19xbzjx7xqc4kl0k9x_y4y80000gp/T/gitrelay-pi-stopgap-repeat-o_kcm8k7/tmp/rpc-stopgap-0fml808e/result.json`.
The tested pi adapter SHA-256 was
`b4de3ab1974a1c4cf557d00b178f756659cfb706287b2eb0f0b7df81dfd18ba5`.
Automatic removal remains unavailable and this does not establish real-model
acceptance or correctness of manual Git operations under concurrency.

After OpenCode switched to per-event acknowledgement, another isolated
Claude Code `2.1.310` and OpenCode `2.1.2` host check used two separately
sent messages: Claude's real Bash tool sent the first marker and the test CLI
sent the second. The same OpenCode session's local mock-model requests contained
both markers and each event had a delivered receipt; the independent
repository's requests contained neither marker. The first marker appeared in
two model requests because the later request included conversation history;
this does not establish a second host admission. The script did not inject a
failure in the second admission, and it does not establish real-model behavior
or exactly-once processing. Evidence: `/tmp/gitrelay-opencode-two-event.py`,
`/private/tmp/gitrelay-cross-co-mock-86y0rojw/result.json`, and
`/private/tmp/gitrelay-cross-co-mock-86y0rojw/second-result.json`. The tested
OpenCode adapter SHA-256 was
`30294244be2a6f7e8512183dcfe497e81fc899805f0c5114b8a41e67cc453a06`, and
the consumer SHA-256 was
`a8a2210295e35afa2bb78ea15c4e785df0ef46445041f80c3b318cf023ec8784`.

OpenCode `2.1.2` was also checked for deletion recovery in isolated servers. A real `session.deleted` event contained a session ID but no location. A plugin context's `session.get` reported `Session.NotFoundError` with the requested ID both for a deleted session and for a still-existing session in another `XDG_DATA_HOME`. Thus a missing session alone does not prove deletion when different OpenCode data roots share GitRelay state. An event emitted while the relevant plugin has not yet loaded may be missed. Evidence: `/tmp/gitrelay-opencode-delete-event-probe.py`, `/tmp/gitrelay-opencode-context-scope.py`, and `/private/tmp/gitrelay-opencode-identity.ar2y8r/probe8/result.json`; no user credentials or model were used.

The same OpenCode host permits deleting a native session and creating another with the same ID. With the server and plugin running, an isolated test sent an unread message to the original session, deleted it, recreated its ID and prompted the replacement. The replacement's local mock-model request contained the old marker and the old event acquired a delivered receipt. This is an unresolved session-incarnation isolation defect; it is not limited to plugin restarts. Evidence: `/tmp/gitrelay-opencode-reused-inbox-active.py` and `/private/tmp/gitrelay-opencode-incarnation-check.2HcwOK/test-reuse-active/result.json`. A failing `test.todo` in `tests/adapters/opencode.test.ts` reproduces the same boundary with the controlled adapter harness; it is not a passing test. No user credentials or real model were used.

An experimental OpenCode metadata-based identity was not adopted: on `2.1.2`, session metadata updates replaced the object, and in 20 isolated concurrent read/merge/write trials both updates reported success while one new key was lost each time. The host's `durable.seq` also restarted at zero when the same session ID was recreated, so neither provides an established safe incarnation identifier. Evidence: `/tmp/gitrelay-opencode-metadata-merge.py`, `/tmp/gitrelay-opencode-incarnation.py`, and `/private/tmp/gitrelay-opencode-identity.ar2y8r/probe14/result.json` and `probe11/result.json`.

An experimental native synthetic-message nonce survived a server restart and changed after deleting and recreating the same ID in one isolated test. After one successful compaction, retrying its message ID still returned the original nonce. In 20 simultaneous two-server trials, both submissions returned the same admitted nonce and the inbox contained one item. It was not adopted: although queued with `resume:false`, the empty synthetic message later entered the mock model context and caused an extra assistant response and model request. These tests do not establish future-version behavior, all crash windows, or an atomic identity-check-and-delivery operation. Evidence: `/private/tmp/gitrelay-opencode-synthetic-probe-df2213cc/result.json`, `/private/tmp/gitrelay-opencode-synthetic-probe-093afe27/result.json`, and `/private/tmp/gitrelay-opencode-identity.ar2y8r/probe15/result.json`.

An experimental nonce placed in individual user-prompt metadata survived an ordinary restart and disappeared from a newly recreated session's context. After a successful compaction, however, it was absent from the plugin's `ctx.session.context()` active window; the host's separate paginated message-history API retained the original metadata, but the official plugin `SessionDomain` does not expose that history. A conservative fallback cannot tell a compacted existing session from a new incarnation from the active window alone: refusing the old inbox would interrupt an ordinary session and require an explicit recovery or migration choice. Neither experiment establishes atomic conditional delivery to the same incarnation. Evidence: `/tmp/opencode-prompt-meta.9cVx3e/result.json` and `/tmp/opencode-prompt-meta-success.FJXwox/result.json`. Neither candidate is implemented.

Two additional isolated OpenCode `2.1.2` checks constrain possible fixes. Exporting, deleting and importing a session reproduced the same session ID, creation time and metadata with an empty new inbox; creation time therefore does not reliably distinguish the two incarnations. In a separate real prompt-hook barrier test, the hook read the old session, the test deleted and recreated that ID while the hook waited, then the original prompt was admitted into the replacement inbox. A check inside the hook alone is therefore not an atomic condition on the incarnation. Evidence: `/tmp/gitrelay-opencode-import-probe.py`, `/tmp/gitrelay-opencode-precommit-race.py` and `$TMPDIR/gitrelay-opencode-precommit-hahjancz/result.json`. No real model was called.

The current adapter stops polling a deleted OpenCode session but does not mark its persisted subscription closed; a subsequent send can still select it. An isolated reproduction is `/tmp/gitrelay-opencode-deleted-repro.mts`. An attempted deletion-recovery implementation was withdrawn: independent tests showed that applying a delayed deletion could close an unrelated replacement repository or a recreated session using the same ID. OpenCode `2.1.2` reused the same ID with created/deleted durable sequence numbers reset to 0/1 on each recreation, including across restart; evidence: `/tmp/gitrelay-opencode-incarnation.py` and `/private/tmp/gitrelay-opencode-identity.ar2y8r/probe11/result.json`. Session creation timestamps in these tests are not proof against clock changes. Automatic deletion cleanup remains a confirmed lifecycle gap; see [manual handling](integrations.md#opencode-v2). Separately, the adapter now retries a failed or prematurely ended event stream; local tests cover backoff and cancellation, not replay of events missed during the interruption.

An isolated package check after those code changes ran `npm pack --offline`, installed the resulting tarball globally with an empty cache and no optional dependencies, and exercised its CLI help and Codex `SessionStart` hook without `node_modules`. The archive included the source and compiled identity-migration module and the vendored TOML license. Its 122-file tarball SHA-256 was `b96d4dcf3f655ce763795e62b1fde06d95b0f13df2ed9140d984f75696a2ad7f`; evidence: `/tmp/gitrelay-package-verification.py` and `$TMPDIR/gitrelay-package-final.2f6qb_7s/result.json`. This is not a real-model or hosted CI check.

The later installer-digest snapshot was also checked with real pi `1.4.0` and OpenCode `2.1.2` hosts in isolated homes and state directories, without user credentials or models. pi detected and repeatedly installed the extension, registered three RPC sessions across two linked worktrees and another repository, selected only the two same-repository recipients, and preserved the old event after repository replacement and explicit fresh-state selection; uninstall and repeat uninstall preserved isolated settings. OpenCode detected, repeatedly installed and loaded its plugin, registered a native session, and uninstalled while preserving isolated configuration and relay state. Evidence: `/tmp/gitrelay-pi-digest-current.py`, `/tmp/gitrelay-opencode-digest-native.py`, `$TMPDIR/gitrelay-pi-host-isolation-rsbtmol_/result.json`, and `$TMPDIR/gitrelay-native-opencode-digest-1jgzp3h1/result.json`. The tested `installer-digest.ts` SHA-256 was `475380f2fd21fcb85e4137ca7b06c0ec1165ed4f490653d3681321ff98102ecb`. These checks do not establish real-model behavior, upgrades or all recovery windows.

An isolated source snapshot also passed offline global installation without `node_modules`, `npm pack --offline`, and offline global installation of the resulting tarball, with normal lifecycle scripts enabled. A packaged Codex `SessionStart` hook ran in a separate repository and found the vendored TOML parser without `node_modules`; a CLI install and uninstall preview used a simulated OpenCode version detector. The 120-file tarball SHA-256 was `49dfc148bda8e8c8bc452b5dcf983c8f9471caa55d69604d0ee0190dc8ba5d47`. These checks do not establish a real-client session or CI result.

An independent review reproduced a cross-repository isolation defect in the previous path-keyed implementation: after registering a session and leaving a marked message unread, replacing the Git common directory with an unrelated repository at the same path caused the same session identity to receive the old message. Reproduction against the old implementation was `node --experimental-strip-types /tmp/gitrelay-recreated-repo-repro.mjs`.

The new persistent-identity implementation rejects the old state until explicitly migrated or a fresh inbox is chosen. The current isolated regression verifies that the replacement cannot receive the old marked message and that the original event bytes remain intact. Separate migration tests and an independent CLI check verify that an explicitly claimed unread event is delivered once. Two independent SIGKILL experiments exercised copying and the interval after the ready file but before migration completion; after confirming the dead process and removing its stale lock, retry preserved the old source and completed the copy. These are process-interruption checks, not power-loss guarantees. The old client must remain disabled after migration, and external identities must be changed when a repository is replaced; see [migration](migration.md#repository-identity-and-existing-state).

## Codex existing user hooks feasibility (2026-10-27, Asia/Singapore)

In isolated Codex `0.164.0`, user `hooks.json` and inline hooks in the same layer's `config.toml` both ran; the host warned about the two representations. An experimental installer created the latter only when it did not already exist. After interactive `/hooks` trust, a real model received a marked event, but Codex also added trust, TUI and project settings to that file. The experimental uninstall then refused to remove the now-modified file, preserving it but leaving the integration installed. That incomplete installer path was removed. Evidence: `$TMPDIR/gitrelay-codex-existing-final-qfs76qnx/` and `$TMPDIR/gitrelay-codex-existing-test-vt_3ai_a/`; temporary credentials were deleted.

The official app-server `config/read` returned the parsed user TOML and a layer version. A `config/batchWrite` using `expectedVersion` rejected a preceding external semantic edit, but when two independent app-server processes used the same version concurrently, **both returned success in all 30 trials**. In a second 30-trial experiment where the writers changed different settings, both returned success in every trial and the final file was missing one change in 27. Replacing a hook event array also retained its values and root comments while dropping comments attached to its tables and fields. These experiments do not establish safe concurrent modification or lossless preservation of an existing configuration; they do not imply every concurrent edit fails. Evidence: `/tmp/gitrelay-config-race.py`, `$TMPDIR/gitrelay-config-race-3k1v48a3/`, `$TMPDIR/gitrelay-config-race-mu8lk3sa/`, and `$TMPDIR/gitrelay-config-comment-a5u0if_b/`. The managed installer continues to preserve and refuse an existing user `hooks.json` rather than overwrite it. See [integration details](integrations.md#automatic-setup) for the current boundary.

An independent review found that starting app-server just to inspect a user TOML can itself create SQLite and log files at paths configured by that user. The installer therefore parses base and existing profile TOML directly, without launching an app-server or copying configuration to a temporary home. A fixed-snapshot test with real Codex `0.164.0` rejected recognizable GitRelay hooks in both base and profile configurations, allowed an unrelated `echo GitRelay` hook, and kept TOML files and sentinel files under configured `sqlite_home` and `log_dir` unchanged. It did not use a model or credentials. Evidence: `/tmp/gitrelay-codex-static-real-probe.py`, `/tmp/gitrelay-codex-static-freeze-results.json`, and `$TMPDIR/gitrelay-codex-static-real-iq35t08x/hash-manifest.json`. The test does not establish detection of arbitrary custom wrappers or future profile changes.

## Claude Node path and settings concurrency checks (2026-10-27, Asia/Singapore)

In an isolated Claude Code `2.1.310` configuration, the original Node executable installed an instrumented runtime; a hard link to the same Node binary then ran the installer to upgrade to a second runtime. The host invoked the expected v1 and v2 hooks twice each, with exactly one enabled plugin. The endpoint was deliberately unreachable, so this verifies host hook execution and version selection, not a model response. The test script was `/tmp/gitrelay-claude-node-path-accept.mjs` and its temporary evidence was `$TMPDIR/gitrelay-claude-runtime-9Q3gfz/`. The source checksums for `src/cli/install-claude.ts` and `src/cli/install.ts` were `f05266601bf78c106a1ff8ffa6b931593a80962850f0e4cd60040bbe0e7d6f7c` and `3f74344e31877ad8b3ec9de48c73cb248e14b82db69431174c94c52f7f68a22a` respectively; these checks do not establish acceptance of later edits.

The same host-only test was repeated after the Claude child-process timeout and cancellation changes. It again observed `v1`, `v1`, `v2`, `v2` and one enabled plugin. The tested `src/cli/install-claude.ts` SHA-256 was `d67243e5d4105af32e342a4382036a332e1c37e9c135398d25040864aec6ab39`; `src/cli/install.ts` was unchanged from the previous check. Evidence: `$TMPDIR/gitrelay-claude-runtime-EKuWmp/` and the same script. No model interaction was used.

Separately, an isolated test ran Claude's native `plugin disable` while another process updated an unrelated `model` setting. In 12 of 40 timed trials, the command returned success but restored an older value. The test script was `/tmp/claude-race-probe.mjs` and the evidence was `$TMPDIR/claude-switch-race-Ueo3vy/`. This establishes a concurrent settings-write risk in the tested Claude version, not that every plugin operation loses data. GitRelay cannot serialize a separate process's settings writes; avoid concurrent editing during native plugin commands. This also prevents claiming that an automatic multi-plugin migration is transactionally safe.

A separate native `plugin update` experiment switched a local marketplace from a version 1 to a version 2 plugin. An already-running stream-json session continued to load the version 1 skill and hook, while a new session loaded version 2; user settings were byte-identical. This used a local mock model endpoint and does not establish real-model behavior. Evidence: `/tmp/gitrelay-claude-native-upgrade-session.py` and `$TMPDIR/gitrelay-claude-native-session-w31fn47r/`.

However, two real Claude `2.1.310` processes updating two different local plugins concurrently both reported success in all 20 isolated trials, while 14 final `installed_plugins.json` records retained one plugin's old version. This is a confirmed lost-update window in the tested host, not a claim about every version or plugin operation. Evidence: `/tmp/gitrelay-claude-dual-update.py` and `$TMPDIR/gitrelay-claude-update-concurrent-9sjx1tjg/`. GitRelay does not use native `plugin update` as an automatic migration while it cannot coordinate that shared host state with other processes.

An exploratory Claude `2.1.310` test replaced a default `skills/` symlink with another relative symlink whose target remained inside the plugin root. The original stream-json session retained its old skill content after the switch, while a new session loaded the new content; the host's settings hash remained unchanged. `claude plugin validate` accepted the plugin but warned that it did not validate the symlink target. This used a local mock model API, not a real model, and does not establish safe migration of an existing physical `skills/` directory or consistency with an in-flight session's runtime. The scenario is not implemented by GitRelay. Evidence: `/tmp/claude-default-skill-switch.py` and `$TMPDIR/claude-default-skill-switch-82bcayt3/`.

## Pi watcher persistence revalidation (2026-10-27, Asia/Singapore)

An additional isolated host-only check installed the current snapshot in pi `1.4.0` and started three RPC sessions: two linked worktrees of one repository and one independent repository. All three loaded the extension and registered; after they stopped, a uniquely marked send selected exactly the two sessions in the first repository, and the second repository had no matching event. The test used an empty isolated authentication file and did not call a model. It does not cover reuse of a deleted Git directory path, running-session delivery, recovery, or model behavior. Evidence: `/tmp/gitrelay-pi-host-isolation.py` and `$TMPDIR/gitrelay-pi-host-isolation-0117ld2h/result.json`; `src/adapters/pi/watch.ts` SHA-256 was `57d6e0755cc6053d4938e68298575250fdaeb46ae86f339ae224c275a39f230e`.

After the repository identity change, an isolated pi `1.4.0` host-only check repeated the three-client registration and recipient test. It then recreated the first repository at the same path: using the old session ID was refused until an explicit fresh-state choice, after which a real pi session registered in a different repository state, found no old event, and the old event bytes remained unchanged. The test used an empty authentication file without reading or refreshing user credentials and did not call a model. Evidence: `/tmp/gitrelay-pi-host-isolation.py` and `$TMPDIR/gitrelay-pi-host-isolation-edc69h7n/result.json`; `src/core/store.ts` SHA-256 was `a472c52e923748fdd7675743551e34bcb0da89b5db6e5a18ff15d70493e7ed56`. This checks registration and offline recipient isolation, not live delivery or real-model acceptance.

After the watcher was changed to check pi's native session file before acknowledging events, an isolated pi `1.4.0` RPC test installed and loaded the extension and registered the real session. Its OpenAI OAuth refresh returned `invalid_grant`; neither the baseline nor the later response contained a model answer. This attempt therefore **did not pass real-model acceptance** for the changed watcher. A temporary authentication copy was deleted after the test. A refresh request may rotate server-side credentials; the effect on the original authentication was not established, and no further refresh was attempted.

The same isolated native session recorded a message and an upstream event. After restarting the real pi RPC client without authentication, the extension read the existing session file and wrote two `delivered` receipts; the native file's bytes remained unchanged. This checks host-record and receipt recovery without a model, not that a model read or acted on either event. The tested snapshot's `src/adapters/pi/watch.ts` SHA-256 was `c55317e8c00c6bdf9cc615c1413ab433c4d3496fbb2711b9f467a6c6349eca3e`; `src/core/consumer.ts` was `f04430133e0ca33cace681710c61c8a2b05d28e388681d1349161560c1cac6a0`. The watcher changed again after that snapshot, so the check is not evidence for those later edits. Evidence: `$TMPDIR/gitrelay-pi-installer-dtk9os2z/` (`v1.stdout`, `native-noauth.stdout`, `source`, `sessions`, `state`) and `/tmp/gitrelay_pi_native_recovery_noauth.py`.

## Partial real-client checks (2026-10-26 UTC)

The initial manually configured checks exercised the working tree during active development, with isolated temporary repositories, worktrees, and state. No build hashes were captured for those initial checks; they do not establish acceptance of a particular release or of later changes. Event markers were generated after the baseline prompt and were not included in the follow-up prompts. The model responses, receipts, and preserved local edits were checked separately. Temporary credential copies were deleted.

After the installer implementations were frozen, pi, Claude Code, and OpenCode were retested from the same fixed source snapshot (`$TMPDIR/gitrelay-final-common-snapshot.1gODya/`); Codex's later authenticated test used a separate snapshot with the same common installer hash. The shared `src/cli/install.ts` SHA-256 was `91a7bd0436b6ac25d6283cb9da3da84af96fcdd2d3f79ac0b168e41193ba2992`; `dist/cli/install.js` was `977fdc62aecc8f97134035aef95991cbab4e2cde68a742ed49994b380d3bb763`. These are partial tests of that snapshot, not proof of every behavior or later change.

- pi `1.4.0`: installer and repeat install succeeded; session `install-65a5a598-908e-444b-ab3c-930ebedfd0a1` reported `UPSTREAM_06880ac54b7a4b33885e92870819724c` and `RELAY_f5978375b38b4de4acacacf536eb0f85`, with two stable delivered receipts. An instrumented test upgrade was confirmed through RPC command description `ACCEPTANCE_UPGRADE_d756be7366cc`, followed by model receipt of `RELAY_8399506dd158429da4cf487954325975`. Uninstall, repeat uninstall and reinstall preserved state, unrelated configuration and local edits. `src/cli/install-pi.ts` SHA-256 was `2ef2c3d010957db266dc49473d4e1ec29b1c02bb54ac3b88bcea474162ce27cd`. Evidence: `$TMPDIR/gitrelay-pi-installer-k0v5617t/` and `/tmp/gitrelay-pi-final-common.log`.
- Claude Code `2.1.310`: repeat install succeeded and the real plugin list showed enabled. Session `c749741c-5070-4f73-8a6c-5a29caefbac8` reported `UPSTREAM_31ac4316e3454f5ba2335bcfe92a077c` and `RELAY_abb5903ccf3a4928b4cd97f2051b8d2b`, with two stable receipts. An instrumented runtime upgrade was actually loaded and delivered `RELAY_UPGRADE_bdde0a116b01451d982adad8fd3d5619` to the same session, preserving old events, receipts, configuration and local edits. Constructed old-format state and a changed skill were separately rejected; these do not establish historical migration. `src/cli/install-claude.ts` SHA-256 was `e1577802e0463be92aaa1957503ec51095ca2c6c41c57082cc338cdbfd01e415`. Evidence: `$TMPDIR/gitrelay-claude-installer-m1s8olja/` and `/tmp/gitrelay-claude-final.log`.
- OpenCode `2.1.2`: install, uninstall, reinstall and repeat install succeeded. Session `ses_e86631bcfffeneKTr5aHDWkeM4` reported `UPSTREAM_320f5cde5e49416597351d824ec4c7cd` and `RELAY_fe0f8589bb1c46319915fd79bf3ba83f`, with two injected messages and two receipts stable for 12 seconds; the local edit was preserved. `src/cli/install-opencode.ts` SHA-256 was `90b487f9fdb99acaeb7c91eb52e8b1123ddb41f5cfa3581581958dca674267c1`. Evidence: `$TMPDIR/gitrelay-opencode-final-vsp6d88l/` and `/tmp/gitrelay_opencode_final_acceptance.py`.

These upgrades used instrumented test variants, not published-release migrations. The Codex authenticated installation, interactive trust, and upgrade evidence is recorded below. Other crash windows, all platform combinations, and other operating systems remain unverified.

| Client and entrypoint | Session and observed result | Local evidence |
| --- | --- | --- |
| pi `1.4.0`, `openai/gpt-6.1-sol`, RPC with `src/adapters/pi/index.ts` | `accept-b851e3c1-1878-4b51-b040-039b677035a1` received `UPSTREAM_46321900a4fc4d219bb93a599642f32e` and `RELAY_d3af3b698e7d4e3fba4b242cf21c8722`; two delivered receipts, no duplicate on subsequent polls. After a process restart, a separately sent `RELAY_6a02a0a2a3f44f23ba30ba86d5bdbd99` woke the same session and was delivered. | `$TMPDIR/gitrelay-pi-current-ezqonl3m/` (`pi.stdout`, `restart.stdout`, `state`); `/tmp/gitrelay_pi_acceptance.py`, `/tmp/gitrelay_pi_restart.py` |
| Codex CLI `0.164.0`, `gpt-6.1-sol`, isolated user hooks with `exec` / `exec resume` | `01a17976-3922-78f1-bdcc-ed51d29e4451` reported `UPSTREAM_45A839442D4640B0A69453141D20AA8C` and `RELAY_7756AB1A0DC64645AD3335DC25F0FA8B`; two delivered receipts remained unchanged on a further resume. Reviewed hooks were run with the one-time `--dangerously-bypass-hook-trust` flag; model tools were read-only. | `$TMPDIR/gitrelay-accept-codex.F0ia3f/` (`baseline.jsonl`, `delivery.jsonl`, `dedup.jsonl`, `state`, `receipts-before`, `receipts-after`) |
| Claude Code `2.1.310`, `deepseek-v4.1-flash`, hooks supplied by isolated `--settings` | `85460853-ad11-4fe2-9c6f-9074b1db68b4` reported `UPSTREAM_55e6dc1b647c44e7b08264fe058568a4` and `RELAY_30f7488513404955b21fd456abba552a`; two delivered receipts remained unchanged on a further resume. The client warned about an unrecognized model, but the configured service returned a successful response. | `$TMPDIR/gitrelay-claude-current-_z4y9k_q/` (stdout/stderr and `state`); `/tmp/gitrelay_claude_acceptance.py` |
| OpenCode `2.1.2`, `amr/deepseek-v4.1-flash`, isolated loopback `opencode serve` and project plugin | `ses_e868848a8ffeYeZFz0MN8bWpfq` woke while idle and reported `UPSTREAM_F532806A102647B296EC563D20FA823B` and `RELAY_671AE78552B84930B82921FC6BFB0C2F`; two delivered receipts remained unchanged and session context contained one GitRelay injection after subsequent polling. | `$TMPDIR/gitrelay-accept-opencode.xz1pge/` (`baseline.jsonl`, `context.json`, `context-after.json`, `state`, `receipts-before`, `receipts-after`) |

The sender in these checks was the CLI using a separate identity, not a second running coding agent. These checks do not cover installer detection and installation, upgrade or uninstall, busy-session races, forced termination, all recovery windows, cross-repository isolation, or all combinations of real agents. They are partial observations, not full four-platform acceptance. Codex and Claude Code require a subsequent hook for delivery to an already idle session. Temporary evidence may be removed by the operating system.

An additional isolated test used real Claude Code `2.1.310` and pi `1.4.0` sessions in two worktrees of the same repository. Claude invoked `git-relay send` through its Bash tool; pi woke and reported `RELAY_663d1acd6dcf4beb974296c74c91bb02`. Pi then invoked a broadcast through its Bash tool; Claude resumed the same session and reported `RELAY_be62af0116334a67a3882bb406181c46`. Both events had a delivered receipt for the respective receiving session and the local edit was preserved. An independent repository using the same state root had a CLI consumer registered; its checks before and after the sends were empty. This supports isolation for that CLI consumer, not a third real-client isolation test. A preceding pi message with `--file` was filtered as irrelevant because Claude's worktree had no matching local edit; the successful reverse-direction test used an unfiltered broadcast. Evidence: `$TMPDIR/gitrelay-pi-current-ezqonl3m/cross-pi.stdout`, `cross-claude-{baseline,send,receive}.stdout`, and `state`; the procedure is `/tmp/gitrelay_cross_agents_broadcast.py`.

A further one-way isolation check used two independent Git repositories sharing an isolated state root. Real Claude Code session `16fabbbb-32e2-4cef-a74b-3cf55aa18c83` in repository A and real pi session `crossrepo-ee009dd2-8e1d-44be-a6a7-7d9d072688cb` in repository B were both registered. A CLI sender in A published `CROSSREPO_9bd8f2ee38c548cc943a22b89fa3dae4`; the recipient snapshot contained only A, whose model reported it and received a delivered receipt. After 12 seconds of B polling, a real B follow-up reported no event; six seconds later, B's history and repository state contained neither that marker nor its event or receipt. The repositories were independent even though their baseline commits happened to have identical hashes. Evidence: `$TMPDIR/gitrelay-crossrepo-real-m0hre9i_/`, `/tmp/gitrelay-crossrepo-real.log`, and `/tmp/gitrelay_real_crossrepo_acceptance.py`. This used manually configured entries and a CLI sender; it does not establish every client combination or isolation over unlimited time.

After the OpenCode adapter changes, a separate real `2.1.2` session (`ses_e8683cf9effeR5GTNAfTu0NgPn`) loaded the manually configured project plugin and reported `RELAY_ee16c874044545df889757d9c5cc48aa` and `UPSTREAM_0e3edfac752d4e019fba629e4acf5a79` in separate responses. Both events had delivered receipts; after 12 seconds the receipts were unchanged and the host context contained exactly two GitRelay messages, one per event. The receiving file retained its local edit. The complete `dist` JavaScript hash manifest was unchanged during the test; `dist/adapters/opencode/index.js` had SHA-256 `42adce72d51dc5ef8056eadb331dd41530d2292749ddc79edba503664389fbb7`. Evidence: `$TMPDIR/gitrelay-opencode-final-k80_p_z0/` (`baseline.jsonl`, `context.json`, `context-after.json`, `state`, `build-hashes-before.json`, `build-hashes-after.json`). The test script initially asserted the previous implementation's one-message batch, so it exited at that assertion; inspection confirmed the intended two event messages and the other checks. This does not establish installer, busy-session, or failure-recovery acceptance.

The installer-generated OpenCode entry was then exercised in a separate isolated run. `install --platform opencode` detected `2.1.2` and reported `configured`; the real host loaded the generated `config/opencode/plugins/git-relay.js`. Session `ses_e868300a6ffesBJeGey7gOWTmI` reported `UPSTREAM_922e1e7770ba45d1b124ef52c8d80cc8` and `RELAY_3b1b0f821450452ea5be63b7018d8d56`; both receipts remained unchanged over 12 seconds, with two event messages in the session context. The complete `dist` JavaScript hash manifest remained unchanged during the run, including the adapter hash above. Reinstall and uninstall using the same XDG paths succeeded, preserved a separately created unrelated configuration value, and removed the entry. These checks did not test upgrading to a different release. Switching between the equivalent macOS `/private/var/...` and `/var/...` spellings initially caused an invalid installation record; after path normalization was added, install, reinstall and uninstall with alternating spellings succeeded in the same isolated configuration. Evidence: `$TMPDIR/gitrelay-opencode-final-l3tph602/` (`install.json`, `reinstall.json`, `uninstall.json`, `alias-install.json`, `alias-reinstall.json`, `alias-uninstall.json`, `server.err`, `context.json`, `context-after.json`, `state`, and build hash manifests). The harness exited nonzero after the model assertions because its credential cleanup tried to unlink the plugin directory; the credential files were subsequently removed explicitly. The alias retest exercised the later installer source; the model session used the earlier installer build.

After the later OpenCode installer changes, an additional isolated `install --platform opencode` run and real session `ses_e868154acffecvP9LVVtVkBf7a` reported `UPSTREAM_82a748e68e384fd0afb620ad0d0b900c` and `RELAY_585e95a5f85d40b0bbe8f60d92e442e0`. Two delivered receipts were unchanged after 12 seconds and the context contained two injected messages. The harness exited successfully; the source and build hash manifest was identical before and after the run. Its hashes include `src/cli/install.ts` `f75a9f5774f48cbb597caf7fa2d09eb0c28b9b8da24e808a24e1ae846436a034`, `src/cli/install-opencode.ts` `095b16bd92eba4bd21f91a8a47db3ece78919fd4df37c6dd2669293140fff026`, and the adapter hash above. Evidence: `$TMPDIR/gitrelay-opencode-final-120wsiyg/` and `/tmp/gitrelay_opencode_final_acceptance.py`.

A subsequent fixed source snapshot exercised install, uninstall, reinstall, and repeat install before starting real OpenCode `2.1.2`. Session `ses_e867dbdbbffe6KwfqH9z9PIc2G` reported `UPSTREAM_d15931cc103241b389b9049264bda60e` and `RELAY_8db48258d120461dadd9e901006498d5`; two delivered receipts remained unchanged for 12 seconds, with two injected messages and the local edit retained. Source and build hash manifests matched before and after. The snapshot's `src/cli/install.ts` SHA-256 was `2ab209318a6ab9dd4a01c2ea48863a996ed9be558ed5f018c76277bf1f9978b5`; `src/cli/install-opencode.ts` was `b6e6f028e9b170f5499272bc21bae30c900ea893a1bf4e84b5caec7aa389e4f6`. Evidence: `$TMPDIR/gitrelay-opencode-final-tqydwjr3/`, source snapshot `$TMPDIR/gitrelay-snapshot.pm2cgW/`, and `/tmp/gitrelay_opencode_final_acceptance.py`.

The same isolated installation was then upgraded to a valid test runtime that writes a marker only to a designated test path when loaded. The real host wrote `UPGRADE_10aed36f12304e559eb7338d142913ee`, confirming it loaded the new runtime; adapter SHA-256 changed from `42adce72d51dc5ef8056eadb331dd41530d2292749ddc79edba503664389fbb7` to `aeb2e08ac65c16d9182ad5748cb5f8f133b0f62e3cbcb24b44fef6b9a3a34fc0`. The same session reported new markers `UPSTREAM_2252556211e4481db944fb3f375f41ad` and `RELAY_3a17c5711b2f4e7f93091740e7cc8bb5`; existing event and receipt files stayed byte-identical, all six receipts remained stable for 12 seconds, and the local edit was preserved. This tests an instrumented runtime upgrade, not migration between published releases. Evidence: the preceding directory's `upgrade-*` files, `$TMPDIR/gitrelay-upgrade-snapshot-82cu__3_/`, and `/tmp/gitrelay_opencode_upgrade_acceptance.py`.

After pi was added to the unified installer, OpenCode was rechecked from a new isolated snapshot. Install, uninstall, reinstall, and repeat install succeeded; real session `ses_e867b69f8ffeSN5X4tyG0DYzeY` reported `UPSTREAM_60366a4983f341769864279506d221d8` and `RELAY_0353cf9e9baa42eda907be2ff27b9707`. Both delivered receipts remained unchanged for 12 seconds, exactly two event messages appeared, and the local edit was preserved. The test exited successfully with matching source/build manifests before and after. The snapshot's `src/cli/install.ts` SHA-256 was `803c9b2515f2e49cfdf66c25b750bea12e2cf8c1878951c50d2462304c2c2353`, and `src/cli/install-opencode.ts` was `b6e6f028e9b170f5499272bc21bae30c900ea893a1bf4e84b5caec7aa389e4f6`. Evidence: `$TMPDIR/gitrelay-opencode-final-2x9gn6u1/` and `$TMPDIR/gitrelay-snapshot.1kPG3F/`.

A separate real OpenCode busy/restart check used an isolated installed entry and `amr/deepseek-v4.1-flash`. The model's Bash tool wrote a start marker, ran `sleep 15`, and wrote an end marker. `RELAY_BUSY_ea927a6c66144e519ef2d04dbce7023b` was published 0.063 seconds after tool start; the model reported it after the tool ended. The delivered receipt was written before tool completion, reflecting durable host queue acceptance rather than completed model processing; after two further polls it was unchanged and the event appeared once in the session history. After a clean server stop, `RELAY_OFFLINE_d97bf1c3bac744f1a2f74403f5437f94` was sent. Following restart and resumption of session `ses_e8677e89effeU8sR5030x2pVSJ`, the initial prompt arrived before the polling interval and reported none; after the five-second poll the model automatically reported the offline marker and its receipt was delivered. Snapshot SHA-256: `src/adapters/opencode/index.ts` `b9cb1ef4016f22c6ccb938e8c9f505dccce83873108c22ce93eb4e21ab3e5942`, `dist/adapters/opencode/index.js` `42adce72d51dc5ef8056eadb331dd41530d2292749ddc79edba503664389fbb7`, and `src/cli/install-opencode.ts` `90b487f9fdb99acaeb7c91eb52e8b1123ddb41f5cfa3581581958dca674267c1`. Evidence: `$TMPDIR/gitrelay-opencode-busy-0_f8i6uw/`, `/tmp/gitrelay-opencode-busy.log`, `/tmp/gitrelay_opencode_busy.py`, and `/tmp/gitrelay_opencode_recover.py`. Forced termination and crash windows were not covered.

A separate Claude Code `2.1.310` test used the unified installer from an isolated source snapshot. Two `install --platform claude-code` invocations reported configured, and `claude plugin list` showed the plugin enabled. Session `8bdb214a-9779-47d7-aa7d-576a1d4caed3` registered through the installed plugin and reported `UPSTREAM_da7829692b73426cb891e3a561d5db3f` and `RELAY_b8782f8b357c4b3b9e6565d529ebf6ff`; both delivered receipts remained unchanged on a further resume. The local edit remained intact. Uninstall and repeated uninstall reported `removed` and `not-managed`; the client plugin list was empty, unrelated settings and GitRelay state were preserved, and the marketplace snapshot was retained as reported. Upgrade to a different release was not tested. Installer snapshot SHA-256: `src/cli/install.ts` `f75a9f5774f48cbb597caf7fa2d09eb0c28b9b8da24e808a24e1ae846436a034`, `src/cli/install-claude.ts` `85cee8f4a1611b43ae24cbe145f9bacbecc4852ce28321668e4952951d6fea16`, `dist/cli/install.js` `ada09802399d2a2d45ac9c29a175d3d8721a73df86cb14237cc75a6265f98c4e`, and `dist/cli/install-claude.js` `b07e85a1bbb8ce2e7072da7831a9280d295ab4536f80e35ae636739e09bb2a1f`. Evidence: `$TMPDIR/gitrelay-claude-installer-pyb8kivm/`, `/tmp/gitrelay_claude_installer_acceptance.py`, and `/tmp/gitrelay_claude_uninstall.py`. These hashes identify the tested snapshot and do not imply verification of later changes.

In a separate Claude busy/restart check using that installed snapshot, a real Bash tool created start and end markers around `sleep 15`. The tool started at 1793040428.4755, `RELAY_BUSY_fc45cc4196bd4d1fbab14bd16d3559b4` was sent at 1793040428.5336, and the tool ended at 1793040443.4624. The model reported the marker in its response and the event had a delivered receipt, unchanged on a subsequent resume. After the process exited, `RELAY_OFFLINE_f1814b4f660a412692d4f63124b162ca` was sent; resuming session `732507fa-1199-4fbb-99be-bb1ca3d626ed` caused the model to report it and a delivered receipt was written. The output does not identify whether PostToolUse or Stop delivered it. This was a clean exit, not a forced termination. Snapshot `dist/adapters/hooks.js` SHA-256: `72883a4ba6785583b5feed62c7da0c2914dc9e75e10de308bdeaae0b526588fc`. Evidence: the Claude installer directory's `busy-*.stdout`, `/tmp/gitrelay-claude-busy.log`, and `/tmp/gitrelay_claude_busy.py`.

A separate Codex CLI `0.164.0` test used manually configured isolated user hooks and a real model session. After `sleep 15` entered `command_execution` in-progress, `RELAY_BUSY_07b6b73c4c454073b23733adbe9f1aad` was published 0.064 seconds later; after the tool completed, the model reported it and its event received a delivered receipt. Once the process exited, `RELAY_OFFLINE_363a9070cbeb45b9958d1c61834df267` was sent; resuming session `01a17989-8e17-7c81-811b-3939c2590618` caused the model to report it, and a further resume left both receipts unchanged. The local edit was preserved. This does not distinguish PostToolUse from Stop and does not test forced termination. The full `dist` JavaScript manifest was unchanged during the run; `dist/adapters/hooks.js` had the same `72883a4ba6785583b5feed62c7da0c2914dc9e75e10de308bdeaae0b526588fc` SHA-256. Evidence: `$TMPDIR/gitrelay-codex-busy-52kekkob/` and `/tmp/gitrelay_codex_busy_acceptance.py`.

Additional isolated SIGKILL checks covered one window per host, not exactly-once model processing:

- Claude Code `2.1.310`: `RELAY_KILL_4603c4a269e743c2a0a928bcf2771394` was published 0.0613 seconds after a real `sleep 30` tool started. Before killing only the test process group, the tool was still running and the event had no receipt or client output. The process exited `-9`; resuming session `1a81c501-11d9-43f4-b40d-0fa4453432ba` produced the marker and a delivered receipt. A further resume left the receipt unchanged and the local edit intact. Evidence: `$TMPDIR/gitrelay-claude-kill-hkdx2q0x/` and `/tmp/gitrelay_claude_kill.py`; the tested `dist/adapters/hooks.js` hash was `72883a4ba6785583b5feed62c7da0c2914dc9e75e10de308bdeaae0b526588fc`.
- Codex `0.164.0`: `RELAY_KILL_020ee2ca580d44f4966e0502d75b839a` was published 0.0655 seconds after `sleep 30` began; it had no receipt and had not appeared in client output before only the isolated process group was killed with SIGKILL. Resuming session `01a1799b-85a1-7c52-ad54-270d59bc8dd6` produced the marker and a delivered receipt, unchanged on another resume; the local edit was preserved. This used manually configured hooks and one-invocation trust bypass. Evidence: `$TMPDIR/gitrelay-codex-kill-qcqw49xz/` and `/tmp/gitrelay_codex_kill_acceptance.py`; the complete `dist` hash manifest was unchanged during the test.
- OpenCode `2.1.2`: `RELAY_KILL_f8fc33f978b848c39d9e3470c560fe72` was published about 0.060 seconds after a real `sleep 30` tool began. Roughly 4.85 seconds later, the host queue had accepted it and a delivered receipt existed, while the tool was still running and the model had not reported it. Only the isolated server process group was killed about 0.014 seconds later. On restart of session `ses_e8664630affehAX9y0i7kRExZS`, the model reported the marker; after 12 seconds the history contained one event injection, the receipt remained byte-identical, and the local edit was intact. Evidence: `$TMPDIR/gitrelay-opencode-sigkill-fcog4z1b/`, `/tmp/gitrelay-opencode-sigkill.log`, and `/tmp/gitrelay_opencode_sigkill.py`; tested `dist/adapters/opencode/index.js` SHA-256 was `42adce72d51dc5ef8056eadb331dd41530d2292749ddc79edba503664389fbb7`.

The unified Codex installer was tested with a controlled authentication workaround. In an isolated, initially unauthenticated `CODEX_HOME`, install and repeat install returned `pending-trust`. A temporary authentication copy was then supplied to Codex `0.164.0`, and reviewed hooks were run with the one-invocation `--dangerously-bypass-hook-trust` option. Session `01a1798f-d92f-7e02-9e34-47ad815a44f9` reported busy marker `RELAY_BUSY_71c56093de634c619231044d602ce9ae`, sent 0.348 seconds after a real `sleep 15` tool started, and offline marker `RELAY_OFFLINE_f4d0cdf4aeeb4055893007d561fbcbab` after resume. Both events had stable delivered receipts; uninstall and repeat uninstall after removing the authentication copy returned `removed` and `not-managed`, preserving the config and state. The hashes of the fixed snapshot were `src/cli/install.ts` `3eaad1fb036eac049228ab7209d11d213adbbf9bb1fd96281ffcaef549d15567`, `src/cli/install-codex.ts` `cf2f1a1830059839a162cfe34d2ddf504a8054e4ab6df8f01cd95a50a73bfc66`, and `dist/cli/install-codex.js` `f49d8718197d22971482579aa5b3b89c5407566420645d1cdabd8234d4f82558`. Evidence: `$TMPDIR/gitrelay-codex-busy-vamkpofw/` and `/tmp/gitrelay_codex_installer_acceptance.py`.

Using that same workaround, a separate fixed-snapshot upgrade test installed an instrumented valid runtime and verified its hook wrote a test-only loading marker. The same real session reported `RELAY_BEFORE_abe7b971b1cf4114a2ae180fbd105eff` before and `RELAY_AFTER_3d59424276ff4885a0a1b7b8358626ba` after upgrade; old receipts remained byte-identical and the new delivered receipt stayed unchanged on a further resume. Local edits were preserved. This is a test runtime upgrade, not a migration between published versions. Evidence: `$TMPDIR/gitrelay-codex-upgrade-6dof1d3s/` and `/tmp/gitrelay_codex_upgrade_noauth_install.py`.

These Codex installer checks do **not** establish normal authenticated installation or interactive trust approval. With authentication present, the real `codex plugin list --json` took 45.55 seconds to succeed, exceeding this tested installer's 10-second inspection timeout; it refused installation without changing hooks. Normal interactive `/hooks` review was not exercised. The unauthenticated-install workaround was used only inside isolated test homes.

After the inspection timeout and cancellation handling were changed, a new fixed snapshot was tested with authentication present throughout installation, repeat installation, and uninstall. The first install took 37.513 seconds and both installs returned `pending-trust`. With the one-invocation trust bypass, real session `01a17996-c496-7f30-9e2d-10ce382d4c64` reported `RELAY_BUSY_a9f0683eadd14a3782a14c80f9b21812`, published 0.390 seconds after `sleep 15` started, and after resume reported `RELAY_OFFLINE_3a127350e4b343b4a848deb03f66c52c`. Both delivered receipts remained unchanged on a further resume; local edits and config/state were preserved. Uninstall and repeat uninstall returned `removed` and `not-managed`. This verifies the previously slow authenticated path in this environment, not interactive `/hooks` approval or queries exceeding the new bound. The complete source/build hash manifest was stable during the run; it includes `src/cli/install.ts` `91a7bd0436b6ac25d6283cb9da3da84af96fcdd2d3f79ac0b168e41193ba2992`, `src/cli/install-codex.ts` `17ed35d2bac9625e5c66222d68f7e94dd58cac43fb63a71ea312201e300bdb6f`, `dist/cli/install.js` `977fdc62aecc8f97134035aef95991cbab4e2cde68a742ed49994b380d3bb763`, and `dist/cli/install-codex.js` `d6acc056b4625508cd6e82e14279196d6adb733367248f544b9eb6c863166cd3`. Evidence: `$TMPDIR/gitrelay-codex-busy-uiw7y8oe/` and `/tmp/gitrelay_codex_authenticated_acceptance.py`.

After the subsequent Node health-check change, the authenticated test was repeated from another fixed snapshot. First install took 39.031 seconds, repeat install returned `pending-trust`, and a one-invocation trust bypass allowed session `01a17998-ff91-71d1-920c-cbaa84cace09` to report `RELAY_BUSY_5fefa1aa9359488cb7f7548696cb340d` after a real busy tool and `RELAY_OFFLINE_a074fa2792854573b019714c9c8b4e4e` after resume. Both delivered receipts remained unchanged on a further resume; authenticated uninstall and repeat uninstall succeeded while config, state, and the local edit were retained. The source and build manifest was stable during this run. `src/cli/install-codex.ts` SHA-256 was `494e3a0e74ec83f90d334916cfefdde2b79f183a0d8193682a0e0c64fe8d8064` and `dist/cli/install-codex.js` was `230167a375c114a45c2a0286988e2f98402e98766e2de4bc7762f88e73af8c8d`; the common installer hashes matched the preceding run. Evidence: `$TMPDIR/gitrelay-codex-busy-0ads66_r/` and `/tmp/gitrelay_codex_authenticated_acceptance.py`. Interactive `/hooks` approval and forced termination were not covered.

The same fixed snapshot was used in a separate authenticated upgrade test without removing or switching credentials: initial install took 37.885 seconds, and upgrading to an instrumented valid test runtime took 2.285 seconds; both returned `pending-trust`. With one-invocation trust bypass, session `01a1799a-c880-7ff1-bd79-892b54143b8b` reported `RELAY_BEFORE_ad1eca8c9ad044df89a6b167d8370fea` before upgrade and `RELAY_AFTER_2a598629e65f49698398f17d2e5565d4` afterward. The new hook wrote six test-only loading markers; old receipts were byte-identical, the new event had a delivered receipt, and a further resume did not change receipts. Local edits were retained. This is an instrumented test runtime, not an upgrade between published releases. The installer source and build hashes match the preceding run; `dist/cli/main.js` SHA-256 was `c5906df317315c400572ece287750236da718e0e4899f8541282e21cffa32b0f`. Evidence: `$TMPDIR/gitrelay-codex-upgrade-vxqrfbqx/`, `/tmp/gitrelay-codex-upgrade-authenticated.log`, and `/tmp/gitrelay_codex_upgrade_authenticated.py`. Interactive trust approval remained untested.

An additional isolated Codex CLI `0.164.0` TUI test exercised the actual interactive trust path. The installer reported `pending-trust`; the TUI presented four hooks requiring review. After the generated commands were inspected, the `/hooks` review screen's trust-all action changed them to active. No trust-bypass option was used. Session `01a179a1-c090-7a01-b9f8-438c3456ac8e` registered and reported `RELAY_96DC21C0E3404E01970D148F91D786C8` and `UPSTREAM_EC2710D44EA54DFA98C64AAF0A840A82`; both receipts were delivered and their hashes stayed unchanged on the next prompt. The local edit remained intact, the TUI exited normally, and the temporary authentication copy was deleted. The tested `src/cli/install-codex.ts` SHA-256 was `494e3a0e74ec83f90d334916cfefdde2b79f183a0d8193682a0e0c64fe8d8064`. Evidence: `$TMPDIR/gitrelay-codex-trust.XhQWc5/` (`install.json`, session JSONL, `state`, markers and receipt hashes); the interactive screen actions are recorded in the local test tool transcript. This checks trust-all for the generated user-level hooks, not every trust dialog or project-level hook discovery.

The later Claude stable-launcher snapshot was also tested with Claude `2.1.310` and `deepseek-v4.1-flash`: repeat install succeeded, the actual plugin list showed enabled, and session `8a785776-0d49-4c3a-a3e2-37754ab50b44` reported `UPSTREAM_7ffe02a626e2489bac1ad30a4c44faa8` and `RELAY_93e0a157f58f4f9fa8794d14523afbd0` with two stable delivered receipts. An instrumented valid test runtime wrote `UPGRADE_4d5c02b64df54b5f82dc91498212b3c5` when the actual host loaded it; the original session then reported `RELAY_UPGRADE_8d4cc139699348a6ab4f7954c05944c1`, with old events/receipts preserved and a third receipt. Unrelated configuration and local edits were preserved. Separately, a modified skill and a constructed old-format journal were rejected without overwriting them; the latter is not a historical installation migration test. The model emitted an `unrecognized_model` warning but returned successful responses. Snapshot SHA-256: `src/cli/install.ts` `3eaad1fb036eac049228ab7209d11d213adbbf9bb1fd96281ffcaef549d15567`, `src/cli/install-claude.ts` `e1577802e0463be92aaa1957503ec51095ca2c6c41c57082cc338cdbfd01e415`, `dist/cli/install.js` `c117d84b7de14bb1858fbe27e1c4669824b4548e49e92e2051f6e4aba3a7048a`, and `dist/cli/install-claude.js` `c196deaec6ddde19d44308e4853c568d84afac297e764843f90211dac5d02528`. Evidence: `$TMPDIR/gitrelay-claude-installer-68csh2sc/`, `/tmp/gitrelay-claude-latest.log`, and `/tmp/gitrelay_claude_latest_acceptance.py`. Published-release migration and all crash windows remain unverified.

An isolated pi `1.4.0` installer test configured the platform twice; the real client discovered the installed extension and skill. Session `install-bc403ac8-25d5-4726-8811-19f8735e8f6d` automatically reported `UPSTREAM_ebb3d37d94e9462f9b1e1e94516cc9ce` and `RELAY_8915febb77ea4f1da2f2c3155786af20`, with two delivered receipts unchanged on subsequent polls. An upgrade to an instrumented `0.1.1-acceptance` test variant changed the installed revision; the real client's RPC `get_commands` returned `ACCEPTANCE_UPGRADE_4a61e7e0f7a8`, proving the new extension loaded. After restarting the same session, the model reported `RELAY_355f91f83dee485f84cf58c98302a902` with a third delivered receipt. Uninstall and repeat uninstall returned `removed` and `not-managed`; state and unrelated configuration were retained, and the real client discovered the entry again after reinstall. The upgrade variant is not a published release; busy-session and forced-kill scenarios were not covered. Snapshot SHA-256: `src/cli/install.ts` `803c9b2515f2e49cfdf66c25b750bea12e2cf8c1878951c50d2462304c2c2353`, `src/cli/install-pi.ts` `8131a6f079061026ad41a5f2a823fc3d2c719970c63a5d421ec216f59320927d`, `dist/cli/install.js` `f48a88980f1b5b081a9ad0b41dfabeb0a9c46fef1a9ca4bfb24542c417390249`, and `dist/cli/install-pi.js` `ee48a02113c09f5b739c761320c447b00861e588b34b6dc032852ff0a6a72530`. Evidence: `$TMPDIR/gitrelay-pi-installer-mxxaxeo5/` and `/tmp/gitrelay_pi_installer_acceptance.py`.

A separate real pi busy/restart check used that installed test upgrade. A Bash `sleep 15` tool emitted `tool_execution_start` at monotonic time 11.9788 seconds; message event `RELAY_BUSY_d0a1191da39348278036f4b574c288b0` was published at 12.0689, and `tool_execution_end` occurred at 27.0138. The model then reported the marker, the event had a delivered receipt, and two further polls produced only one custom-message start for it. After stopping pi, `RELAY_OFFLINE_581a0c1ff39843b69d4dee63908d92f8` was sent; restarting session `busy-6168b397-174e-441e-ab40-46f04374f279` automatically caused the model to report it and generated a delivered receipt. Evidence: the same directory's `busy.stdout` and `busy-restart.stdout`, and `/tmp/gitrelay_pi_busy_acceptance.py`. This checks one busy tool and clean process restart, not forced termination or every race.

One separate pi forced-termination window was tested using the same isolated test upgrade. After the real client's Bash `sleep 30` tool started, `RELAY_KILL_f526bfb51e264479964a716e739bc9ae` was published 0.084 seconds later. Before termination, the event had no receipt and had not appeared in the client output. Only the temporary pi test process group was sent SIGKILL; it exited `-9`. Restarting the same session `kill-20a813ef-e19a-4432-83cc-bd41e4bed24d` led the model to report the marker; a delivered receipt existed after 12 seconds and its persistent session JSONL contained exactly one corresponding custom message. The restart stream did not contain a separate message-start event, so the persistent session was used for the count. Evidence: the same directory's `kill-before.stdout`, `kill-restart.stdout`, `sessions`, and `state`, plus `/tmp/gitrelay-pi-kill.log` and `/tmp/gitrelay_pi_kill.py`. This covers an event published but not yet queued or acknowledged at termination, not every crash window or exactly-once model processing.

The pi installer was retested against a later fixed source snapshot. Initial install and repeat install succeeded, and the model reported `UPSTREAM_54b6419fa6dc44fc869fff4fbb031469` and `RELAY_967d53f6a2f349dba2721e6d26ce783e`, with two stable delivered receipts. An instrumented test upgrade was actually loaded, as shown by the RPC command description `ACCEPTANCE_UPGRADE_63118ba60aef`; the restarted original session then reported `RELAY_2d5bc69ae4c048a6850d188a434be647` with a third receipt. Uninstall, repeat uninstall, and reinstall succeeded while state, unrelated settings, and local edits were preserved. This remains a test-variant upgrade, not a published-release upgrade. Snapshot SHA-256: `src/cli/install.ts` `46da21c2f00f225a50f475e17999b2d894b60cf3b7ec38e7b7ea05be61ada380`, `src/cli/install-pi.ts` `2ef2c3d010957db266dc49473d4e1ec29b1c02bb54ac3b88bcea474162ce27cd`, and `src/adapters/pi/index.ts` `359ffb6c6d350b1bdd50169caa84e30c5bd098c416e0067595b33af5202b7689`. Evidence: `$TMPDIR/gitrelay-pi-installer-ppnpb_wy/` and `/tmp/gitrelay-pi-installer-latest.log`.

## Real-client acceptance (2026-10-25 UTC)

All four clients used real installed programs and models, not mock clients. Each ran in an isolated temporary repository/state directory. The receiving worktree retained local edits; the sender then committed a random `UPSTREAM_*` marker and sent a random `RELAY_*` message with `--file ./shared.txt`. Neither marker appeared in the initial user prompt.

Pass criteria: the original session's model accurately read both markers; both events had independent `delivered` receipts; another check neither redelivered nor rewrote receipts; local file content remained unchanged. Summaries and tested build hashes are in [`acceptance-results.json`](acceptance-results.json).

| Client | Version | Model | Actual entrypoint | Result |
| --- | --- | --- | --- | --- |
| pi | `1.4.0` | `openai/gpt-6.1-sol` | `pi --mode rpc` with native extension; automatic wake-up in the same idle process | Passed |
| Codex CLI | `0.164.0` | `gpt-6.1-sol` | Isolated `CODEX_HOME/hooks.json`; `exec`, then `exec resume` with the same ID | Passed |
| OpenCode | `2.1.2` | `amr/deepseek-v4.1-flash` | Real v2 `opencode serve` with Promise plugin; automatic wake-up in the same idle session | Passed |
| Claude Code | `2.1.310` | `deepseek-v4.1-flash` | Hooks via `--settings`; `--session-id`, then `--resume` with the same ID | Passed |

Raw local evidence was under `$TMPDIR` (temporary directories may be removed by the OS and are not runtime dependencies):

- `worktree-relay-pi-nSYj1w/`: RPC stream, session JSONL, state, and results.
- `worktree-relay-codex-8129TM/`: JSONL from three CLI invocations, isolated hooks, state, and results.
- `worktree-relay-opencode-VtZ8Ob/`: v2 session context, service logs, state, and results.
- `worktree-relay-claude-code-NkMoYb/`: three CLI invocation outputs, state, and results.

Configuration and safety boundaries:

- No global user settings changed, existing services stopped, or real projects merged/cleaned. Existing authentication was used; Codex borrowed an authentication copy in a `0700` temporary directory and deleted it afterward.
- Codex used a one-time `--dangerously-bypass-hook-trust` only for reviewed package hooks; model tools remained read-only. Normal installs require `/hooks` review. Temporary-worktree project hook discovery failed; user-level hooks passed. These are distinct results.
- OpenCode bound only `127.0.0.1` with temporary Basic authentication and v2 `id/setup`, prompt hooks, durable queueing, and event subscriptions. No legacy-API compatibility branch was used.
- Models were asked only to read event data, not execute tools or Git operations. pi/OpenCode verified idle wake-up. Claude Code/Codex relied on the next hook, without claiming autonomous idle wake-up.
- Real tests cover normal delivery and deduplication, not every TUI dialog, post-tool/Stop continuation, busy-session race, forced-kill window, or host version. Focused automated tests and later acceptance cover additional boundaries.

Reproduction procedure:

1. Run `npm ci --ignore-scripts && npm run typecheck && npm test`, then build.
2. Create a temporary repository, receiving worktree, and isolated `WORKTREE_SYNC_STATE_DIR` per client. Load the adapter and obtain a baseline response in the original session.
3. After registration, commit a random marker on main and send another through the CLI. Do not place the markers in follow-up user prompts.
4. Keep pi/OpenCode's process/session alive for polling; resume Claude Code/Codex with the same native session ID to trigger the next hook.
5. Inspect model responses, original history, event IDs, both receipts, and local files. Wait another poll or resume once more to verify no duplicates. Stop test subprocesses, explicitly leave test subscriptions, and retain evidence.

## Scope and environment

Automated maintenance acceptance covers explicit leave/rejoin, safe event cleanup, and real daemon process lifecycles. It uses isolated state and temporary worktrees without cleaning user events, installing services, or calling models. The real-client tests above separately used existing model services.

Local environment: macOS, Node.js `v22.23.2`, Git `2.54.0 (Apple Git-157)`.

## Historical execution results

| Check | Result | Evidence |
| --- | --- | --- |
| Full suite | 95/95 passed | `npm test`, including two review-regression rounds and CLI interruption/backpressure |
| Type checking | Passed | `npm run typecheck`, core, adapters, and tests |
| Dependency audit | 0 known vulnerabilities | `npm audit`, including dev dependencies |
| Package/command compatibility | Passed | Offline `worktree-relay` tarball install; `worktree-relay --help` / `worktree-sync --help` |
| Scale benchmark | All self-checks passed | `npm run benchmark`; see [performance](performance.md) |
| Daemon / CLI core acceptance | 9/9 passed in three consecutive rounds | Built `tests/cli/maintenance.test.ts` and `tests/core/daemon.test.ts` |
| Concurrency/lock/adapter regressions | 39/39 passed in three consecutive rounds | `regressions`, `store`, `daemon`, `opencode`, CLI `maintenance` / `resilience` |
| Built JS syntax | Passed | `node --check` on every `dist/` JS file |
| Offline tarball install | Passed | Temporary prefix, `--offline --ignore-scripts --omit=optional` |
| Installed CLI flow | Passed | Register, cross-agent send/receive, leave, acknowledged-event GC |
| Installed daemon | Passed | Start, status true, SIGTERM, status false; lock and heartbeat removed |
| Installed pi extension | Passed | Real pi extension loader registered `/worktree` |

Build before directly running CLI test files: they execute released `dist/cli/main.js`, not TypeScript source.

### Review regressions

- `tests/core/regressions.test.ts`: historical directory-style events remain readable/acknowledgeable/collectable; sending rejects existing directories; corrupt daemon state allows local fallback; send-first migration does not overwrite ordinary upstream events; publication retries add recipients while preserving receipts; orphan/unrelated HEADs report actionable errors and retain unread events. The former prunable-worktree removal check applied to an older implementation; automatic worktree removal is now disabled because of the confirmed replacement race.
- `tests/adapters/pi-watch.test.ts` and `tests/adapters/pi.test.ts`: controlled hosts model custom follow-ups excluded from `hasPendingMessages()`; the same watcher retries after Esc; repeated join and leave/join do not duplicate queue entries or acknowledge before persistence.
- `tests/adapters/opencode.test.ts`: failed registration queries only warn; deletion during the query does not leave ghost registrations or polling.
- `tests/core/daemon.test.ts` and `tests/cli/maintenance.test.ts`: blocked output callbacks run outside publication locks; SIGTERM exits and cleans state with a full unread OS pipe. Nine CLI/core cases passed three rounds.
- `tests/cli/main.test.ts`: help, explicit-cwd checks, daemon status, and hooks with valid cwd still work after process cwd deletion.
- A real old producer at `733c860` was tested against the current reader: historical paths `src/`, `.`, `./`, `./C:/x`, and `src/.` remained readable and collectable. After a real EACCES cursor-write failure, daemon retries added new recipients and delivered once.
- The original daemon-backpressure reproducer no longer held the publication lock indefinitely when stdout was unread. SIGTERM exited 0 and removed `daemon.lock`, `daemon.json`, and `publish.lock`.

These adapter regressions used controlled hosts, not another real-model acceptance run, and do not expand the client/version matrix above.

### Second review round

- Concurrency/starvation: ten core consumers registered/received concurrently, and ten same-location OpenCode sessions each acknowledged three broadcasts without duplicates. Polling batches did not overlap. Bounded publication-lock retries did not depend on winning a later tick by chance.
- Subscription lifecycle: subagent hooks with `agent_id` neither registered nor consumed the parent inbox. Send-only identities, including misspelled refs, did not create subscribers or block GC between real consumers. Legacy send-first tests retained actual old-state shapes.
- Cancellation/backpressure: `tests/cli/resilience.test.ts` exercised gc/send/join/leave under SIGINT while holding locks. Delayed FileHandle writes only stabilized signal timing; a separate real 5,000-event GC scan used no delay. Large valid recipient snapshots filled real check/watch stdout pipes. SIGTERM exited without locks or acknowledgement of incomplete output, and delivery could retry.
- History gaps: pruned objects and repository recreation at the same path produced explicit `unavailable` notifications, acknowledged only after acceptance; later messages continued. An unavailable Git executable still failed without false acknowledgement.
- Hooks/environment: 1.1 MiB Write input delivered normally. Input over 16 MiB returned an empty response without acknowledgement, recoverable by the next hook. Non-Git hooks/OpenCode degraded quietly.
- Lower-severity cases: ambiguous branch/tag starting points require full refs; pi removal warns about ignored files; send/GC can succeed after waiting for locks; timeouts or consumption locks older than 60 seconds report PID/path without stealing locks.
- `node scripts/benchmark.mjs` passed all 100/1,000/10,000-event self-checks. It ran alongside regressions, so it verifies correctness without replacing historical performance comparisons.

This round did not rerun real Claude Code/OpenCode model end-to-end tests or Windows acceptance, and did not clean user state. Inspect stale registrations before explicit leave; acknowledging old unread messages remains a user decision. PID files alone do not establish ownership under PID reuse. See [shared messages](shared-messages.md) and [maintenance](maintenance.md).

### pi SDK reload and session-switch regression

On 2026-10-27, `node --experimental-strip-types --test tests/adapters/pi-reload.test.ts` passed 4/4 using the installed pi 1.4.0 SDK, the file-based GitRelay extension, isolated Git repositories and local mock model streams. The cases cover busy delivery through reload and abort, delayed `agent_settled` through reload, the same session manager switching away and back, and an actual `AgentSessionRuntime` switch and resume while a host action is deferred. In the last case the event remained unread and a warning appeared; after the old action was released, the SDK made an extra mock model call without the relay event and did not persist that call. This is not a real-model client acceptance run.

The tested SHA-256 hashes were `d7b4c26f029fc7926a0b45cc286c419eb87694519b359163cc894a59b32a89ed` for `src/adapters/pi/index.ts`, `57d6e0755cc6053d4938e68298575250fdaeb46ae86f339ae224c275a39f230e` for `src/adapters/pi/watch.ts`, and `7c7d647ab4ca5e2157f6995f11bfbdd83f2f8dd4b8c7f4a71d643572ef860417` for the test file. The host does not expose whether its deferred custom action will still execute. GitRelay preserves the event and warns on an uncertain outcome; see [pi recovery guidance](integrations.md#pi) for the restart and session-switch boundary.

## Acceptance matrix

### Session exit

- Leave stops future delivery; ordinary polling cannot implicitly rejoin.
- Unread messages survive leave and remain ineligible for GC.
- Join restores the old inbox and future subscriptions, not broadcasts sent while closed.
- Leaving an unregistered identity creates no ghost registration; repeated leave is idempotent.
- Stale `lastSeen` does not close sessions; leave does not steal active consumer locks.
- pi `/worktree join` and `/worktree leave` were exercised.

Cases: `tests/core/sessions.test.ts`, `tests/adapters/pi.test.ts`, `tests/cli/maintenance.test.ts`.

### Safe cleanup

- Preview is the default; only `--apply` deletes.
- Missing receipts preserve events, including for closed/offline recipients.
- Default retention is seven days from the latest creation/acknowledgement timestamp.
- GC deletes eligible events/receipts but preserves registrations, closed markers, ref positions, and event-chain heads.
- Consumer-lock conflicts skip events without deadlock or deleting cached dependencies.
- The `trash/` journal recovers partially completed deletions.
- Corrupt receipts, invalid retention, and precancellation do not delete unacknowledged events.
- Completed legacy migration does not repeat or resurrect collected events.

Cases: `tests/core/cleanup.test.ts`, `tests/core/sessions.test.ts`, `tests/cli/maintenance.test.ts`.

### Optional daemon

- One instance per user state root; a second cannot damage the first's lock/heartbeat.
- Multiple registered repositories are discovered and each active ref is monitored centrally.
- Bad subscriptions do not block other repositories/refs.
- Earlier clients trusted matching fresh daemon/ref state and fell back on staleness; current clients synchronize on every consume.
- Startup cleanup retains unread events; hourly maintenance safely collects newly acknowledged events. A controlled clock advances the hour rather than waiting in real time.
- After a real daemon subprocess publishes a main-branch event, independent Codex/OpenCode-identified CLI consumers receive the same event ID.
- SIGTERM and output-pipe failures remove locks/heartbeats.
- Clients can detect later main-branch updates after daemon shutdown.

Cases: `tests/core/daemon.test.ts`, `tests/cli/maintenance.test.ts`.

## Reproduction commands

```sh
npm run typecheck
npm test
npm run build
node --experimental-strip-types --test tests/cli/maintenance.test.ts tests/core/daemon.test.ts
find dist -name '*.js' -exec node --check {} \;
npm pack --dry-run
```

See [maintenance](maintenance.md) for operating boundaries.

## Not covered

- Cursor real-model interactions and host versions outside the matrix; Codex project-level hook discovery did not pass.
- Native Linux/Windows system acceptance and launchd/systemd/Windows service installation. The macOS/Linux CI matrix was configured, but these records do not establish a hosted-runner execution.
- Million-event backlogs, huge repositories, or long histories. The daemon remains explicitly optional and is not enabled by tests.
- Exactly-once processing, automatic lock stealing after forced termination, offline-session TTL eviction, or dropping unread messages. Delivery is not completed model work.


## Pending revision recovery design review (2026-10-27, Asia/Singapore)

Read-only call-chain review identified an unverified interruption case in the
existing Codex and OpenCode installers and the private stable-digest candidate.
If a journal contains a pending revision but its marker was not published,
and the latest marker still equals the current revision, reinstall validates
the current runtime but not the pending runtime before replacing the pending
reference with a revision for the new source. A missing or modified old pending
runtime may therefore go unreported; its files are not removed by this path.
This can also occur after an uninstall preserves the pending field. It has not
been reproduced by running an installer. Claude's `launcher.pending` has a
related source-level gap, while `state.pending` for the marketplace manifest
is a separate state machine and needs its own validation.

A recovery design requires verifying the original pending snapshot and its
metadata before changing its journal or publishing its marker, completing that
pending operation, then separately processing a changed source. Claude also
needs its initial skills, plugin manifest, hooks, package metadata and the
version/Node/launcher-dependent revision suffix verified; its marketplace
manifest and launcher must be reconciled in a safe order. Missing, modified
or unverifiable historical snapshots must be preserved. The design is not
implemented and does not resolve concurrent path replacement, no-clobber
publication, old-version compatibility or power-loss durability.

Pure in-memory experiments are retained at
`/tmp/gitrelay-pending-state.BQPhL7vE/` and
`/tmp/gitrelay-claude-pending-model.3fIqvg6r/`. Independent review found that
the initial generic model treated a digest as repeated characters and failed
to clean a pending revision equal to current; it also omitted real revision
files, removed-installation entry/anchor checks and filesystem locking. Its
assertion counts do not validate production recovery. The separate Claude
model assumes atomic actions and has not exercised either journal, real
filesystem publication or a host. No installer, client or garbage collection
was run for this review.

## Platform executable link detection (2026-10-27, Asia/Singapore)

A broken client executable link was previously reported as `missing` because
`stat` returned ENOENT. The same occurred when its target crossed a regular
file and `stat` returned ENOTDIR. Detection now checks the entry itself and
reports `unavailable`, while continuing to search later PATH entries; it also
propagates cancellation during filesystem checks. A clean-environment private
copy of `tests/cli/platform-broken-executable.test.ts` passed 2/2, covering
seven link/PATH cases and three injected cancellation phases. The source matched
the workspace; the private test omitted fixture cleanup and used a preload
blocking `rm` and `unlink`. Evidence: `/tmp/gitrelay-detect-broken-fix.T4iKG7OH/`.
This used synthetic wrappers and did not run any client or installer. Windows
and concurrent path replacement are unverified.

## Explicit hook acknowledgment prototype review (2026-10-27, Asia/Singapore)

A later private versioned-session experiment initially assumed old validators
would reject a new session key. Independent review tested the actual source
from pushed commit `7a2a112`: its `readSession` and `sessionsIn` accepted the
new-format session record. This disproves that proposed mixed-version fence;
it does not show an old ordinary consumer actually receiving the new inbox.
Separate direct checks found that the old and current `readReceipt` both
reject the experimental pending status. They do not establish GC, locking or
third-party compatibility. No session protocol was merged. Evidence:
`/tmp/gitrelay-old-fence.kh8DZ7zS/` and
`/tmp/gitrelay-ack-compat.HRVu6Xfm/`.

A private proof-of-concept in `/tmp/gitrelay-ack-test.dizJVrt2/` added a
session-scoped pending record and a synthetic `hook-ack` CLI command. In an
isolated real Git repository with a simulated Codex hook, a previously
presented file-scoped message was replayed after its local file returned to a
clean state. The same token was reused, an incorrect token and modified event
content were rejected, a correct acknowledgment was idempotent, and the next
hook did not repeat the event. A separate subprocess invoked the prototype
CLI successfully. Test state was copied without retained lock files between
operations; this is not evidence of original-location restart or lock
recovery. The preload disabled `rm` and `unlink`, and no client, installer or
GC was run.

Independent review reproduced the earlier private prototype's pending-to-irrelevant defect in
`/tmp/gitrelay-ack-irrelevant.eFMWiVwa/`. It also confirmed that the prototype
mode marker prevents a newer same-session manual consumer from automatically
acknowledging a pending hook event, but changes the existing public
`check`/`watch` behavior even before a pending event exists. The existing
skills do not instruct older agents to run the new command. The prototype has
no safe disable or upgrade/migration flow; older processes can bypass its
marker, loss of that marker can revert to automatic receipts, identity
migration and GC do not recognize its new files, and repeated unacknowledged
messages can starve later events. These are unresolved production blockers.

No prototype code was merged. Native delivery confirmation, model reading,
exactly-once behavior, old-version coexistence, Windows, power loss, and real
client acceptance remain unverified. The design's token is not a security
boundary against other processes running as the same user. Related platform
references: [Claude hooks](https://code.claude.com/docs/en/hooks) and
[Codex hooks](https://developers.openai.com/codex/hooks).


## PATH version-command spawn recovery (2026-10-27, Asia/Singapore)

An isolated synthetic wrapper had an executable first PATH entry whose shebang
interpreter was missing, followed by a second entry reporting `2.1.2`. A
normal Node PATH lookup ran the second entry, while the old detection returned
`unavailable` after trying the first absolute path. An inaccessible shebang
interpreter reproduced the same difference with `EACCES`. Evidence:
`/tmp/gitrelay-detect-pathexec-wipsjdg_`.

Detection now continues searching only when starting a candidate fails with
`ENOENT` or `EACCES`; no candidates succeeding still reports `unavailable`.
A clean-environment private copy of `platform-spawn-fallback.test.ts` passed
3/3, covering both errors, normal Node PATH behavior, a failing or timed-out
executed command, and cancellation of a started command. Source matched the
workspace; the private test omitted fixture cleanup and inherited a preload
that rejects `rm` and `unlink`. Tests used synthetic wrappers only; no client,
installer or GC was run. Windows and concurrent replacement of PATH entries
remain unverified. Evidence: `/tmp/gitrelay-path-fix-i8zjc718/`. Command:

```sh
cd /tmp/gitrelay-path-fix-i8zjc718
env -i PATH=/usr/bin:/bin HOME="$PWD" TMPDIR="$PWD" \
  GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 \
  NODE_OPTIONS="--import=$PWD/no-delete.mjs" \
  /Users/sheny/.nvm/versions/node/v22.23.2/bin/node \
  --disable-warning=ExperimentalWarning --experimental-strip-types --test \
  tests/cli/platform-spawn-fallback.test.ts
```

## OpenCode message ID across repository identities (2026-10-27, Asia/Singapore)

An isolated real-Git probe exercised the current OpenCode adapter and core
consumer with a simulated host that deduplicates queued input by message ID.
At the same worktree path and native session ID, two different explicit
repository identities had separate state directories containing an upstream
event for the same ref and commit range. The event ID was derived using the
normal upstream hash. The adapter generated the same host message ID in both
cases: the simulated host admitted it once while both repositories recorded a
`delivered` receipt. This demonstrates a collision in the current ID derivation
under those conditions, not that a real OpenCode host retains that ID across
repository replacement or any particular duration. The test switched isolated
state roots and identity mappings; it did not actually replace a repository.
It used an empty environment and Git template; Node `fs.promises.rm` and
`unlink` were intercepted.
One state tree was copied without retained locks to simulate the next poll, so
this is not evidence of lock release or original-location restart recovery.
Evidence: `/tmp/gitrelay-oc-repoid.IYQDY9mh/probe.mjs`.

Adding a repository identity to future message IDs without a migration could
change the ID of an already accepted event whose receipt was not yet written,
causing a duplicate retry. Existing events and receipts must be preserved; no
fix or compatibility migration is claimed.

A private candidate chose a repository-scoped v2 message ID for new sessions
and retained v1 for existing sessions, including a simulated already-admitted
retry. Real Git and a simulated host exercised distinct repository identities
and marker interruption cases; subsequent calls copied state without the
retained locks. The candidate remains unmerged: existing sessions still have
the collision risk, older concurrent clients can ignore the marker, and state
rollback, identity migration, directory replacement and real host behavior
are not established. A warm local registration-only probe with 1,000 events
measured 0.288 ms before and 25.075 ms with the candidate's full orphan scan;
it is not an end-to-end or concurrent performance measurement. Evidence:
`/tmp/gitrelay-msgid-v2f.pPHNdDGu/`.

## Version-command termination diagnostics (2026-10-27, Asia/Singapore)

An isolated synthetic version command that terminated itself with SIGTERM was
correctly classified `unavailable`, but the error omitted the signal. The
shared command runner now retains the existing `Command failed` prefix and
includes the signal name, without changing nonzero-exit, timeout, cancellation,
spawn failure, or successful output handling. Five focused tests passed against
current source; the prior source failed the signal assertion. The tests start
synthetic Node children, with no client or installer and no file cleanup.
Evidence and the prior-source comparison are retained in
`/tmp/gitrelay-command-signal-review/`. Command:

```sh
env -i PATH=/usr/bin:/bin HOME=/tmp/gitrelay-command-signal-review \
  TMPDIR=/tmp/gitrelay-command-signal-review GIT_CONFIG_GLOBAL=/dev/null \
  GIT_CONFIG_NOSYSTEM=1 \
  /Users/sheny/.nvm/versions/node/v22.23.2/bin/node \
  --disable-warning=ExperimentalWarning --experimental-strip-types --test \
  tests/cli/command-output-signal.test.ts
```

The signal-specific assertion is skipped on Windows. This is local diagnostic
coverage, not real-client, installation lifecycle, or CI acceptance.

## Further hook acknowledgment prototype review (2026-10-27, Asia/Singapore)

Independent no-delete isolated probes found four limitations in the private
hook-ack prototype: a valid 2,097,070-byte event exceeds the 2 MiB state
limit when embedded in its pending snapshot; a consumer using the current
non-ack protocol with the same identity ignores the prototype marker and can
write a delivered receipt without the explicit acknowledgment; changing
other recipients of a message is not covered by the pending event digest;
and the same digest also accepts removing a prior upstream recipient. Normal
built-in publication is not known to remove those recipients. The mixed-mode
probe copied state while excluding retained locks, so it does not establish
original-location lock recovery. Evidence: `/tmp/gitrelay-ack-size.cJrReO19/`,
`/tmp/gitrelay-ack-old-consumer.xZAW0bdU/`,
`/tmp/gitrelay-ack-recipients.nLZtc906/`, and
`/tmp/gitrelay-ack-upstream-recipients.LbKgIirw/`.

The current GC and identity migration do not handle the prototype's pending
sidecars; pending records also bind the original repository identity and can
retain local patch content. These are call-chain findings, not executed GC or
migration tests. The pushed `7a2a112` normal repository lookup uses the older
path-based key, whereas the current implementation uses a persistent identity;
testing the old reader directly on a constructed current-directory object
does not prove that its ordinary client entrypoint consumes that directory.
No ack code was merged, and exactly-once delivery, mixed-version safety and
real-host acceptance are not established.

## Ref observation freshness after a slow scan (2026-10-27, Asia/Singapore)

In an isolated real Git repository, a controlled event-directory scan was
held for 16.1 seconds after the monitored ref was queried and advanced. The
previous implementation wrote `checkedAt` when the scan finished, so a
consumer with a simulated matching daemon heartbeat treated the old ref as
fresh and did not check the new commit. With the candidate recording the time
before the Git lookup and event scan, the same controlled wait caused the
consumer to recheck and advance the cursor. These tests used a real clock and
Git, but a synthetic heartbeat and an injected scan delay; no real daemon or
client was run. The retained probes are
`/tmp/gitrelay-ref-realwait.xIezomvZ/probe.mjs` and
`/tmp/gitrelay-ref-start-fix.Hqqb87MN/probe.mjs`.

An isolated private copy passed 8/8 `daemon-ref-token` tests, including a Git
query failure preserving the prior cursor and events, a ref advance with a
forward clock change, a force reset with a backward clock change, cancellation
and pending-event recovery. The two new timing assertions failed against the
previous source and passed with the change. The test used `env -i`, an empty
Git template, and a preload that replaces Node `fs.promises.rm` with a no-op
and rejects `unlink`; it does not intercept Git's own file operations. Later
calls copied test state without retained locks, so this does not establish
original-location lock recovery. The private source and test match the shared
workspace. Command:

```sh
env -i PATH=/usr/bin:/bin HOME=/tmp/gitrelay-ref-start-fix.Hqqb87MN \
  TMPDIR=/tmp/gitrelay-ref-start-fix.Hqqb87MN GIT_CONFIG_GLOBAL=/dev/null \
  GIT_CONFIG_NOSYSTEM=1 GIT_TERMINAL_PROMPT=0 \
  /Users/sheny/.nvm/versions/node/v22.23.2/bin/node \
  --import /tmp/gitrelay-ref-start-fix.Hqqb87MN/no-delete.mjs \
  --disable-warning=ExperimentalWarning --experimental-strip-types --test \
  /tmp/gitrelay-ref-start-fix.Hqqb87MN/tests/core/daemon-ref-token.test.ts
```

The portable shell-wrapper scenarios are skipped on Windows. This change
prevents the duration of the scan from being mistaken for a recent ref check;
it does not make a Git ref observation atomic, detect a clock change that
returns to its previous value, or establish power-loss durability. No real
daemon, GC, installer, client or full suite was run for this change.


## Daemon failed-check generation experiment (2026-10-27, Asia/Singapore)

An isolated real-Git test using synthetic heartbeat and lock files reproduced
a documented delayed-check case: a ref advanced from A to B after a successful
check, then the same simulated daemon's next Git ref query failed. While the
old cursor's token and check time still matched a fresh heartbeat, the
consumer reused A and did not publish the change. A separate comparison made
the heartbeat stale and the consumer then synchronized to B; the test did not
wait for the actual freshness period. Evidence:
`/tmp/gitrelay-daemon-failure.YXLNxPxC/`.

A private candidate assigns a fresh generation to each daemon sweep and only
accepts a ref hint after a successful check in that generation. Six isolated
real-Git cases with synthetic heartbeat passed: matching and mismatched
generations, missing or invalid generation, failed checking, daemon token
change, and independent refs. An additional counterexample showed that a
second failed check of the same ref within one generation leaves its first
check eligible; the design depends on the current daemon deduplicating refs
and checking each once per sweep. It was not merged. A failed heartbeat write
and failed lock cleanup may still leave an older hint usable within its
freshness window; changing generation also causes not-yet-checked refs to
fall back to direct Git checks and may increase load. Real daemon and GC,
heartbeat write failures, lock recovery, Windows, mixed-version clients and
power-loss behavior were not tested. Evidence and retained private sources:
`/tmp/gitrelay-daemon-gen.hp5Z0LEf/`. These experiments used fresh HOME and
Git configuration, an empty Git template, and a preload intercepting Node
`fs.promises.rm`/`unlink`; Git's own file operations were not intercepted.
Some successive calls used copied state without retained lock files and do not
prove original-location lock recovery.


## Ref and heartbeat time field validation (2026-10-27, Asia/Singapore)

An isolated probe showed that arrays containing an ISO timestamp were accepted
as both a ref cursor `checkedAt` and a daemon `heartbeatAt` because `Date.parse`
coerces its input. With matching token and live synthetic PID, a real-Git
consumer trusted the array heartbeat and kept the previous commit after the
ref advanced. The original isolated source failed all three focused tests.

The current code rejects non-string cursor check times as invalid and treats
non-string heartbeat times as an unavailable daemon hint. Missing cursor times
and parseable historical strings remain accepted. The private source and
shared production files matched; the shared test has adjusted relative import
paths and fixture cleanup enabled, which was omitted from the private copy.
Three tests passed, including real Git and a synthetic heartbeat.
They used an empty environment, empty Git template/hooks and a preload that
replaced Node `fs.promises.rm` with a no-op and rejected `unlink`; Git's own
file operations were not intercepted. Locks and temporary files remain. An
independent review reran the candidate and verified that older built-in writers
used strings. Evidence:
`/var/folders/1b/b19xbzjx7xqc4kl0k9x_y4y80000gp/T/gitrelay-time-field-fix-je4dwsw4/`
and
`/var/folders/1b/b19xbzjx7xqc4kl0k9x_y4y80000gp/T/gitrelay-time-field-before-s1ux1ttz/`.
The test command was:

```sh
cd /var/folders/1b/b19xbzjx7xqc4kl0k9x_y4y80000gp/T/gitrelay-time-field-fix-je4dwsw4
env -i PATH=/usr/bin:/bin HOME="$PWD" TMPDIR="$PWD" \
  GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 GIT_TERMINAL_PROMPT=0 \
  /Users/sheny/.nvm/versions/node/v22.23.2/bin/node --import ./no-delete.mjs \
  --disable-warning=ExperimentalWarning --experimental-strip-types --test \
  tests/time-fields.test.ts
```

This does not establish real daemon, GC, native-client, Windows or full-suite
behavior, and does not address clock changes that return to an earlier value.

## OpenCode session-scope compatibility experiment (2026-10-27, Asia/Singapore)

A private candidate in `/tmp/gitrelay-oc-scope.kzobUAv6/` put a new random
OpenCode delivery scope and the migration flag into one atomically written
session record. Existing v1 sessions kept their original message IDs. The
candidate reused a scope across open and closed subscriptions for the same
repository, worktree and native session on different refs; conflicting scopes,
unattributed retained history, and a legacy cursor without its session record
failed closed. It propagated cancellation and kept the current timestamp-field
validation. A synthetic assertion script checked those decisions and confirmed
that the actual `7a2a112` session reader rejects the new record. A separate
isolated real-Git probe using the candidate adapter and a simulated deduplicating
host observed two different message IDs and two admissions for equal upstream
event IDs in two repository identities. It copied state while excluding
retained lock files, and did not establish original-location restart or lock
recovery. Neither probe ran a real coding agent, installer, daemon or GC.
Scripts: `/tmp/gitrelay-oc-scope.kzobUAv6/test.mjs` and
`/tmp/gitrelay-oc-scope.kzobUAv6/host.mjs`.

Independent review found that defaulting new sessions to this format would
cause older Codex, Claude Code, pi and daemon readers that access the same
store to reject the entire session scan. Stopping old participants and an
explicit upgrade, rollback and recovery procedure would be necessary; the
prototype does not implement them. Existing v1 sessions retain their prior
collision risk, and losing or rolling back all scope state remains ambiguous.
No production code was merged. In a warm local registration-only benchmark
of 12 alternating runs, the candidate's full session scan changed the median
from 0.509 to 4.285 ms for 100 sessions and from 0.338 to 24.700 ms for
1,000 sessions. This synthetic test does not measure concurrent agents, cold
cache, end-to-end latency, Windows or actual host behavior. Benchmark:
`/tmp/gitrelay-oc-scope.kzobUAv6/bench.mjs`.

## Status broadcast failure regression (2026-10-27, Asia/Singapore)

A pre-fix isolated reproduction used real Git and a synthetic `gh` wrapper. After the baseline, the wrapper returned 70,000 bytes on stderr; the resulting GitHub error made the status message exceed the 64 KiB limit. The old watcher printed only its initial status line and repeatedly reported the message size error without printing the changed status. Reproduction: `/tmp/gitrelay-watch-audit.P1L6/probe.py`, fixture `/tmp/gitrelay-watch-audit.P1L6/fixture-2_ocdi6m`. No real `gh` network request or coding agent was involved.

On the shared working tree, Node v22.23.2 and Git 2.54.0 (Apple Git-157), the following targeted command passed 6/6 tests. It used a fresh temporary repository with real Git, a synthetic `gh` wrapper, and a no-delete preload; the test's cleanup call was intercepted, so the fixtures were retained. `TMPDIR` included spaces to check preload argument handling.

```sh
cd /Users/sheny/Developer/code/worktree-relay
env -i PATH=/usr/bin:/bin HOME=/tmp/gitrelay-watch-audit.P1L6 \
  TMPDIR='/tmp/gitrelay-watch-audit.P1L6/tmp with spaces' \
  NODE_OPTIONS=--import=/tmp/gitrelay-watch-audit.P1L6/noremove-preload.mjs \
  /Users/sheny/.nvm/versions/node/v22.23.2/bin/node \
  --disable-warning=ExperimentalWarning --experimental-strip-types \
  --test tests/cli/status-broadcast.test.ts
```

The tests cover full local output of the 70,000-byte error with an explicit non-broadcast warning, the UTF-8 and JSON-escaping boundary of the serialized message limit, and a failed broadcast that does not prevent local output or retry the same snapshot. An injected error immediately after event publication produced one event and an outcome-unknown warning without a duplicate during the observation window. A closed stdout pipe after publication produced the outcome-unknown warning and exit 1; a separate test filled an OS stderr pipe and closed stdout, then observed exit 1 without a hang. The latter uses a deliberately invalid relative state path and does not establish successful event publication or lock cleanup in that case. An additional private synthetic probe exercised Markdown output. TypeScript `node node_modules/typescript/bin/tsc --noEmit --pretty false` and `git diff --check` for the changed tracked files also passed.

Independent review of the private candidate found and prompted fixes to test cleanup ordering, waiting for stderr close, and preload paths containing spaces. A final read-only review of the shared source, test and documentation found no new confirmed defect and verified the source and test hashes matched the reviewed candidate. No installer, daemon, GC, real host client or Windows environment was exercised. This is local regression evidence, not real-client acceptance, CI, exactly-once delivery or validation of every interruption window. Oversized status snapshots are still not broadcast; a failed send may have completed and the same snapshot is not automatically retried. A full or closed stderr can suppress diagnostics.

## Daemon cache and a pending publication after ref rollback (2026-10-27, Asia/Singapore)

An isolated real-Git probe created commits A and B, retained a cursor at A,
published an A-to-B upstream event and returned the ref to A. With a matching
synthetic daemon hint, the then-current consumer delivered A-to-B while leaving the
cursor at A; only a later full synchronization recovered the pending event and
published B-to-A. A separate fault-injection probe exercised a non-daemon
`synchronizeRef` in the private generation candidate: it failed after the event
write and before the cursor write, then a consumer with the matching hint also
failed to publish B-to-A. Checking only that the current Git ref equals the
cached cursor cannot detect this pending event. These observations establish
delayed recovery in the tested scenarios, not permanent event loss. Evidence:
`/tmp/gitrelay-reset-pending-review.zQ7D/probe.mjs` and
`/tmp/gitrelay-reset-pending-review.zQ7D/interrupted-generation.mjs`.

A private copy that always invokes `synchronizeRef` in the consumer recovered
the synthetic pending event and published B-to-A during that consume call. The
test used a real Git repository but a synthetic heartbeat and manually created
pending event; it did not run a real daemon or simulate a process crash. Its
comparison retained temporary state and intercepted Node `fs.promises.rm` and
`unlink`; Git's own file operations were not intercepted. It does not prove
concurrent lock behavior, power-loss recovery or real-client delivery. The
private copy was not merged; a later equivalent consumer change is recorded
below. Its performance and additional availability costs
are recorded in [performance](performance.md#daemon-cache-recovery-tradeoff-2026-10-27-asiasingapore).
Evidence: `/tmp/gitrelay-cache-compare.9P3gxJwW/recovery.mjs` and
`/tmp/gitrelay-cache-compare.9P3gxJwW/README.md`.

## Watch stderr backpressure regression (2026-10-27, Asia/Singapore)

A local isolated real Git repository with a synthetic Git wrapper emitting a
2,000,000-byte error reproduced unbounded stderr buffering in `status --watch`
when the pipe was not read. The fix truncates each diagnostic and suppresses
further diagnostics during backpressure. In the private candidate, four focused
tests passed: status reached a full pipe, stopped writing for 300 ms, resumed
after draining and exited on SIGTERM; watch handled one long error and SIGTERM;
a truncation marker and Unicode boundary were checked; and closed status stderr
did not terminate the watcher. The two original long-error tests failed against
the original code. Six existing status-broadcast tests also passed in the
private candidate. The candidate tests retained temporary files; the shared
test adds normal teardown and was not executed in this run. The independent
review checked the final shared code and test, including cleanup ordering.

Run the focused regression normally with
`node --experimental-strip-types --test tests/cli/watch-diagnostic-backpressure.test.ts`.
The private retained-file run used an isolated HOME, TMPDIR and Git config; the
existing status-broadcast test additionally intercepted Node deletion calls.
No real host client, installer, daemon, GC, Windows environment or CI was
exercised. The watch command itself was not tested with a full stderr pipe, and
the 300 ms blocked interval does not prove all scheduling scenarios. Diagnostics
may be dropped while stderr is blocked. Queue measurements and their limits are
recorded in [performance](performance.md#watch-stderr-queue-2026-10-27-asiasingapore).

## Daemon cache invalidation fault injection (2026-10-27, Asia/Singapore)

A private generation-based candidate clears the cursor's daemon hint under the
publication lock before an ordinary publisher writes an event. In an isolated
real-Git repository, with a synthetic matching daemon heartbeat, a fault was
injected into the cursor replacement after the hint had been cleared and the
A-to-B event had been written. After the ref was reset to A, a subsequent
consume recovered the pending publication and delivered both A-to-B and B-to-A.
This tests injected write failure, not an actual process crash.

A second isolated real-Git run injected EIO into the *first* cursor replacement,
the attempted hint invalidation. The publisher aborted without writing an event,
but the cursor retained its old matching hint at A. With Git already at B, the
next consume trusted A and delivered zero upstream events. This demonstrates
that the candidate alone does not make hint invalidation fail closed and is not
a complete fix. The two probes used Node v22.23.2, an empty HOME, isolated state
and Git configuration, and a preload that intercepts Node removal calls. Git's
own file operations were not intercepted. A copy of the fixture state excluded
the publication lock before the subsequent consume; the original lock's
recovery and concurrent lock behavior were not tested. No real daemon, GC,
installer or coding-agent client was run.

Independent source review found that the pre-clear protocol covers ordinary
writers that use the new `synchronizeRef` protocol, but a writer that bypasses
it can still create a pending event behind a matching hint. `publishUpstream`
is a TypeScript module export; its status as a public package API has not been
established. The committed HEAD and current working tree use different normal
repository state-directory keys, so this finding does not establish that an
ordinary old client shares the new directory. Migration requires stopping old
clients; an old process continuing to use its prior directory can split state.
Review also identified an untested multiple-I/O-failure window around daemon
generation heartbeat and cleanup, and `writeJson` does not establish power-loss
durability. The candidate remains private and was not merged or benchmarked.
Evidence: `/var/folders/1b/b19xbzjx7xqc4kl0k9x_y4y80000gp/T/gitrelay-pending-journal-iaj4jhws/`
(`interruption.mjs` and `invalidation-failure.mjs`), and retained fixtures
`/tmp/gitrelay-reset-pending-review.zQ7D/i-q05Z1I` and
`/tmp/gitrelay-reset-pending-review.zQ7D/i-PFX0NT`.

## Versioned hook acknowledgment and chunk experiment (2026-10-27, Asia/Singapore)

A private v2 prototype divides a saved notification into 256 KiB parts, with a
32 MiB total bound and a digest over the serialized snapshot. It binds message
recipients exactly and requires an upstream event to retain the original
recipient set, while allowing additions and deduplication during publisher
recovery. Its scope is an explicit agent-issued acknowledgment command: neither
that command nor the token proves the agent understood or completed the task,
and redisplay is possible before acknowledgment. This is not native host
acknowledgment or an exactly-once guarantee.

With Node v22.23.2, the private copy passed `tsc --noEmit`. An isolated real
Git repository and simulated hook host passed registration, redisplay with the
same token when no acknowledgment was issued, rejection of a wrong token and
changed event, blocking a non-ack consumer, and explicit and repeated
acknowledgment. A separate direct-function test split a 1,876,408-byte upstream
event across eight parts and restored it; it accepted recipient addition and
deduplication, and rejected upstream recipient removal, message recipient
replacement and part corruption. The clean-environment probes retained their
fixtures and intercepted Node removal calls. The hook probe copied state while
excluding retained lock files, so it does not establish original-location
restart or lock recovery; Git's own file operations were not intercepted.
Evidence: `/tmp/gitrelay-native-ack.umALsxnz/probe.mjs`,
`/tmp/gitrelay-native-ack.umALsxnz/chunk-probe.mjs` and
`/tmp/gitrelay-native-ack.umALsxnz/REVIEW.md`.

An independent review found that this prototype is **not ready to merge**.
The hooks enable acknowledgment by default, and the persistent mode marker
blocks ordinary CLI and SDK consumers of the same session, even if the first
hook subsequently fails or has no message. The consumer filters recipients
before consulting pending state, so removal of the current recipient can
silently bypass that pending check. The v2 reader also has no v1 pending
migration, and interrupted chunk publication can leave orphan parts. GC and
repository identity migration do not yet recognize these manifests or parts;
GC must protect pending data including events already in trash. An independent
13-assertion in-memory model explored these boundaries, but does not validate
production GC or migration: `/tmp/gitrelay-ack-gc-model.DCYLCXwv/model.test.mjs`.

Older consumers and GC cannot be constrained by the new sidecar. A safe
transition needs a documented procedure that stops incompatible writers and
GC before enabling, migrating, disabling or rolling back, and validates and
preserves pending data. Transparent mixed-version operation is not established.
The private candidate was derived from an older source snapshot, not the
current working tree; it has not been integrated. No real coding agent,
installer, daemon or GC was run for these experiments, and no CI, crash-durability
or concurrent-process acceptance is implied.

## One-shot CLI output backpressure (2026-10-27, Asia/Singapore)

On macOS with Node v22.23.2, the shared source passed six local regression
cases using isolated Git configuration and retained test fixtures:

```sh
env -i PATH=/usr/bin:/bin \
  HOME=/tmp/gitrelay-fatal-fix-check-q2r6kk5j \
  TMPDIR=/tmp/gitrelay-fatal-fix-check-q2r6kk5j \
  GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 \
  GITRELAY_KEEP_TEST_FIXTURES=1 \
  /Users/sheny/.nvm/versions/node/v22.23.2/bin/node \
  --disable-warning=ExperimentalWarning --experimental-strip-types --test \
  tests/cli/one-shot-output-backpressure.test.ts
```

The six tests covered unread fatal stderr, readable truncation, an oversized
hook input with blocked stderr, help with closed stdout, and SIGINT/SIGTERM
while watch help output was blocked. All six passed; `tsc --noEmit` also
passed in the same clean environment. Independent source review found and
prompted fixes for output-stream completion ordering, signal-test readiness,
and direct-child cleanup ordering. The final static review found no additional
confirmed issue; the reviewer did not independently rerun the six tests.

Separate retained Python probes filled actual OS pipes without readers. With
both stdout and stderr full, `status --watch --help` exited 130 on SIGINT and
143 on SIGTERM. A one-shot status waiting for a synthetic Git executable with
full stderr exited 130 on SIGINT. Evidence:
`/tmp/gitrelay-oneshot-stderr-review/check-signal-full-pipes.py` and
`/tmp/gitrelay-oneshot-stderr-review/check-signal-shared.py`. These results
apply to this macOS and Node pipe setup, not all operating systems or output
devices. No real coding-agent client, installer, daemon or GC was run; this is
local synthetic CLI verification, not real-client acceptance or CI evidence.

## Consumer synchronization after stale daemon hints (2026-10-27, Asia/Singapore)

Consumers that acquire the locks and proceed for an active session now run
`synchronizeRef` under the publication lock instead of treating a recent daemon observation as proof that no later
publisher was interrupted. The daemon still monitors refs and publishes
updates independently. A failed Git or state check stops the consume, including
ordinary messages, rather than silently falling back to a possibly stale hint.
This change does not provide automatic stale-lock recovery or make old clients
safe to run during migration.

Three isolated real-Git regression tests passed with Node v22.23.2: a matching
synthetic heartbeat no longer hides a newer ref; an existing pending A-to-B
event followed by a ref rollback to A recovers both transitions without
repeat delivery on the checked retry; and an injected cursor-write failure
propagates, then a copied-state retry recovers the event once. All three failed
against the earlier private source (the first version of the test fixture).
Eight focused daemon-token tests and TypeScript `--noEmit` also passed. These
tests use synthetic daemon files, and the pending state models an old writer;
they do not run a daemon or an old client. The no-delete preload intercepts
Node `rm` and rejects `unlink`. Locks therefore remain and retries use copies
without lock files: actual crash and original-location lock recovery remain
untested. Git's own file operations were not intercepted. The modified legacy
interruption, daemon and GC tests were not run in this round. No full suite,
real daemon, GC, installer, coding-agent client, power-loss or CI validation
was performed. The test uses isolated Git config and temporary state; run with
`node --experimental-strip-types --test tests/core/hint-recovery.test.ts` in a
normal development environment. Evidence includes
`/var/folders/1b/b19xbzjx7xqc4kl0k9x_y4y80000gp/T/gitrelay-lock-snapshot-vsf_us8t/`
and [performance](performance.md#always-synchronize-consumer-measurement-2026-10-27-asiasingapore).

## Unavailable ref and concurrent state failure (2026-10-27, Asia/Singapore)

An isolated real-Git fixture used an active, migrated session with an unread,
unfiltered message and a nonexistent subscribed branch ref. On the current
consumer, synchronization failed with `fatal: Needed a single revision`, the
delivery callback was not invoked, the event remained present, and no receipt
directory was created. This demonstrates delayed delivery, not message loss.
Evidence: `/tmp/gitrelay-offline-message.VZDWtoHi/probe.mjs`.

A second fixture combined the same unavailable ref with a malformed ref cursor.
A direct `readRef` rejected with `Invalid ref cursor`, while `consumeMailbox`
reported only the Git failure. The concurrent initial reads settle, but the
first failure in Git, cursor, event order is thrown; the later state failure
is not exposed by that call. Evidence:
`/tmp/gitrelay-offline-corrupt-check.i2Q4UoTw/probe.mjs`.

No fallback was merged. Simply catching the Git error can hide a simultaneous
state error; skipping an upstream or file-filtered event can violate the
existing timestamp-and-ID delivery order. The SDK's current delivery callback
and `Notification[]` return value do not convey a synchronization error when
an ordinary message is delivered, and a hook that writes a response before
throwing may then exit unsuccessfully. A safe partial-success protocol and
host-visible warning remain unproven.

A private multiple-error diagnostic experiment reported the failing stages
before the primary error, preserving its Git exit-code cause in the tested
case. It was not merged: changing the thrown object to `AggregateError` changes
its identity and type, and its raw `.errors` can expose secondary state data.
An isolated Node `util.inspect` probe confirmed that an included JSON parse
error exposed a fragment of the synthetic state-file marker, even though the
outer `.message` did not. Evidence:
`/tmp/gitrelay-multifailure.wHe51A39/regression-leak.mjs`. The candidate's
cancellation behavior preserved the previous first-failure ordering; when a
Git failure precedes cancellation during another read, cancellation is not
necessarily the reported error.

The probes used Node v22.23.2, empty isolated HOME and Git configuration, and
a preload that makes Node `rm` and `unlink` no-ops. Git's own internal file
operations and ordinary atomic state writes were not intercepted. They did not
run a real coding-agent client, installer, daemon or GC. They do not establish
original-location crash recovery, host warning visibility, or CI results.

## Bounded trash scan regression (2026-10-27, Asia/Singapore)

The shared `synchronizeRef` scans trash names in batches of four, settling
all reads in a batch before returning an error or honoring cancellation. A
failure within a batch is processed in directory order. Concurrent reads can
change which failure wins when cancellation and errors race, and the
publication lock does not make an atomic snapshot against non-cooperating
external writers.

The following targeted regression used isolated HOME, temporary directories and
Git configuration, retained fixtures, and a preload rejecting Node deletion:

```sh
env -i PATH=/usr/bin:/bin HOME=/tmp/gitrelay-trash-batch.flVjiFwY \
  TMPDIR=/tmp/gitrelay-trash-batch.flVjiFwY GIT_CONFIG_GLOBAL=/dev/null \
  GIT_CONFIG_NOSYSTEM=1 GIT_TERMINAL_PROMPT=0 GITRELAY_KEEP_TEST_FIXTURES=1 \
  /Users/sheny/.nvm/versions/node/v22.23.2/bin/node \
  --disable-warning=ExperimentalWarning \
  --import /tmp/gitrelay-trash-batch.flVjiFwY/no-delete.mjs \
  --experimental-strip-types --test tests/core/trash-scan-parallel.test.ts
```

Four tests passed: the four-read bound and batch barrier; cancellation while
holding a real publication lock until all reads finish; a missing file,
unrelated name and ordered validation failure; and cancellation during a trash
directory read. The lock test replaces its own lock removal with a no-op, so
the fixture lock remains; normal project state commits still use atomic
rename, and Git's own file operations were not intercepted. TypeScript
`--noEmit` also passed. A repeat with a deliberately invalid inherited
`GIT_DIR` passed after isolating the Git subprocess environment. The fixture
currently skips Windows. Additional isolated probes covered oversized files,
pending events in `events`, duplicate pending events and a *simulated* trash
restore with and without a receipt. The simulated restore intercepted the
trash-to-events rename and did not test actual durable transfer. Evidence and
test inputs remain under `/tmp/gitrelay-trash-batch.flVjiFwY/`.

An independent review of the private candidate caught a cancellation regression
for unrelated directory names, which was fixed before integration. This local
regression does not establish real-client, daemon, GC, old-client crash, actual
trash restoration, Windows or CI behavior. Performance and memory boundaries
are recorded in [performance](performance.md#four-at-a-time-trash-recovery-scans-2026-10-27-asiasingapore).

## Git child process cancellation and timeout (2026-10-27, Asia/Singapore)

An isolated synthetic `git` executable ignored SIGTERM and recorded its PID.
With Node v22.23.2 and the current `git()` implementation, aborting the call
rejected with the original abort reason while the direct child was still alive.
A separate synthetic `execFile` probe confirmed that a child ignoring SIGTERM
can also outlive the built-in timeout and leave its callback pending. An
oversized-output child that ignored SIGTERM and its stdout error similarly
left `execFile` waiting after the output limit was exceeded. These probes do
not establish that ordinary Git behaves this way or that state corruption
occurred. Evidence includes `/tmp/gitrelay-git-child.U7cOGDDe/probe.mjs`.

A private candidate retained the initial SIGTERM, waited for the direct child's
exit after abort, and used SIGKILL escalation after a grace period; it also
added a watchdog beyond the existing timeout. In isolated tests it preserved
abort reason, Git exit 128 and spawn ENOENT causes. A real `withLock` probe
observed the lock still held while an aborted direct child remained alive, and
observed the attempted lock cleanup only after that child exited; Node removal
was intercepted, so the lock file remained and actual lock removal or restart
recovery was not tested. Shortened timeout/watchdog tests exercised timeout and
maxBuffer escalation; the production 30/31 second timing was not tested.
Independent review found that output overflow can still wait for the whole
watchdog period, and that a synthetic child can leave a descendant running
when it exits. The candidate does not establish process-tree termination,
Windows behavior, or bounded completion for uninterruptible processes or
inherited pipes. It remains private and has not been merged. Candidate and
probe evidence: `/tmp/gitrelay-git-lifecycle.vFzn0K2g/`.

The lifecycle probes contained an unsafe test cleanup pattern: `probe.mjs`,
`timeout.mjs`, `buffer.mjs` and `lock.mjs` each attempted SIGKILL once by PID
in `finally` after the direct child had already been observed as exited. Their
empty catches recorded neither return values nor errors, so the evidence
cannot establish whether each attempt returned ESRCH or encountered a reused
PID; unintended impact cannot be excluded. Those probes were stopped and the
pattern was not repeated. The earlier `gitrelay-git-child.U7cOGDDe` probe sent
SIGKILL while its own synthetic child was observed alive, then observed it
exit. No test files were removed or moved in this work. These local synthetic
probes are not real-client acceptance or CI evidence.

## Pi startup and session lifecycle regressions (2026-10-27, Asia/Singapore)

An isolated real-Git, simulated-host probe made the first Git lookup exit 75
and allowed subsequent lookups to succeed. The original extension emitted no
warning, made no further Git call over 5.6 seconds and did not register until
a second session start. The current watcher reports the error and retries; in
an empty non-repository it suppresses exit 128, retries and registers after a
repository is created. Git exit 128 is ambiguous and can also conceal damage,
permission or configuration failures. The watcher runs one Git lookup each
five-second interval while waiting. Evidence: `/tmp/gitrelay-pi-start-audit.V1DXYYB8/`
and `/tmp/gitrelay-pi-start-fix.RoJkpIfa/`.

On Node 22.23.2, `tests/adapters/pi-startup-retry.test.ts` and
`tests/adapters/pi-dialog-lifecycle.test.ts` passed 4/4 in an isolated HOME and
Git environment, with temporary paths containing a single quote and invalid
inherited GIT variables. The Node removal preload made `rm` a no-op and rejected
`unlink`; fixtures and locks were retained, while normal atomic state writes
and Git's internal operations were not intercepted. The tests cover recovery,
non-repository retries, disabled monitoring, waiting for an in-flight watcher
stop under an injected session-file read barrier, a stale menu, and a real
`joinSession` paused during Git lookup across shutdown. They do not verify a
real pi host, a model, native session switching, Git process termination,
normal lock removal, Windows or CI. TypeScript `--noEmit` and `git diff
--check` passed.

Independent review found and prompted fixes for shutdown returning while a
previous watcher was still stopping, plus path quoting and teardown issues in
the test. The final reviewed candidate was then applied to the shared source.
At that point same-session concurrent join/leave operations had no end-to-end
serialization. The later in-process queue and its limitations are documented
below. The separate AbortSignal Git child-process issue is not fixed by the
watcher changes.

## Repeated unconfirmed delivery and fairness (2026-10-27, Asia/Singapore)

An isolated real-Git fixture with synthetic registered sessions and messages
reproduced two SDK delivery limits. With individual delivery, the first eight
messages returned `false` on four checks and a ninth message was never tried.
Separately, a single large notification repeatedly returned `false` and a
later small message was not tried in four checks. The tests retained their
fixtures and copied state without retained locks between checks; they do not
establish actual lock recovery or real-host behavior. Evidence:
`/tmp/gitrelay-fairness-repro.xfpN5tqm/` and
`/tmp/gitrelay-fairness-oversize.EcduLrG5/`.

An in-memory simulated host that marked the first eight messages as pending
using `isPending` allowed a later message to be attempted in the next check,
without writing receipts for those pending messages. This depends on the host's
pending evidence and does not establish restart-safe deduplication. The SDK's
`false` result can also mean that a host has queued a message, so it is not
proof of rejection. The fairness issue remains unresolved; a persistent
rotation scheme would need recovery, migration, GC and mixed-version analysis.
The probes used isolated Git configuration and intercepted Node removal calls;
Git's internal file operations were not intercepted. No real coding agent,
installer, daemon, GC or CI was exercised.

## Pi subscription command serialization (2026-10-27, Asia/Singapore)

Pi `/worktree join` and `/worktree leave` now serialize their watcher and
subscription operations by session ID within one process. The queue is shared
across updated extension instances in that process; waiting commands recheck
whether their session is still current. An old extension without the queue,
other processes and direct SDK consumers are not coordinated. A stalled
operation delays subsequent commands using the same session ID, including a
coincidentally equal ID in another repository. This queue does not release or
recover filesystem locks.

On Node 22.23.2 the shared `tests/adapters/pi-dialog-queue.test.ts` was run in
an isolated HOME and Git configuration, with Node removal intercepted, test
fixtures and locks retained, and deliberately invalid inherited `GIT_DIR` and
`WORKTREE_SYNC_REPOSITORY_IDS`. Five cases passed: same-session join/leave
ordering; two simulated extension instances using path aliases and the same
ID; independent IDs; shutdown while leave is waiting; and a failed join
releasing the queue. In the shutdown case, the old leave performs no Git call,
emits no notice and leaves the subscription open. The shutdown test does
not by itself prove leave reached the queue; the ordering cases provide that
separate evidence. The pre-queue implementation failed the first two ordering
cases and the later shutdown case in private baselines; the independent-ID case
passed. The 250 ms no-progress observation is
bounded and does not establish a scheduling guarantee.

The no-delete fixture retains locks, so the follow-up leave can report busy;
the normal lock-release and successful close branch was not exercised. A
separate six-scenario synthetic-host probe used mocked watcher and subscription
operations, covering completion ordering, failures and session changes; it
is not a real pi host or lock test. Independent static review checked the
shared implementation, tests and limitations, and did not itself rerun the
suite. Fixtures and probes remain under
`/tmp/gitrelay-queue-regression.iGNiuVU6/` and
`/tmp/gitrelay-pi-dialog-fix.RYRrBBB9/`. No real coding-agent client, installer,
daemon, GC, Windows or CI was exercised.

## OpenCode first-lookup retry (2026-10-27, Asia/Singapore)

An isolated real Git repository with a simulated OpenCode host reproduced a
transient first `session.get` failure: the original adapter warned once, made
no further lookup and did not start a polling timer after the user prompt.
Evidence: `/tmp/gitrelay-oc-first-get.dn6zRwmQ/probe.mjs`. This is a simulated
host result, not a real OpenCode acceptance test.

The shared adapter now retains failed enrollment lookups for retry. It bounds
pending IDs and unfinished underlying background lookups to 128 per plugin
instance, and starts at most eight retry lookups per five-second poll. Session
deletion and shutdown cancel wrapper waits. An underlying lookup ignored by
the host still occupies its slot until it actually settles. A permanently
hung lookup can block the same recreated ID, and 128 hung lookups block later
background retries. Initial user-prompt lookups are outside that bound and
can still hang the hook. The location check and host prompt are not atomic;
session moves, missed deletion events and reused IDs remain subject to the
existing identity limitations. Messages published before registration are
not retroactively addressed to the session.

On macOS with Node 22.23.2, four regression tests passed using isolated Git
configuration, retained fixtures and a no-delete preload:
`tests/adapters/opencode-first-get-retry.test.ts`. They cover recovery without
another prompt, overlapping nonmatching and failed lookups, deleted/recreated
IDs with held host slots, and retry limits and scheduling. The tests skip
Windows and systems without `/usr/bin/git`. The preload made Node `rm`
a no-op and rejected `unlink`; Git's own internal file operations and ordinary
atomic state writes were not intercepted. The same assertions against a
private copy of the original adapter failed 0/4, as expected. Five existing
`opencode-get-cancellation.test.ts` tests, TypeScript `--noEmit` and
`git diff --check` also passed. Independent review prompted fixes for lookup
ordering, limits, fixture isolation and teardown; the reviewer did not rerun
the tests. Neither normal lock cleanup, a real OpenCode session, full suite
nor CI was tested. Evidence: `/tmp/gitrelay-oc-retry-candidate.4RGs/`.
