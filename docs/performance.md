# GitRelay performance benchmarks

## Reproduce

```sh
npm run benchmark
```

The script creates and removes a temporary Git repository, three receiver worktrees, and an isolated state directory. It does not read user messages, install services, or call models. Requires local Git and Node.js 22.19+. Benchmarks are excluded from CI because shared-runner load can distort results.

Fixed scenario:

- Retain 100, 1,000, or 10,000 broadcasts, each with three recipients and valid individual receipts.
- Exclude event/receipt preparation from timing. Measure sequentially in one process with warm OS file caches.
- Empty polling: check all three sessions sequentially, repeat three times, report the median.
- Offline recovery: revoke one recipient's last 32 receipts, then measure four consumption/persistent-acknowledgement batches. This is not recovery of all 10,000 messages from scratch.
- Daemon comparisons use real `runDaemon`, wait for initial monitoring/cleanup, and assert it remains alive. Acknowledged events remain within seven-day retention, so enabling the daemon does not shrink the dataset.
- Assert no empty-poll delivery, exactly 32 unique recovery IDs, no repeat delivery, and persistence of all successful receipts. Stop the daemon and restore environment variables afterward.

## Initial local results

2026-10-25 UTC, macOS arm64, Node `22.23.2`, Git `2.54.0 (Apple Git-157)`. Values are rounded milliseconds.

| Retained events | Daemon | Median empty poll, 3 sessions | Recover 32, 1 session |
| ---: | :---: | ---: | ---: |
| 100 | Off | 224 | 518 |
| 100 | On | 332 | 418 |
| 1,000 | Off | 1,156 | 588 |
| 1,000 | On | 401 | 466 |
| 10,000 | Off | 4,398 | 4,620 |
| 10,000 | On | 4,212 | 7,314 |

The preceding run on the same machine measured 4,178 / 4,116 ms for 10,000-event empty polling and 4,534 / 4,525 ms for recovery. Background load and disk caches cause variation. Recovery is a single measurement, not evidence that the daemon is always faster.

## Before and after optimization

Same machine, runtime, script, and dataset sizes; no benchmark change or reduction in retained events. Values are milliseconds to one decimal place.

| Retained events | Daemon | Empty poll before | Empty poll after | Recover 32 before | Recover 32 after |
| ---: | :---: | ---: | ---: | ---: | ---: |
| 100 | Off | 137.8 | 119.1 | 173.7 | 164.4 |
| 100 | On | 82.9 | 60.5 | 108.0 | 119.7 |
| 1,000 | Off | 465.4 | 255.4 | 522.2 | 284.4 |
| 1,000 | On | 419.3 | 116.3 | 463.9 | 178.0 |
| 10,000 | Off | 4,065.2 | 846.8 | 4,443.4 | 1,026.0 |
| 10,000 | On | 4,086.0 | 767.6 | 4,374.2 | 984.2 |

A repeat after optimization measured 774.1 / 865.2 ms for 10,000-event empty polling (daemon off/on) and 1,139.8 / 1,079.3 ms for recovery. Both runs passed deduplication, receipt, unread-recovery, and daemon-liveness assertions. Empty polling improved about 79–81%, recovery about 74–78%; smaller recovery cases varied, so not every scenario is claimed faster.

Only the read path changed:

- Under the session lock, enumerate receipt filenames, then read and validate matching receipts before skipping event bodies. File existence alone is not acknowledgement. No receipt cache, new state format, or migration was added.
- Read at most 32 entries concurrently per batch and await the entire batch before returning or throwing. Sort only unacknowledged events by timestamp and ID; the eight-event delivery limit remains.
- GC does not apply session filtering and still validates all retained events before deletion. Acknowledged event-body corruption is no longer detected by that session's polling, but unacknowledged consumers and GC still report it.
- At the time of optimization, `npm run typecheck`, `npm test` (61/61), and `npm pack --dry-run` passed. Regressions cover ordering across read batches, corrupt-receipt rejection, redelivery after receipt deletion, independent recipients, and GC validation. These are historical results, not rerun by translating this document.

## Small-file read overhead (2026-10-27, Asia/Singapore)

