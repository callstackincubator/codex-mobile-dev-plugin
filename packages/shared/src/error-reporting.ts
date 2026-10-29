import { getDiscoveryCommandDiagnostic } from "./device-apps-command-diagnostics.ts";
import { errorDiagnostics, setErrorDiagnostic } from "./error-diagnostics.ts";

export const expectedOutcomes = ["session_expired", "session_closed", "cancelled", "device_unavailable", "app_unavailable", "resource_limit", "unsupported_platform", "invalid_input"] as const;
export type ExpectedOutcome = typeof expectedOutcomes[number];

export class ExpectedOperationError extends Error {
  readonly outcome: ExpectedOutcome;

  constructor(outcome: ExpectedOutcome, message: string) {
    super(message);
    this.outcome = outcome;
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function expectedOutcome(error: unknown): ExpectedOutcome | undefined {
  if (error instanceof ExpectedOperationError) return error.outcome;
  const command = getDiscoveryCommandDiagnostic(error);
  if (command?.termination === "deadline") return;
  if (command?.cause === "cancelled") return "cancelled";
  if (command?.cause === "device_not_found" || command?.cause === "device_not_booted"
    || command?.cause === "device_offline" || command?.cause === "device_unauthorized") return "device_unavailable";
  if (command?.cause === "foreground_unavailable") return "app_unavailable";
  if (command?.cause === "unsupported_service") return "unsupported_platform";
  if (error instanceof Error && error.name === "AbortError") return "cancelled";
  const category = errorCategory(error);
  if (category === "host_thread_missing") return "session_closed";
  if (category === "cancellation") return "cancelled";
}

export type ErrorCategory = "unknown" | "timeout" | "host_thread_missing" | "cancellation" | "unexpected";

export function setErrorCategory(error: object, category: ErrorCategory) {
  setErrorDiagnostic(error, "category", category);
}

export function errorCategory(error: unknown): ErrorCategory {
  if (error === null || typeof error !== "object") return "unknown";
  const command = getDiscoveryCommandDiagnostic(error);
  if (command?.termination === "deadline" || command?.cause.endsWith("_timeout")) return "timeout";
  const category = errorDiagnostics(error).category;
  if (category !== undefined) return category;
  if ("code" in error && (error.code === -32001 || error.code === "ETIMEDOUT")) return "timeout";
  if ("name" in error && error.name === "TimeoutError") return "timeout";
  if ("message" in error && typeof error.message === "string") {
    if (error.message.includes("thread not found:")) return "host_thread_missing";
    if (error.message === "CancelledError" || error.message.endsWith(": CancelledError")) return "cancellation";
  }
  return "unexpected";
}

const episodeReports = new WeakMap<object, () => boolean>();
const capturedFailures = new WeakSet<object>();

/** Defers the episode decision to the first capture site that would send it, so logging or cancelled callers don't use up the single report. */
export function deferEpisodeReport(error: unknown, shouldReport: () => boolean) {
  if (error !== null && typeof error === "object") episodeReports.set(error, shouldReport);
}

/** Whether a capture site should only count this failure. The first capture of a deferred failure decides its episode. */
export function isRepeatedFailure(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const shouldReport = episodeReports.get(error);
  if (shouldReport === undefined) return false;
  // Callers that joined the same attempt share its error, so only the first capture can report it.
  if (capturedFailures.has(error)) return true;
  capturedFailures.add(error);
  return shouldReport() === false;
}

type Episode = { signature: string; lastSeen: number };

// Keys stay local; one bounded table covers selected-device polling across panels.
export class FailureEpisodes {
  private readonly episodes = new Map<string, Episode>();

  shouldReport(key: string, signature: string, now = Date.now()): boolean {
    const previous = this.episodes.get(key);
    const continued = previous !== undefined && previous.signature === signature && now - previous.lastSeen < 300000;
    this.episodes.delete(key);
    if (this.episodes.size >= 64) {
      const oldest = this.episodes.keys().next().value;
      if (oldest !== undefined) this.episodes.delete(oldest);
    }
    this.episodes.set(key, { signature, lastSeen: now });
    return continued === false;
  }

  recover(key: string) {
    this.episodes.delete(key);
  }

  clear() {
    this.episodes.clear();
  }
}
