import type { ErrorCategory } from "./error-reporting.ts";
import type { CommandFailure } from "./device-command-diagnostics.ts";
import type { DiscoveryCommandDiagnostic } from "./device-apps-command-diagnostics.ts";
import type { DeviceAppsDiagnostic } from "./device-apps-diagnostics.ts";
import type { DefinitionDiagnostic } from "./simulator-definition-diagnostics.ts";
import type { AndroidStartupContext, AndroidStartupFailure } from "./android-startup-diagnostics.ts";

// Errors carry what Sentry may learn about them beside the error rather than in its message, which can
// name apps, URLs, serials and paths. Each module records its own diagnostic; capture sites read them all here.
export type ErrorDiagnostics = {
  category?: ErrorCategory;
  command?: CommandFailure & { command: string };
  discoveryCommand?: DiscoveryCommandDiagnostic;
  deviceApps?: DeviceAppsDiagnostic;
  definition?: DefinitionDiagnostic;
  androidStartup?: { startup: AndroidStartupFailure; context: AndroidStartupContext };
  installIntegrity?: { integrity: "removed" | "replaced" | "incomplete"; runtime: "serve-emu" | "baguette" };
};

const records = new WeakMap<object, ErrorDiagnostics>();

export function errorDiagnostics(error: unknown): Readonly<ErrorDiagnostics> {
  if (error === null || typeof error !== "object") return {};
  return records.get(error) ?? {};
}

export function setErrorDiagnostic<K extends keyof ErrorDiagnostics>(error: object, key: K, value: NonNullable<ErrorDiagnostics[K]>) {
  const record = records.get(error);
  if (record) record[key] = value;
  else records.set(error, { [key]: value });
}

// Signals reported by name; any other is reported as other.
export const commandSignals = ["SIGABRT", "SIGBUS", "SIGFPE", "SIGILL", "SIGKILL", "SIGPIPE", "SIGSEGV", "SIGTERM", "SIGTRAP"] as const;
export type CommandSignal = typeof commandSignals[number] | "other";
export type ProcessTermination = "exit" | "signal" | "deadline" | "cancelled" | "output_limit" | "missing_executable"
  | "system_error" | "invalid_response" | "connection_failed" | "unknown";
// status is the error's numeric code and signal the signal it names, whichever termination they explain.
export type ProcessFailure = { termination: ProcessTermination; status?: number; signal?: CommandSignal };
// A caller that timed the command: a killed command must have outlived its deadline, and an abort for a
// timeout counts as one.
type CommandRun = { elapsed: number; timeout: number; signal?: AbortSignal };