`readJson` now uses the standard library's callback-backed `fs.readFile`, adapted once with `util.promisify`. This reduces small-file read overhead while preserving the Promise API, the pre-read 2 MiB size check, UTF-8 decoding, JSON parsing, and error propagation. Every receipt is still read and validated on every scan; there is no cache or state-format change.

Measured against commit `c8e732c` on macOS arm64, Node `22.23.2`, Git `2.54.0 (Apple Git-157)`, using the unchanged benchmark above. Values are milliseconds; before and after are separate runs with the same dataset sizes.

| Retained events | Daemon | Empty poll before | Empty poll after | Recover 32 before | Recover 32 after |
| ---: | :---: | ---: | ---: | ---: | ---: |
| 100 | Off | 132.5 | 111.4 | 162.5 | 155.5 |
| 100 | On | 75.7 | 63.8 | 95.7 | 100.9 |
| 1,000 | Off | 159.5 | 200.9 | 240.2 | 277.3 |
| 1,000 | On | 114.1 | 105.3 | 187.1 | 144.7 |
| 10,000 | Off | 784.3 | 672.1 | 1,078.3 | 891.9 |
| 10,000 | On | 776.7 | 674.8 | 913.2 | 768.5 |

A second optimized run measured 630.4 / 713.5 ms for 10,000-event empty polling (daemon off/on), and 813.6 / 923.2 ms for recovery. Relative to the baseline run, large-backlog empty polling took about 8–20% less time across these runs. Recovery and smaller cases varied; this is not evidence of a speedup in every scenario or runtime. All three benchmark runs passed their delivery, deduplication, receipt-persistence, and daemon-liveness assertions.

The storage regression test additionally checks UTF-8 content, the exact size boundary, oversized files, missing files, malformed JSON, and propagation of non-ENOENT errors. `npm run typecheck` and all 121 tests in `npm test` passed for this change.

## Bounded history reads (2026-10-27, Asia/Singapore)

Reproduce the separate upstream-history benchmark:

```sh
npm run build
node scripts/benchmark-history.mjs
```

It creates an isolated temporary repository and receiver worktree, retains 10, 100, then 500 first-parent commits, and measures the median of three `inspectChange` calls at each size. Most commits affect an unrelated file; two edit and then restore a file with local receiver changes. Setup is excluded. Assertions check the complete ordered commit list, overlapping filename, detection of the reverted intermediate edit, and patch order. The repository is removed afterward.

The comparison uses the same local runtime as the small-file benchmark. The baseline already includes that optimization; only the history-reading change differs.

| Commits | Serial reads, ms | Four concurrent reads, ms | Less elapsed time |
| ---: | ---: | ---: | ---: |
| 10 | 182.2 | 105.7 | 42% |
| 100 | 903.7 | 423.9 | 53% |
| 500 | 4,008.9 | 1,230.2 | 69% |

A repeat optimized run measured 109.6, 341.7, and 1,281.1 ms respectively and passed all assertions. The 500-commit case took about 68–69% less time across the two optimized runs relative to the baseline.

`inspectChange` reads changed filenames in batches of at most four Git processes. Results stay in first-parent order, and the entire batch settles before an error propagates out of the consumer lock. Existing cancellation signals reach every Git call. Patch generation and snapshot comparisons retain their existing behavior. The regression test spans three batches, including an empty commit, unrelated commits, and an edit followed by a later revert. `npm run typecheck` and all 122 tests in `npm test` passed.

This reduces waiting time, not the number of Git subprocesses. The limit is per inspection, not global across sessions. It can increase peak CPU and memory use; these results do not establish gains on low-core systems, under simultaneous session load, or when many commits require large patches. The mailbox benchmark above measures a different workload.

## Concurrent worktree reads (2026-10-27, Asia/Singapore)

```sh
npm run build
node scripts/benchmark-worktree.mjs
```

The benchmark creates and removes an isolated repository, excludes setup and one warm-up from timing, and measures 20 calls to `worktreeFiles`. Each call asserts the union of committed, staged, unstaged, untracked, and ignored paths, including staged and unstaged edits that cancel in a net diff.

