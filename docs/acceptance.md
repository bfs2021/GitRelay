# GitRelay acceptance

## Current scope

The maintained integrations are Codex hooks and OpenCode v2. Sessions default
off; the current refactor introduces explicit per-session activation and removes
other clients' source, installers, dependencies, tests, and benchmarks.

Local regression coverage includes:

- Ordinary prompts do not register receivers, query Git, or emit branch status.
- English/Chinese direct requests enable the current session only; questions,
  quoted examples, tool output, and negations do not enable it.
- Activation is isolated by worktree, ref, adapter, session and native instance.
- Disabling preserves unread events, closes enrollment, and permits explicit rejoin.
- Codex context injection, Stop continuation, recursion and subagent guards.
- OpenCode durable queue admission, independent per-event receipts, stable IDs,
  retry after uncertain admission, session replacement, cancellation and recovery.
- Installer ownership, cancellation, runtime digests, and safe configuration updates.
- Shared Git history, repository identity, independent inboxes, causal delivery,
  state validation, backpressure, daemon behavior and confirmed-event cleanup.

Run the checks for the exact source revision being evaluated:

```sh
npm ci --ignore-scripts --omit=optional
npm run typecheck
npm test
npm run build:codex-plugin
npm pack --dry-run
```

CI is configured for macOS/Linux on Node.js 22.19.0 and 24. A local pass does not
establish hosted CI status or actual hook discovery/trust in a client.

## Real-client acceptance still required for this refactor

In disposable repositories with isolated state and client configuration:

1. Install/reinstall the new runtime; verify Codex discovery and normal `/hooks`
   trust, and the OpenCode v2 entry.
2. Send ordinary prompts to two conversations. Confirm neither registers or polls.
3. Explicitly enable one conversation. Verify only it receives marked upstream
   changes and messages; the other conversation remains inactive.
4. Verify busy delivery, idle behavior, no duplicate normal admission, disable
   during an in-flight delivery, and preservation of unread messages.
5. Resume the same conversation and recreate an ID with a different native
   instance. Verify saved activation resumes only the original instance.
6. Check offline delivery, Git/host failures, restart, upgrade/uninstall, and a
   separate repository sharing the state root.

Record client versions, source revision, commands, raw outputs, host admissions,
receipts and model responses separately. A successful queue admission does not
prove the model read every item or completed the requested adaptation.

## Historical evidence

[`acceptance-results.json`](acceptance-results.json) is retained as historical
raw evidence from source snapshots before the two-client/on-demand refactor.
It includes retired clients, old test counts, and old source/build hashes. Its
results do not verify the current source or the new default-off behavior.
History remains available in Git; it is not a current support matrix.

Forced termination, power-loss durability, permanent host deduplication, Windows
client lifecycle, and complete real-model acceptance of this refactor are not
established. See [platform boundaries](platform-matrix.md).
