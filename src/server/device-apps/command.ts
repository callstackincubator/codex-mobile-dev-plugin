import { execFile } from "node:child_process";
import type { ExecFileOptionsWithStringEncoding } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { foregroundCauses, setDiscoveryCommandDiagnostic } from "../../shared/device-apps-command-diagnostics.ts";
import type { DiscoveryCommand, DiscoveryCause, DiscoveryCommandDiagnostic, CommandTermination } from "../../shared/device-apps-command-diagnostics.ts";

const execute = promisify(execFile);
const version = z.literal(1);
const cause = z.enum(foregroundCauses);
const diagnosticObject = z.object({ version, cause });
const helperDiagnostic = diagnosticObject.strict();
const prefix = "mobile-dev-foreground-error:";
const signalSchema = z.enum(["SIGABRT", "SIGBUS", "SIGFPE", "SIGILL", "SIGKILL", "SIGPIPE", "SIGSEGV", "SIGTERM", "SIGTRAP"]);

type CommandOptions = ExecFileOptionsWithStringEncoding & { encoding: "utf8"; timeout: number; maxBuffer: number };
type Runner = (file: string, args: string[], options: CommandOptions) => Promise<{ stdout: string; stderr?: string }>;

function foregroundCause(stderr: string): DiscoveryCause | undefined {
  for (const line of stderr.split("\n")) {
    if (line.startsWith(prefix) === false) continue;
    try {
      const text = line.slice(prefix.length);
      const payload: unknown = JSON.parse(text);
      const parsed = helperDiagnostic.safeParse(payload);
      if (parsed.success) return parsed.data.cause;
    } catch { /* Native diagnostic output may be interrupted by process termination. */ }
  }
}

function commandCause(command: DiscoveryCommand, stderr: string): DiscoveryCause | undefined {
  if (command === "ios_simulator_foreground" || command === "ios_physical_foreground") return foregroundCause(stderr);
  if (command === "ios_simulator_apps") {
    if (/device is not booted|current state: Shutdown|Unable to boot device in current state: Shutdown/i.test(stderr)) return "device_not_booted";
    if (/Invalid device:|Unable to find device|No device found/i.test(stderr)) return "device_not_found";
  }
  if (command.startsWith("android_")) {
    if (/device offline/i.test(stderr)) return "device_offline";
    if (/device unauthorized/i.test(stderr)) return "device_unauthorized";
    if (/device .* not found|no devices\/emulators found/i.test(stderr)) return "device_not_found";
  }
}

export function annotateDiscoveryCommand(error: unknown, command: DiscoveryCommand, elapsed: number,
  options: CommandOptions): unknown {
  if (error === null || typeof error !== "object") return error;
  const roundedElapsed = Math.round(elapsed);
  const elapsedMs = Math.max(0, roundedElapsed);
  let termination: CommandTermination = "unknown";
  let cause: DiscoveryCause = "unknown";
  const code = "code" in error ? error.code : undefined;
  const name = "name" in error ? error.name : undefined;
  const signal = "signal" in error ? error.signal : undefined;
  if (code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") { termination = "output_limit"; cause = "output_limit"; }
  else if (name === "AbortError") {
    const reason: unknown = options.signal?.reason;
    const timedOut = reason instanceof Error && reason.name === "TimeoutError";
    termination = timedOut ? "deadline" : "cancelled";
    cause = timedOut ? "deadline_exceeded" : "cancelled";
  } else if (name === "TimeoutError") { termination = "deadline"; cause = "deadline_exceeded"; }
  else if (code === "ENOENT") { termination = "spawn_error"; cause = "missing_executable"; }
  else if (code === "ETIMEDOUT" || ("killed" in error && error.killed === true && elapsed >= options.timeout)) {
    termination = "deadline"; cause = "deadline_exceeded";
  } else if (typeof signal === "string") { termination = "signal"; cause = "process_signalled"; }
  else if (typeof code === "number") { termination = "exit"; cause = "command_failed"; }
  else if (typeof code === "string") termination = "spawn_error";
  if (termination === "exit" && "stderr" in error && typeof error.stderr === "string") {
    const identified = commandCause(command, error.stderr);
    if (identified !== undefined) cause = identified;
  }
  const diagnostic: DiscoveryCommandDiagnostic = { command, cause, termination, elapsed_ms: elapsedMs, deadline_ms: options.timeout };
  if (typeof code === "number" && Number.isInteger(code) && code >= 0 && code <= 255) diagnostic.exit_status = code;
  if (typeof signal === "string") {
    const parsed = signalSchema.safeParse(signal);
    diagnostic.signal = parsed.success ? parsed.data : "other";
  }
  setDiscoveryCommandDiagnostic(error, diagnostic);
  return error;
}

export async function runDiscoveryCommand(command: DiscoveryCommand, file: string, args: string[],
  options: CommandOptions, run: Runner = execute): Promise<{ stdout: string; stderr?: string }> {
  const startedAt = performance.now();
  try {
    return await run(file, args, options);
  } catch (error) {
    const elapsed = performance.now() - startedAt;
    const annotated = annotateDiscoveryCommand(error, command, elapsed, options);
    throw annotated;
  }
}