Against `8d2ceae`, on macOS arm64 with Node `22.23.2` and Git `2.54.0 (Apple Git-157)`, the serial baseline median was 41.1 ms. Three optimized runs measured 26.4, 28.3, and 22.5 ms (31–45% less elapsed time). These are small-repository, warm-cache measurements, not end-to-end mailbox speedups.

The four independent reads after HEAD and merge-base resolution now run concurrently. Results are combined in the original order, and all child processes settle before an error leaves the caller's lock. Cancellation still reaches each Git process. No Git command, file category, state format, or receipt validation was removed. `npm run typecheck` and all 122 tests passed; the new benchmark also passed its assertions in all four runs.

The unchanged history benchmark also passed on retry (10/100/500 commits: 85.8/360.9/1,223.1 ms); the first standalone rerun failed during temporary-directory cleanup with `ENOTEMPTY`, so it is not counted as successful validation. Its leftover benchmark directory was removed. History timings do not show a consistent gain across sizes.

The change increases peak concurrency to four Git processes per worktree scan without reducing total process count. Many simultaneous sessions and low-core systems remain unmeasured. Long-history batch reads were investigated but not adopted in this pass: preserving commit/file framing and existing output-size behavior requires additional validation.

## Batched first-parent history (2026-10-27, Asia/Singapore)

The next pass replaces one filename-reading Git process per commit with one `git log --no-walk=unsorted --diff-merges=first-parent` call per batch of up to 32 commits. For 500 commits, that stage uses 16 processes instead of 500. This does not change the ordered commit list, intermediate-edit detection, or patch previews. Snapshot comparisons after rewrites or second-parent advances still use the original explicit before/after diff.

Reproduce with `npm run build` followed by `node scripts/benchmark-history.mjs`. The script now disables automatic Git maintenance in its temporary repository and retries transient directory-removal failures up to three times. A repeat previously failed with `ENOTEMPTY` during cleanup; it is excluded from the comparison below. Disabling housekeeping isolates the measurement from background Git work; it does not establish the cause of that failure.

Both sides below use this same updated fixture and the concurrent worktree reads from the preceding section. The baseline restores only the previous four-at-a-time, per-commit history implementation. Same macOS arm64, Node `22.23.2`, Git `2.54.0 (Apple Git-157)`; times are median milliseconds from three inspections at each size.

| Commits | Per-commit baseline | Batched run 1 | Batched run 2 |
| ---: | ---: | ---: | ---: |
| 10 | 86.3 | 84.4 | 70.2 |
| 100 | 294.6 | 102.2 | 102.0 |
| 500 | 1,405.3 | 251.3 | 251.2 |

The 500-commit scenario took about 82% less elapsed time in both runs. All three runs completed their ordering, overlap, reverted-edit, and patch assertions and cleaned up successfully. These results concern filename inspection in a small repository, not arbitrary large patches or cold caches.

NUL-framed output is checked for complete records and exact commit order. Regressions cover 67 commits with empty commits at batch boundaries, merges, newline and hash-shaped filenames, user log/color settings, malformed output, and the existing rewrite/second-parent cases. If a combined result exceeds the existing 16 MiB subprocess buffer, that batch falls back to individual diffs, at most four concurrently, so separately readable commits remain readable without serializing the former parallel path. Other failures and cancellations propagate; no partial result is acknowledged. The failed combined attempt adds overhead for exceptionally large filename lists; the original per-commit limit is retained. Initial validation passed `npm run typecheck` and all 124 tests in `npm test`; see the final audit below for the current suite.

## Session discovery and GC metadata (2026-10-27, Asia/Singapore)

```sh
npm run build
node scripts/benchmark-maintenance.mjs
```

This isolated fixture stores 100 then 1,000 valid session records and the same number of retained message events, each with three recipients and valid receipts. Setup is excluded; each measurement is the median of three calls with warm filesystem caches. It measures registry size, not 1,000 simultaneously running clients. GC uses `apply: true` with the default retention period and must retain every event. Untimed assertions subsequently remove one receipt, verify that only that unread event survives zero-retention collection, restore the receipt, and verify complete event/receipt/journal cleanup.