/** How a command, request or response failed, read from the Node, fetch and zod error fields rather than messages. */
export function classifyProcessFailure(error: unknown, run?: CommandRun): ProcessFailure {
  if (error === null || typeof error !== "object") return { termination: "unknown" };
  const code = "code" in error ? error.code : undefined;
  const name = "name" in error ? error.name : undefined;
  const signal = "signal" in error ? error.signal : undefined;
  const cause = "cause" in error && error.cause !== null && typeof error.cause === "object" && "code" in error.cause ? error.cause.code : undefined;
  const failure: ProcessFailure = { termination: "unknown" };
  if (typeof code === "number") failure.status = code;
  if (typeof signal === "string") failure.signal = commandSignals.find(known => known === signal) ?? "other";
  // execFile kills a command that outlives its timeout; fetch rejects with a TimeoutError.
  const killed = "killed" in error && error.killed === true && (run === undefined || run.elapsed >= run.timeout);
  const reason: unknown = run?.signal?.reason;
  if (code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") failure.termination = "output_limit";
  else if (name === "TimeoutError" || code === "ETIMEDOUT" || killed) failure.termination = "deadline";
  else if (name === "AbortError") failure.termination = reason instanceof Error && reason.name === "TimeoutError" ? "deadline" : "cancelled";
  else if (code === "ENOENT") failure.termination = "missing_executable";
  else if (typeof signal === "string") failure.termination = "signal";
  else if (typeof code === "number") failure.termination = "exit";
  else if (typeof code === "string") failure.termination = "system_error";
  else if (name === "ZodError" || name === "SyntaxError") failure.termination = "invalid_response";
  // fetch reports a refused or dropped connection as a TypeError caused by the socket error.
  else if (name === "TypeError" && typeof cause === "string") failure.termination = "connection_failed";
  return failure;
}

export function isExitStatus(status: number | undefined): status is number {
  return status !== undefined && Number.isInteger(status) && status >= 0 && status <= 255;
}

export function discoveryCommandTags(error: unknown): Record<string, string> {
  const diagnostic = errorDiagnostics(error).discoveryCommand;
  if (diagnostic === undefined) return {};
  const tags: Record<string, string> = { discovery_command: diagnostic.command, discovery_cause: diagnostic.cause,
    discovery_termination: diagnostic.termination };
  if (diagnostic.signal !== undefined) tags.discovery_signal = diagnostic.signal;
  return tags;
}

export function deviceAppsDiagnosticTags(error: unknown): Record<string, string> {
  const diagnostic = errorDiagnostics(error).deviceApps;
  const commandTags = discoveryCommandTags(error);
  if (diagnostic === undefined) return commandTags;
  return { ...commandTags, discovery_stage: diagnostic.stage, discovery_failure: diagnostic.failure,
    device_platform: diagnostic.platform, device_kind: diagnostic.kind };
}

export function definitionDiagnosticTags(error: unknown): Record<string, string> {
  const diagnostic = errorDiagnostics(error).definition;
  if (diagnostic === undefined) return {};
  return {
    definition_stage: diagnostic.stage, definition_failure: diagnostic.failure,
    definition_model: diagnostic.model, definition_runtime: diagnostic.runtime,
    definition_device_state: diagnostic.state, definition_device_before: diagnostic.deviceBefore, definition_device_after: diagnostic.deviceAfter,
    definition_panel: diagnostic.panel, definition_xcode_version: diagnostic.xcodeVersion,
    definition_backend_version: diagnostic.backendVersion, definition_backend_source: diagnostic.backendSource,
    definition_backend_mode: diagnostic.backendMode, definition_cached_failure: diagnostic.cachedFailure,
  };
}

export function androidStartupDiagnosticTags(error: unknown): Record<string, string> {
  const diagnostic = errorDiagnostics(error).androidStartup;
  if (diagnostic === undefined) return {};
  const { startup, context } = diagnostic;
  return {
    android_startup_stage: startup.stage, android_startup_outcome: startup.outcome,
    android_device_state_before: context.stateBefore, device_platform: "android",
    device_kind: context.deviceKind, android_transport: context.transport,
    android_cleanup_overlap: context.stoppingBackends > 0 ? "yes" : "no",
  };
}

export function installIntegrityTags(error: unknown): Record<string, string> {
  const diagnostic = errorDiagnostics(error).installIntegrity;
  if (diagnostic === undefined) return {};
  return { install_integrity: diagnostic.integrity, bundled_runtime: diagnostic.runtime };
}

/** Low-cardinality tags, safe on outcome metrics as well as error reports. */
export function diagnosticTags(error: unknown): Record<string, string> {
  return deviceAppsDiagnosticTags(error);
}

/** Tags only error reports carry, after the capture site's own tags. */
export function diagnosticReportTags(error: unknown): Record<string, string> {
  return { ...definitionDiagnosticTags(error), ...androidStartupDiagnosticTags(error), ...installIntegrityTags(error) };
}

export function diagnosticContexts(error: unknown): Record<string, Record<string, number | undefined>> | undefined {
  const command = errorDiagnostics(error).discoveryCommand;
  if (command === undefined) return;
  return { device_apps_command: { elapsed_ms: command.elapsed_ms, deadline_ms: command.deadline_ms, exit_status: command.exit_status } };
}

// The tags that tell one failure episode from another; their order is part of the signature.
export const episodeSignatureTags = ["discovery_stage", "discovery_failure", "device_platform", "device_kind",
  "discovery_command", "discovery_cause", "discovery_termination"] as const;
// The tags that split a capture site's Sentry issues, after its operation and error category.
export const fingerprintTags = ["resource_kind", "discovery_stage", "discovery_failure", "discovery_command", "discovery_cause"] as const;
