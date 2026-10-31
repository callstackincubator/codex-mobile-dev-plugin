import { classifyProcessFailure, errorDiagnostics, isExitStatus, setErrorDiagnostic, type CommandSignal } from "./error-diagnostics.ts";

// Device setting and app control failures reach Sentry with a fixed message, because command output and
// backend replies can name apps, URLs, serials and paths. These tags say which command failed and how,
// read from error codes, statuses and types rather than messages.

type CommandFailureKind = "exit" | "signal" | "deadline" | "cancelled" | "output_limit" | "missing_executable"
  | "system_error" | "connection_failed" | "http_status" | "rejected" | "invalid_response" | "unexpected_output" | "unknown";
export type CommandFailure = { failure: CommandFailureKind; status?: number; signal?: CommandSignal };

// Labels come from code, such as simctl_launch or baguette_interface; anything else is reported as other.
const labelPattern = /^[a-z][a-z_]{0,47}$/;

export function classifyCommandFailure(error: unknown): CommandFailure {
  const { termination, status, signal } = classifyProcessFailure(error);
  if (termination === "exit") return isExitStatus(status) ? { failure: "exit", status } : { failure: "exit" };
  if (termination === "signal") return { failure: "signal", signal };
  return { failure: termination };
}

/** Names the command an error came from, unless an inner step already did, and returns the same error. */
export function annotateDeviceCommand<T>(error: T, command: string, failure: CommandFailure = classifyCommandFailure(error)): T {
  if (error !== null && typeof error === "object" && !errorDiagnostics(error).command) setErrorDiagnostic(error, "command", { command, ...failure });
  return error;
}

/** Gives an error built from a failure's message the command and failure that failure was annotated with. */
export function inheritDeviceCommand<T>(error: T, from: unknown): T {
  const named = errorDiagnostics(from).command;
  if (named && error !== null && typeof error === "object" && !errorDiagnostics(error).command) setErrorDiagnostic(error, "command", named);
  return error;
}

// Backend routes name a device by ID; the label keeps only the route's fixed words, such as baguette_interface.
export function backendCommand(backend: "baguette" | "serve_emu", path: string): string {
  const route = path.replace(/^\/(?:simulators\/[^/]+\/|api\/)?/, "").replace(/\.json$/, "").replace(/[-/.]/g, "_");
  return `${backend}_${route}`;
}

/** The command a failure came from, when one was named, and how it failed. */
export function deviceCommandTags(error: unknown): Record<string, string> {
  const named = errorDiagnostics(error).command;
  const { failure, status, signal } = named ?? classifyCommandFailure(error);
  const tags: Record<string, string> = { device_command_failure: failure };
  if (named) tags.device_command = labelPattern.test(named.command) ? named.command : "other";
  if (status !== undefined) tags.device_command_status = String(status);
  if (signal !== undefined) tags.device_command_signal = signal;
  return tags;
}