Same macOS arm64, Node `22.23.2`, Git `2.54.0 (Apple Git-157)` as above. All three runs used the identical script and completed successfully. Values are milliseconds.

| Sessions / events | Operation | Before | After 1 | After 2 |
| ---: | --- | ---: | ---: | ---: |
| 100 | Session discovery | 5.4 | 1.9 | 1.7 |
| 100 | Retained-event GC | 82.8 | 67.1 | 62.4 |
| 1,000 | Session discovery | 98.8 | 20.8 | 19.0 |
| 1,000 | Retained-event GC | 813.8 | 646.7 | 629.6 |

Session discovery reads at most 32 records concurrently, preserves directory order, validates each record, and settles the whole batch before propagating an error. At 1,000 sessions this reduced elapsed time by about 79–81%.

GC reuses successfully validated migration status only inside one invocation holding `publish.lock`, which also protects the relay's session metadata writes. There is no cache across GC calls. Every receipt is still read and validated independently under its recipient lock; retention calculation and journaled deletion remain unchanged. For 1,000 events, repeated session metadata reads fall from 3,000 to three, and measured GC time fell about 21–23%. This does not remove its per-event lock cost or establish throughput under competing consumers. Regressions cover multiple session-read batches, corrupt session records, migration changes between collections, missing session records, and an unread event after another event from the same session was collected. `npm run typecheck` and all 126 tests passed.

## Concurrent CLI consumers (2026-10-27, Asia/Singapore)

```sh
npm run build
node scripts/benchmark-concurrency.mjs
```

This benchmark runs 1, 4, then 8 independent CLI processes with separate session identities in one worktree. Each scenario retains 1,000 broadcasts acknowledged by every session. Each round starts all `check` processes together and times completion of the entire group, including Node startup and IPC. Setup is excluded; filesystem caches are warm. The optional daemon uses its actual polling/cleanup implementation in the parent process, and each scenario verifies its liveness. The script uses only an isolated temporary repository/state root.

Same local macOS/Node/Git versions as above. Median group completion time over three idle rounds, milliseconds. The final validation run additionally exercised the untimed zero-retention deletion race described below.

| CLI processes | Daemon | Run 1 | Run 2 | Validation run |
| ---: | :---: | ---: | ---: | ---: |
| 1 | Off | 96.8 | 80.4 | 91.5 |
| 1 | On | 89.1 | 78.8 | 80.5 |
| 4 | Off | 204.4 | 178.1 | 197.3 |
| 4 | On | 121.2 | 124.2 | 132.6 |
| 8 | Off | 308.6 | 315.1 | 330.2 |
| 8 | On | 189.0 | 180.6 | 203.3 |

Every process then recovers eight revoked receipts, with assertions for exact event IDs, no duplicate delivery on the next poll, and persisted successful receipts. Eight-process recovery took 308–321 ms without the daemon and 201–240 ms with it. These are concurrent group completion times, not per-process averages.

A separate simultaneous retained-event GC plus poll round took 169–998 ms across these runs. Depending on scheduling, GC skipped 0–998 events because a consumer held a recipient lock. All events were preserved, and all CLI calls completed without lock-timeout errors. This variation reflects the existing safety/fairness behavior and does not support a stable GC speedup claim.

The script also exercises zero-retention deletion racing with eight-message recovery per consumer. Its initial assertion incorrectly required delivery in the first poll even when GC held the session lock. The corrected assertion permits a skipped first poll, requires the exact missing IDs on the following uncontended poll, then requires no duplicate delivery. In the successful validation run, 1/1, 2/4, and 6/8 consumers skipped their first poll and all recovered afterward. A final uncontended collection removed all acknowledged events, receipts, and journal entries. No production lock behavior was changed.

The measured 1–8-process scenarios give no reason to relax receipt validation or recipient/publication locks. They do not establish behavior for hundreds of concurrent clients, slow disks, other operating systems, or cold caches. Registry-size measurements in the preceding section remain distinct from this process-concurrency test.

## Pi native-history acknowledgement (2026-10-27, Asia/Singapore)

