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

## Conclusions and limits

- The daemon centralizes Git-ref monitoring but does not eliminate per-session directory/receipt scans. The latest local runs measured roughly 0.63–0.71 seconds for three-session empty polling at 10,000 events. It remains linear and does not establish support for unlimited backlog or large session counts.
- Inspect `sessions` and a `gc` preview, then safely collect acknowledged events. Do not delete unread messages or expire offline sessions for speed. Without the optional daemon, maintenance is explicit.
- No database, queue service, or event index was introduced. Consider an index compatible with receipt/GC semantics only if scans remain a measured bottleneck, without dropping unread events or skipping receipt validation.
- The broadcast-storage benchmark does not measure huge repositories, long histories, enormous file lists, cold caches, or multi-process lock contention. The separate history benchmark covers up to 500 commits in a small repository; other cases remain unmeasured.
