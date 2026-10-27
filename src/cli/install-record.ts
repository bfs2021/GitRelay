import { lstat } from "node:fs/promises";
import { readJson } from "../core/store.ts";

// Installation records are replaced atomically, so a symlink cannot be treated
// as an owned record even when its target contains valid JSON.
export async function readInstallationRecord(path: string, platform: string): Promise<unknown | undefined> {
  try {
    if (!(await lstat(path)).isFile()) throw new Error(`Invalid ${platform} installation record: ${path}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const record = await readJson(path);
  if (record === undefined) throw new Error(`Invalid ${platform} installation record: ${path}`);
  return record;
}
