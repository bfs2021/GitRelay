# GitRelay local acceptance records

These are historical acceptance records from before the rename. Original command names, paths, measurements, and results remain as evidence; translating this document does not constitute a new acceptance run.

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

- `tests/core/regressions.test.ts`: historical directory-style events remain readable/acknowledgeable/collectable; sending rejects existing directories; corrupt daemon state allows local fallback; send-first migration does not overwrite ordinary upstream events; publication retries add recipients while preserving receipts; orphan/unrelated HEADs report actionable errors and retain unread events; prunable worktree registrations can be safely removed.
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
- Clients trust only matching fresh daemon/ref state and fall back on staleness.
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
