import { getDiscoveryCommandDiagnostic } from "./device-apps-command-diagnostics.ts";

export type ExpectedOutcome = "session_expired" | "session_closed" | "cancelled" | "device_unavailable" | "app_unavailable" | "resource_limit" | "unsupported_platform" | "invalid_input";

export class ExpectedOperationError extends Error {
  readonly outcome: ExpectedOutcome;

  constructor(outcome: ExpectedOutcome, message: string) {
    super(message);
    this.outcome = outcome;
  }
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
const categories = new WeakMap<object, ErrorCategory>();

export function setErrorCategory(error: object, category: ErrorCategory) {
  categories.set(error, category);
}

export function errorCategory(error: unknown): ErrorCategory {
  if (error === null || typeof error !== "object") return "unknown";
  const command = getDiscoveryCommandDiagnostic(error);
  if (command?.termination === "deadline" || command?.cause.endsWith("_timeout")) return "timeout";
  const category = categories.get(error);
  if (category !== undefined) return category;
  if ("code" in error && (error.code === -32001 || error.code === "ETIMEDOUT")) return "timeout";
  if ("name" in error && error.name === "TimeoutError") return "timeout";
  if ("message" in error && typeof error.message === "string") {
    if (error.message.includes("thread not found:")) return "host_thread_missing";
    if (error.message === "CancelledError" || error.message.endsWith(": CancelledError")) return "cancellation";
  }
  return "unexpected";
}

const repeatedFailures = new WeakSet<object>();

/** Marks a failure whose episode its owner has already reported, so capture sites only count it. */
export function markRepeatedFailure(error: unknown) {
  if (error !== null && typeof error === "object") repeatedFailures.add(error);
}

export function isRepeatedFailure(error: unknown): boolean {
  return error !== null && typeof error === "object" && repeatedFailures.has(error);
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
