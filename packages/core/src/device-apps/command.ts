import { execFile } from "node:child_process";
import type { ExecFileOptionsWithStringEncoding } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { foregroundCauses, setDiscoveryCommandDiagnostic } from "@mobile-dev/shared/device-apps-command-diagnostics.ts";
import { classifyProcessFailure, isExitStatus, type ProcessTermination } from "@mobile-dev/shared/error-diagnostics.ts";
import type { DiscoveryCommand, DiscoveryCause, DiscoveryCommandDiagnostic, CommandTermination } from "@mobile-dev/shared/device-apps-command-diagnostics.ts";

const execute = promisify(execFile);
const version = z.literal(1);
const cause = z.enum(foregroundCauses);
const diagnosticObject = z.object({ version, cause });
const helperDiagnostic = diagnosticObject.strict();
const prefix = "mobile-dev-foreground-error:";

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

const terminations: Record<ProcessTermination, CommandTermination> = {
  exit: "exit", signal: "signal", deadline: "deadline", cancelled: "cancelled", output_limit: "output_limit",
  missing_executable: "spawn_error", system_error: "spawn_error", invalid_response: "unknown", connection_failed: "unknown", unknown: "unknown",
};
const causes: Partial<Record<ProcessTermination, DiscoveryCause>> = {
  exit: "command_failed", signal: "process_signalled", deadline: "deadline_exceeded", cancelled: "cancelled",
  output_limit: "output_limit", missing_executable: "missing_executable",
};

export function annotateDiscoveryCommand(error: unknown, command: DiscoveryCommand, elapsed: number,
  options: CommandOptions): unknown {
  if (error === null || typeof error !== "object") return error;
  const roundedElapsed = Math.round(elapsed);
  const elapsedMs = Math.max(0, roundedElapsed);
  const failure = classifyProcessFailure(error, { elapsed, timeout: options.timeout, signal: options.signal });
  const termination = terminations[failure.termination];
  let cause = causes[failure.termination] ?? "unknown";
  if (termination === "exit" && "stderr" in error && typeof error.stderr === "string") {
    const identified = commandCause(command, error.stderr);
    if (identified !== undefined) cause = identified;
    else if (command === "android_foreground_pid" && failure.status === 1 && error.stderr.trim() === "") cause = "foreground_unavailable";
  }
  const diagnostic: DiscoveryCommandDiagnostic = { command, cause, termination, elapsed_ms: elapsedMs, deadline_ms: options.timeout };
  if (isExitStatus(failure.status)) diagnostic.exit_status = failure.status;
  if (failure.signal !== undefined) diagnostic.signal = failure.signal;
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
