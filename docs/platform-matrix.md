# Platform capability and verification matrix

Only Codex and OpenCode v2 have maintained integrations. Native sessions default
off and require an explicit coordination request or `join`. Installing an entry
point does not activate any conversation.

| Capability                    | Codex                                                           | OpenCode v2                                                                                    |
| ----------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Entry point                   | Lifecycle hooks / bundled plugin                                | Promise plugin (`id`, `setup`)                                                                 |
| Enable                        | Direct user prompt or native-session `join`                     | Direct user prompt or exact-instance `join`                                                    |
| Trigger while off             | Command hook reads prompt and session choice; no Git lookup     | Prompt hook reads native identity and session choice; no Git lookup or background subscription |
| Busy delivery                 | Additional context after tools; Stop continuation               | Durable host queue                                                                             |
| Already idle                  | Waits for next hook                                             | Five-second polling can start a turn                                                           |
| Disable                       | Explicit prompt or `leave`; unread events preserved             | Same; cancels checks and drains known in-flight delivery                                       |
| Resume                        | Same native session retains choice                              | Same data root, creation time, session, worktree and ref retain choice                         |
| Recreated native ID           | Depends on host session-ID uniqueness                           | Different native instance; separate inbox and activation                                       |
| Installation                  | Managed user hooks, with separate `/hooks` trust; manual plugin | Managed global entry or manual project entry                                                   |
| Historical real-host evidence | CLI 0.164.0 on earlier source snapshots                         | 2.1.2 on earlier source snapshots                                                              |
| Current on-demand flow        | Local regression coverage; real-host acceptance pending         | Local regression coverage; real-host acceptance pending                                        |

The declared OpenCode peer range `^2.1.2` is a dependency constraint, not proof
that every matching host is accepted. Minimum full-lifecycle compatibility is
not established. The new activation behavior requires rebuilding and refreshing
installed copies; source changes alone do not update clients.

OpenCode deletion events stop in-process checks but do not automatically close
persisted subscriptions. Verify the exact old instance before manual `leave`.
Missed deletion events are not replayed. Host session lookup and prompt admission
are not atomic, and an accepted prompt cannot be retracted by disabling GitRelay.
A hung host admission can delay shutdown.

Messages have stable IDs and independent receipts; normal operation deduplicates,
while crash windows can cause retries. A receipt does not prove completed agent
work. Automatic branch synchronization remains blocked. Repository replacement,
legacy inboxes, and historical delivery proofs require explicit recovery rather
than deleting state.

See [integrations](integrations.md), [migration](migration.md), and
[acceptance](acceptance.md) for details and evidence boundaries.
