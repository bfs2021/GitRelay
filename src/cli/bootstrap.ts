import { link, lstat, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

/** Replace only a recognized owned launcher, preserving any displaced file. */
export async function publishBootstrap(path: string, expected: string | undefined, source: string): Promise<void> {
  if (expected === source) return;
  const temporary = path + "." + randomUUID() + ".tmp";
  await writeFile(temporary, source, { flag: "wx", mode: 0o600 });
  let archived: string | undefined;
  try {
    if (expected !== undefined) {
      const before = await lstat(path);
      const directory = await mkdtemp(join(dirname(path), ".git-relay-launcher-"));
      archived = join(directory, "previous.mjs");
      await rename(path, archived);
      const moved = await lstat(archived);
      if (
        !moved.isFile() ||
        moved.dev !== before.dev ||
        moved.ino !== before.ino ||
        moved.size !== Buffer.byteLength(expected) ||
        (await readFile(archived, "utf8")) !== expected
      )
        throw new Error("Launcher changed during migration");
    }
    await link(temporary, path);
  } catch (cause) {
    if (archived) {
      try {
        await link(archived, path);
      } catch {
        /* Preserve a concurrent replacement and the archive. */
      }
      throw new Error(
        "GitRelay launcher migration did not complete; inspect " + path + " and preserved archive " + archived,
        { cause },
      );
    }
    throw cause;
  } finally {
    await rm(temporary, { force: true });
  }
}
