import { commandSignals, type CommandSignal } from "./device-apps-command-diagnostics.ts";

// Device setting and app control failures reach Sentry with a fixed message, because command output and
// backend replies can name apps, URLs, serials and paths. These tags say which command failed and how,
// read from error codes, statuses and types rather than messages.

type CommandFailureKind = "exit" | "signal" | "deadline" | "cancelled" | "output_limit" | "missing_executable"
  | "system_error" | "connection_failed" | "http_status" | "rejected" | "invalid_response" | "unexpected_output" | "unknown";
type CommandFailure = { failure: CommandFailureKind; status?: number; signal?: CommandSignal };

const commands = new WeakMap<object, CommandFailure & { command: string }>();
// Labels come from code, such as simctl_launch or baguette_interface; anything else is reported as other.
const labelPattern = /^[a-z][a-z_]{0,47}$/;

export function classifyCommandFailure(error: unknown): CommandFailure {
  if (error === null || typeof error !== "object") return { failure: "unknown" };
  const code = "code" in error ? error.code : undefined;
  const name = "name" in error ? error.name : undefined;
  const signal = "signal" in error ? error.signal : undefined;
  const cause = "cause" in error && error.cause !== null && typeof error.cause === "object" && "code" in error.cause ? error.cause.code : undefined;
  if (code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return { failure: "output_limit" };
  // execFile kills a command that outlives its timeout; fetch rejects with a TimeoutError.
  if (name === "TimeoutError" || code === "ETIMEDOUT" || ("killed" in error && error.killed === true)) return { failure: "deadline" };
  if (name === "AbortError") return { failure: "cancelled" };
  if (code === "ENOENT") return { failure: "missing_executable" };
  if (typeof signal === "string") return { failure: "signal", signal: commandSignals.find(known => known === signal) ?? "other" };
  if (typeof code === "number") return Number.isInteger(code) && code >= 0 && code <= 255 ? { failure: "exit", status: code } : { failure: "exit" };
  if (typeof code === "string") return { failure: "system_error" };
  if (name === "ZodError" || name === "SyntaxError") return { failure: "invalid_response" };
  // fetch reports a refused or dropped connection as a TypeError caused by the socket error.
  if (name === "TypeError" && typeof cause === "string") return { failure: "connection_failed" };
  return { failure: "unknown" };
}

/** Names the command an error came from, unless an inner step already did, and returns the same error. */
export function annotateDeviceCommand<T>(error: T, command: string, failure: CommandFailure = classifyCommandFailure(error)): T {
  if (error !== null && typeof error === "object" && !commands.has(error)) commands.set(error, { command, ...failure });
  return error;
}

/** Gives an error built from a failure's message the command and failure that failure was annotated with. */
export function inheritDeviceCommand<T>(error: T, from: unknown): T {
  const named = from !== null && typeof from === "object" ? commands.get(from) : undefined;
  if (named && error !== null && typeof error === "object" && !commands.has(error)) commands.set(error, named);
  return error;
}

// Backend routes name a device by ID; the label keeps only the route's fixed words, such as baguette_interface.
export function backendCommand(backend: "baguette" | "serve_emu", path: string): string {
  const route = path.replace(/^\/(?:simulators\/[^/]+\/|api\/)?/, "").replace(/\.json$/, "").replace(/[-/.]/g, "_");
  return `${backend}_${route}`;
}

/** The command a failure came from, when one was named, and how it failed. */
export function deviceCommandTags(error: unknown): Record<string, string> {
  const named = error !== null && typeof error === "object" ? commands.get(error) : undefined;
  const { failure, status, signal } = named ?? classifyCommandFailure(error);
  const tags: Record<string, string> = { device_command_failure: failure };
  if (named) tags.device_command = labelPattern.test(named.command) ? named.command : "other";
  if (status !== undefined) tags.device_command_status = String(status);
  if (signal !== undefined) tags.device_command_signal = signal;
  return tags;
}
