import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { basename, isAbsolute } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
/** The marketplace Codex installs the store's Mobile Dev from. */
export const STORE_MARKETPLACE = "openai-curated-remote";
export type RunCodex = (args: string[]) => Promise<unknown>;
export type ResolveCodexCli = () => Promise<string>;
export type CodexOptions = { path?: string; resolveCli?: ResolveCodexCli; env?: NodeJS.ProcessEnv; signal?: AbortSignal };
// Why an update step failed, tagged on migration failures and failed checks: Codex was not found, a Codex
// command or the store catalog failed, Codex answered unexpectedly, or a step's result
// did not hold.
export type UpdateFailure = "codex-not-found" | "command-failed" | "invalid-response" | "store-unavailable" | "foreign-marketplace" | "not-removed" | "not-verified" | "cache-write";

export class PluginUpdateError extends Error {
  readonly failure: UpdateFailure;

  constructor(message: string, failure: UpdateFailure) {
    super(message);
    this.failure = failure;
  }
}

export async function resolveCodexCli(parentPid = process.ppid, cwd = homedir()): Promise<string> {
  const pid = String(parentPid);
  const result = await execute("/bin/ps", ["-p", pid, "-o", "comm="], { cwd, timeout: 5000, maxBuffer: 4096 });
  const path = result.stdout.trim();
  const absolute = isAbsolute(path);
  const name = basename(path);
  if (absolute === false || name !== "codex") throw new PluginUpdateError("Could not locate the Codex executable that launched Mobile Dev.", "codex-not-found");
  return path;
}

/** Reuses the launching Codex path while the parent process is unchanged; failed lookups are not kept. */
export function codexCliResolver(cwd: string, resolve: (parentPid: number, cwd: string) => Promise<string> = resolveCodexCli): ResolveCodexCli {
  let cached: { parentPid: number; path: Promise<string> } | undefined;
  return () => {
    const parentPid = process.ppid;
    if (cached?.parentPid === parentPid) return cached.path;
    const entry = { parentPid, path: resolve(parentPid, cwd) };
    cached = entry;
    entry.path.catch(() => { if (cached === entry) cached = undefined; });
    return entry.path;
  };
}

function codexPath(cwd: string, options: CodexOptions): Promise<string> {
  if (options.path !== undefined) return Promise.resolve(options.path);
  return options.resolveCli?.() ?? resolveCodexCli(process.ppid, cwd);
}

export function createCodexRunner(cwd: string, options: CodexOptions = {}): RunCodex {
  const environment = options.env ?? process.env;
  const env = { ...environment, GIT_TERMINAL_PROMPT: "0" };
  const lookup = { ...options, resolveCli: options.resolveCli ?? codexCliResolver(cwd) };
  return async args => {
    const path = await codexPath(cwd, lookup);
    let stdout: string;
    try {
      const result = await execute(path, args, { cwd, timeout: 120000, maxBuffer: 1024 * 1024, env, signal: options.signal });
      stdout = result.stdout;
    } catch {
      throw new PluginUpdateError("Codex could not complete the Mobile Dev update command. Try again.", "command-failed");
    }
    try { return JSON.parse(stdout); }
    catch { throw new PluginUpdateError("Codex returned an invalid update response. Try again.", "invalid-response"); }
  };
}