```sh
npm run build
node scripts/benchmark-pi-history.mjs
```

This fixture uses the installed pi `1.4.0` SDK's real in-memory `SessionManager`, with 1,000 or 10,000 native history entries and 1,000 already accepted relay messages whose local receipts must be reconstructed. It is an adapter/core benchmark, not a live interactive pi acceptance test. Each sample removes only its own temporary receipts, times one watcher tick, and checks that every receipt is recreated without queueing a duplicate or reporting warnings. Three samples form each median. Setup and SDK import are excluded.

| Native entries | Before 1, ms | Before 2, ms | After 1, ms | After 2, ms |
| ---: | ---: | ---: | ---: | ---: |
| 1,000 | 1,176.3 | 263.0 | 242.9 | 230.9 |
| 10,000 | 473.1 | 633.3 | 231.0 | 226.5 |

The small baseline varied substantially; it does not support a stable percentage claim. For the 10,000-entry case, the measured range fell from 473–633 ms to 227–231 ms. More directly, instrumentation of the actual SDK method confirmed that each 1,000-event scan went from 1,000 full `getBranch()` traversals to one in every optimized sample.

Within a single watcher check, native event IDs are reused only while both session ID and leaf ID remain unchanged. Both are checked for every acknowledgement lookup, so a native append or branch switch invalidates the set immediately. The set is discarded between checks. Queued follow-ups still require native acceptance before writing receipts; delivery and retry semantics are unchanged. Regression coverage uses the real SDK to append an acceptance during a scan and then rewind the native branch. Existing queued-message, cancellation, and duplicate tests remain in place. `npm run typecheck` and all 127 tests passed.

## Large ignored file trees (2026-10-27, Asia/Singapore)

`scripts/benchmark-worktree.mjs` now additionally creates 1,000, 10,000, then 100,000 ignored files across directories of 100 files each. After one warm-up, it measures five worktree scans plus matcher construction, asserting the complete filename set, a matching file, file/directory prefix overlap, and rejection of a nonexistent sibling. Setup and assertions are excluded from timing; temporary files are removed afterward.

On the same local runtime, medians were 49.1, 46.9, and 133.9 ms respectively. The smaller cases vary with process startup and scheduling. This does not justify replacing exact filename relevance with coarse directory matches or dropping ignored files. The test covers warm caches and short filenames, not arbitrary repository sizes or network storage.

## Successful atomic writes (2026-10-27, Asia/Singapore)

After a successful `rename`, the temporary JSON path no longer exists. `writeJson` now performs temporary-file removal only on failure, eliminating one redundant filesystem removal attempt per successful state write. Write/rename/serialization errors still clean up and propagate. Regression tests verify replacement contents, private file permissions, preservation of the old value on serialization failure, preservation of an obstructing directory, missing-parent errors, and absence of leftover temporary files. `npm run typecheck` and all 128 tests passed.

With the preceding pi optimization already present, two subsequent native-history runs measured 210.1/217.4 ms at 1,000 entries and 304.4/228.8 ms at 10,000 entries; all assertions passed and each recovery still traversed the branch once. These variable end-to-end timings do not establish an additional consistent speedup for the write change. The verified reduction is one unnecessary filesystem operation per successful write.

## Auto-sync operation checks (2026-10-27, Asia/Singapore)

```sh
npm run build
node scripts/benchmark-sync.mjs
```

The benchmark uses an isolated linked worktree and local-file remote. It times seven already-up-to-date `syncBranch` calls after one warm-up, verifies the result, HEAD, file content, and clean worktree after every call, and removes its temporary state. The median fell from 188.6 ms to 140.1 and 139.8 ms in two optimized runs, about 26% less time. This excludes network latency and does not imply a comparable percentage for Internet fetches.

Git operation-marker checks now run in batches of at most four. All seven markers still use Git's own per-worktree path resolution and are considered in the original order. Each batch settles before an error or blocked result releases the writer lock. Tests independently verify all seven markers in a linked worktree, in addition to the existing dirty-worktree, ignored-file, divergence, missing-upstream, and failed-fetch cases.

## Conclusions and limits

