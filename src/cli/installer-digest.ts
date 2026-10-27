import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, open, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

/** Preserve each installer’s published digest while reading verified files in bounded chunks. */
export async function installerDigest(root: string, paths: string[], kind: "runtime" | "pi" | "claude", signal?: AbortSignal): Promise<string> {
  const hash = createHash("sha256");
  const witnesses: { path: string; follow: boolean; directory: boolean; dev: bigint; ino: bigint; size: bigint; mtime: bigint; ctime: bigint }[] = [];
  const remember = (path: string, follow: boolean, info: BigIntStats) => {
    witnesses.push({ path, follow, directory: info.isDirectory(), dev: info.dev, ino: info.ino, size: info.size, mtime: info.mtimeNs, ctime: info.ctimeNs });
  };
  async function walk(relative: string, top: boolean): Promise<void> {
    signal?.throwIfAborted();
    const path = join(root, relative);
    // Legacy runtime/Claude roots followed directory symlinks; nested links and all pi links were rejected.
    const getInfo = top && kind !== "pi" ? stat : lstat;
    const info = await getInfo(path, { bigint: true });
    if (info.isFile()) {
      if (top && kind !== "pi") throw Object.assign(new Error(`Not a directory: ${path}`), { code: "ENOTDIR" });
      const file = await open(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0));
      try {
        const before = await file.stat({ bigint: true });
        if (!before.isFile() || before.dev !== info.dev || before.ino !== info.ino || before.size > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`Installer file changed while reading: ${path}`);
        if (kind === "pi") hash.update(JSON.stringify([relative, Number(before.size)])).update("\0");
        else if (kind === "claude") hash.update(relative).update("\0").update(String(before.size)).update("\0");
        else hash.update(`${Buffer.byteLength(relative)}:`).update(relative).update(`${before.size}:`);
        const buffer = Buffer.allocUnsafe(Number(before.size < 65_536n ? before.size + 1n : 65_536n)); let size = 0n;
        for (;;) {
          signal?.throwIfAborted();
          const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
          if (!bytesRead) break;
          size += BigInt(bytesRead);
          if (size > before.size) throw new Error(`Installer file changed while reading: ${path}`);
          hash.update(buffer.subarray(0, bytesRead));
        }
        const after = await file.stat({ bigint: true }), named = await lstat(path, { bigint: true });
        if (!named.isFile() || named.dev !== before.dev || named.ino !== before.ino || after.size !== before.size || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs || named.size !== after.size || named.mtimeNs !== after.mtimeNs || named.ctimeNs !== after.ctimeNs || size !== before.size) throw new Error(`Installer file changed while reading: ${path}`);
        remember(path, false, named);
      } finally { await file.close(); }
      return;
    }
    if (!info.isDirectory()) throw new Error(`Unexpected installer entry: ${path}`);
    const entries = await readdir(path, { withFileTypes: true });
    entries.sort(kind === "pi" ? (a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0 : (a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      signal?.throwIfAborted();
      if (!entry.isDirectory() && !entry.isFile()) throw new Error(`Unexpected installer entry: ${join(path, entry.name)}`);
      await walk(join(relative, entry.name), false);
    }
    const after = await getInfo(path, { bigint: true });
    if (!after.isDirectory() || after.dev !== info.dev || after.ino !== info.ino || after.mtimeNs !== info.mtimeNs || after.ctimeNs !== info.ctimeNs) throw new Error(`Installer directory changed while reading: ${path}`);
    remember(path, top && kind !== "pi", after);
  }
  for (const path of paths) await walk(path, true);
  for (let offset = 0; offset < witnesses.length; offset += 32) {
    signal?.throwIfAborted();
    const results = await Promise.allSettled(witnesses.slice(offset, offset + 32).map(async ({ path, follow, directory, dev, ino, size, mtime, ctime }) => {
      signal?.throwIfAborted();
      const current = await (follow ? stat : lstat)(path, { bigint: true });
      if ((directory ? !current.isDirectory() : !current.isFile()) || current.dev !== dev || current.ino !== ino || current.size !== size || current.mtimeNs !== mtime || current.ctimeNs !== ctime) throw new Error(`Installer entry changed while reading: ${path}`);
    }));
    for (const result of results) if (result.status === "rejected") throw result.reason;
  }
  signal?.throwIfAborted();
  return hash.digest("hex");
}
