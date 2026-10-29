import { execFile, spawn } from "node:child_process";
import { homedir } from "node:os";
import { basename, isAbsolute } from "node:path";
import { promisify } from "node:util";
import { createInterface } from "node:readline";
import { z } from "zod";
import { PLUGIN_STORE_ID, releaseVersionSchema } from "../shared/plugin-updates.ts";
import { PLUGIN_VERSION } from "@mobile-dev/shared/version.ts";

const execute = promisify(execFile);
export const STORE_MARKETPLACE = "openai-curated-remote";
export const storeSummarySchema = z.object({
  remotePluginId: z.literal(PLUGIN_STORE_ID), name: z.literal("mobile-dev"), version: releaseVersionSchema,
  localVersion: releaseVersionSchema.nullable(), installed: z.boolean(), enabled: z.boolean(),
});
const storeResponseSchema = z.object({ plugin: z.object({ summary: storeSummarySchema }) });
const rpcResponseSchema = z.object({ id: z.number(), result: z.unknown().optional(), error: z.unknown().optional() });
export type StorePlugin = z.infer<typeof storeSummarySchema>;
export type ReadStore = () => Promise<unknown>;
export type RunCodex = (args: string[]) => Promise<unknown>;
export type ResolveCodexCli = () => Promise<string>;
export type CodexOptions = { path?: string; resolveCli?: ResolveCodexCli; env?: NodeJS.ProcessEnv; signal?: AbortSignal };
// Why an update step failed, tagged on migration failures: Codex was not found, a Codex
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

export async function readPluginStore(cwd: string, options: CodexOptions = {}): Promise<StorePlugin> {
  const path = await codexPath(cwd, options);
  options.signal?.throwIfAborted();
  const host = spawn(path, ["--no-daemon", "app-server", "--stdio"], {
    cwd, env: options.env ?? process.env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
  });
  const lines = createInterface({ input: host.stdout });
  const pending = new Map<number, { resolve: (result: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  let nextId = 1;
  function fail() {
    const error = new PluginUpdateError("Could not read the Codex plugin store catalog.", "store-unavailable");
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
  }
  function send(message: unknown) {
    const text = JSON.stringify(message);
    host.stdin.write(`${text}\n`);
  }
  function request(method: string, params: unknown): Promise<unknown> {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { fail(); host.kill(); }, 20000);
      pending.set(id, { resolve, reject, timer });
      send({ id, method, params });
    });
  }
  function abort() { fail(); host.kill(); }
  host.stderr.resume();
  host.on("error", fail);
  host.on("exit", fail);
  host.stdin.on("error", fail);
  options.signal?.addEventListener("abort", abort, { once: true });
  lines.on("line", line => {
    let data: unknown;
    try { data = JSON.parse(line); } catch { return; }
    const parsed = rpcResponseSchema.safeParse(data);
    if (parsed.success === false) return;
    const response = parsed.data;
    const request = pending.get(response.id);
    if (request === undefined) return;
    clearTimeout(request.timer);
    pending.delete(response.id);
    if (response.error) {
      const error = new PluginUpdateError("Codex could not read the plugin store catalog.", "store-unavailable");
      request.reject(error);
    } else request.resolve(response.result);
  });
  try {
    await request("initialize", {
      clientInfo: { name: "mobile-dev-updates", version: PLUGIN_VERSION },
      capabilities: { experimentalApi: true, requestAttestation: false },
    });
    send({ method: "initialized" });
    const result = await request("plugin/read", { remoteMarketplaceName: STORE_MARKETPLACE, pluginName: "mobile-dev" });
    const parsed = storeResponseSchema.parse(result);
    return parsed.plugin.summary;
  } finally {
    options.signal?.removeEventListener("abort", abort);
    for (const request of pending.values()) clearTimeout(request.timer);
    lines.close();
    host.kill();
  }
}