- The daemon centralizes Git-ref monitoring but does not eliminate per-session directory/receipt scans. The latest local runs measured roughly 0.63–0.71 seconds for three-session empty polling at 10,000 events. It remains linear and does not establish support for unlimited backlog or large session counts.
- Inspect `sessions` and a `gc` preview, then safely collect acknowledged events. Do not delete unread messages or expire offline sessions for speed. Without the optional daemon, maintenance is explicit.
- No database, queue service, or event index was introduced. Consider an index compatible with receipt/GC semantics only if scans remain a measured bottleneck, without dropping unread events or skipping receipt validation.
- The broadcast-storage benchmark measures a different workload from the separate history, concurrency, native-history, and file-tree benchmarks. Those cover up to 500 commits, eight CLI processes, 10,000 native history entries, and 100,000 ignored files respectively; cold caches, network storage, and other operating systems remain unmeasured.

## Final audit (2026-10-27, Asia/Singapore)

The completed audit uses the original stopping criterion: pursue reproducible gains in reasonable project workloads while preserving correctness, and stop when no further demonstrated gain justifies added complexity. It does not claim a mathematical optimum for every machine or input.

| Area | Final evidence | Remaining cost / decision |
| --- | --- | --- |
| Mailbox polling and recovery | All 100/1,000/10,000-event assertions passed. At 10,000 events, three-session empty polling measured 650.3/600.5 ms and 32-message recovery 832.1/765.2 ms, daemon off/on. | Directory and receipt validation remains linear. Skipping validation or introducing a persistent index would change the integrity/design tradeoff; not justified by these runs. |
| Upstream history | Ordered commits, intermediate reverts, merges, unusual names, snapshots, malformed output and oversized combined output are covered. Final 500-commit median: 237.4 ms. | Batched Git reads retain the existing per-commit size boundary; the overflow path preserves four-process concurrency and waits for all children. |
| Worktree relevance | Exact filename and prefix assertions passed through 100,000 ignored files; final large-tree median 124.7 ms. | Exact file relevance is retained rather than broadening matches or omitting ignored paths. |
| Session discovery and GC | Final 1,000-record scan 16.7 ms; 1,000-event retained GC 593.7 ms. Corruption, migration refresh, unread preservation and journal cleanup assertions passed. | Session validation is reused only under the publication lock. Receipts and recipient locks remain independent per event. |
| Concurrent processes | Independent CLI groups through eight processes passed empty polling, recovery, deduplication, receipt persistence and concurrent deletion/retry assertions. Final eight-process idle median 321.1/175.5 ms, daemon off/on. | Busy consumers may skip a poll and recover later. Lock backoff/ownership checks are retained. |
| Pi native history | Final 10,000-entry/1,000-receipt recovery median 205.8 ms; one native branch traversal per scan. Actual SDK tests cover append during a scan and branch rewind. | Cache lifetime is one check and invalidation uses both leaf and session IDs. No live-host latency claim. |
| Auto-sync | All seven operation markers, dirty/ignored work, divergence and fetch failures are covered; local-remote medians 140.1/139.8 ms. | Fresh status and HEAD checks around fetch/merge remain; network latency is outside this local comparison. |

The final source review also checked hook input limits, pi/OpenCode polling overlap guards, daemon liveness/fallback, Git subprocess time/output limits, and state/lock failure cleanup. No dependency, public API signature, persistent state format, retention rule, acknowledgement requirement, or opt-in sync behavior changed. Network/host-bound calls and integrity checks were not replaced with stale caches.

Final `npm run typecheck` and `npm test` passed all 129 tests after the overflow fallback review. The mailbox, history, worktree, maintenance, concurrency, native-history and local-sync benchmarks all completed their self-checks. Timing suites ran sequentially, separate from unit tests. The remaining unmeasured environments above are explicit limits, not claimed results. No further local optimization is currently supported by the collected evidence without changing the stated tradeoffs.

`npm pack --dry-run --json` succeeded with 70 package files. The manifest contains all seven benchmark scripts and the performance guide; all six changed compiled modules were compared with the current TypeScript build output and matched exactly. No dependency, Git directory, or benchmark state directory was included.
