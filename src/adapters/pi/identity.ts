import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { realpathSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { hash } from "../../core/store.ts";
import type { Identity } from "../../core/mailbox.ts";

/** Bind a native history to its file and creation time, preserving identity on resume. */
export function piIdentity(manager: Pick<ExtensionContext["sessionManager"], "getSessionId" | "getSessionFile"> & Partial<Pick<ExtensionContext["sessionManager"], "getHeader">>): Identity {
  const session = manager.getSessionId();
  const header = manager.getHeader?.();
  if (!header || header.id !== session || !Number.isFinite(Date.parse(header.timestamp))) throw new Error("Pi session changed or its header does not identify the active session");
  const file = manager.getSessionFile();
  let path: string | null = null;
  if (file) {
    try { path = realpathSync(file); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      path = join(realpathSync(dirname(file)), basename(file));
    }
  }
  return { adapter: "pi", session, instance: hash([path, header.timestamp]) };
}
