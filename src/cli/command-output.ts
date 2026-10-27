import { spawn } from "node:child_process";

export async function commandOutput(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeout: number,
  limit: number,
  signal?: AbortSignal,
): Promise<string> {
  return (await commandOutputs(command, args, env, timeout, limit, signal)).stdout;
}

export async function commandOutputs(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeout: number,
  limit: number,
  signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string }> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [],
      errors: Buffer[] = [];
    let size = 0,
      failure: Error | undefined;
    const stop = (error: Error) => {
      if (failure) return;
      failure = error;
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
      child.stdout.destroy();
      child.stderr.destroy();
    };
    const timer = setTimeout(() => stop(new Error("Command timed out")), timeout);
    const abort = () => stop(signal?.reason instanceof Error ? signal.reason : new Error("Command cancelled"));
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) stop(new Error("Command output is too large"));
      else target.push(chunk);
    };
    child.stdout.on("data", collect(chunks));
    child.stderr.on("data", collect(errors));
    child.on("error", stop);
    child.on("close", (code, terminationSignal) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (failure) reject(failure);
      else if (code !== 0) {
        const diagnostic = Buffer.concat(errors).toString("utf8").trim().slice(0, 4096);
        reject(
          new Error(
            `Command failed${terminationSignal ? ` (signal ${terminationSignal})` : ""}${diagnostic ? `: ${diagnostic}` : ""}`,
          ),
        );
      } else
        resolve({ stdout: Buffer.concat(chunks).toString("utf8"), stderr: Buffer.concat(errors).toString("utf8") });
    });
  });
}
