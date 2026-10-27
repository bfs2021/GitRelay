export interface SyncResult {
  state: "updated" | "up-to-date" | "ahead" | "blocked" | "error";
  remote?: string;
  reason?: string;
}

// A different Git process may switch HEAD after a check but before merge.
// Until the ref and worktree can be protected together, perform no writes.
export async function syncBranch(_cwd: string, _branch: string, signal?: AbortSignal): Promise<SyncResult> {
  signal?.throwIfAborted();
  return { state: "blocked", reason: "Automatic branch synchronization is temporarily unavailable because concurrent Git operations can update the wrong branch. Stop other Git operations and synchronize manually; see the migration guide." };
}
