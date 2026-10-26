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

## Conclusions and limits

- The daemon centralizes Git-ref monitoring but does not eliminate per-session directory/receipt scans. Three-session empty polling at 10,000 events fell from about four seconds to 0.8 seconds. It remains linear and does not establish support for unlimited backlog or large session counts.
- Inspect `sessions` and a `gc` preview, then safely collect acknowledged events. Do not delete unread messages or expire offline sessions for speed. Without the optional daemon, maintenance is explicit.
- No database, queue service, or event index was introduced. Consider an index compatible with receipt/GC semantics only if scans remain a measured bottleneck, without dropping unread events or skipping receipt validation.
- This benchmark measures broadcast-storage scans, not huge repositories, long histories, enormous file lists, cold caches, or multi-process lock contention. It does not establish latency for those cases.
