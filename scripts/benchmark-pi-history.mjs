import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createWatcher, WATCH_MESSAGE } from "../dist/adapters/pi/watch.js";
import { sessionKey } from "../dist/core/mailbox.js";
import { hash, repository } from "../dist/core/store.js";

const temporary = await mkdtemp(join(tmpdir(), "git-relay-pi-history-bench-"));
const previousState = process.env.WORKTREE_SYNC_STATE_DIR;
const git = (...args) => execFileSync("git", ["-C", temporary, "-c", "user.name=Benchmark", "-c", "user.email=benchmark@example.test", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
try {
  git("init", "-b", "main");
  await writeFile(join(temporary, "shared.txt"), "base\n");
  git("add", "shared.txt");
  git("commit", "-m", "baseline");
  for (const historyEntries of [1000, 10000]) {
    process.env.WORKTREE_SYNC_STATE_DIR = join(temporary, `state-${historyEntries}`);
    const manager = SessionManager.inMemory(temporary);
    for (let i = 0; i < historyEntries - 1000; i++) manager.appendCustomEntry("unrelated", { i });
    let branchReads = 0;
    const getBranch = manager.getBranch.bind(manager);
    manager.getBranch = (...args) => { branchReads++; return getBranch(...args); };
    const warnings = [];
    const watcher = createWatcher({ sendMessage() { assert.fail("native-accepted events must not be queued again"); } }, {
      cwd: temporary, hasPendingMessages: () => false, isIdle: () => true, sessionManager: manager,
      ui: { notify(message) { warnings.push(message); } },
    }, "refs/heads/main");
    try {
      await watcher.tick();
      const repo = await repository(temporary);
      const key = sessionKey(repo, { adapter: "pi", session: manager.getSessionId() }, "refs/heads/main");
      const receipts = join(repo.directory, "receipts", key);
      const ids = [];
      const at = new Date().toISOString();
      for (let i = 0; i < 1000; i++) {
        const id = hash(["pi-history-benchmark", i]);
        ids.push(id);
        await writeFile(join(repo.directory, "events", `${id}.json`), JSON.stringify({ id, kind: "message", createdAt: at, sender: { adapter: "benchmark", session: "sender", root: repo.root }, recipients: [key], text: "benchmark", files: [] }));
        manager.appendCustomMessageEntry(WATCH_MESSAGE, "already accepted", false, { eventIds: [id] });
      }
      const samples = [];
      const traversals = [];
      for (let i = 0; i < 3; i++) {
        await rm(receipts, { recursive: true, force: true });
        branchReads = 0;
        const start = performance.now();
        await watcher.tick();
        samples.push(performance.now() - start);
        traversals.push(branchReads);
        assert.deepEqual(warnings, []);
        assert.deepEqual((await readdir(receipts)).sort(), ids.map((id) => `${id}.json`).sort());
      }
      await watcher.tick();
      assert.deepEqual(warnings, []);
      console.log(JSON.stringify({ node: process.version, historyEntries, missingReceipts: ids.length, samples: 3, medianMs: Math.round(samples.sort((a, b) => a - b)[1] * 10) / 10, branchTraversals: traversals }));
    } finally { await watcher.stop(); }
  }
} finally {
  if (previousState === undefined) delete process.env.WORKTREE_SYNC_STATE_DIR;
  else process.env.WORKTREE_SYNC_STATE_DIR = previousState;
  await rm(temporary, { recursive: true, force: true, maxRetries: 3 });
}
