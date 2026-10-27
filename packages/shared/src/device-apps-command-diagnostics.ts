export type DiscoveryCommand = "ios_simulator_apps" | "ios_physical_apps" | "ios_physical_processes"
  | "ios_simulator_foreground" | "ios_physical_foreground" | "ios_simulator_runtime"
  | "android_packages" | "android_processes" | "android_foreground_activity" | "android_foreground_pid";
export const foregroundCauses = ["device_not_found", "bridge_unavailable", "foreground_unavailable",
  "unsupported_response", "connection_failed", "connection_timeout", "unsupported_service",
  "service_open_failed", "service_open_timeout", "query_failed", "query_timeout", "cleanup_failed",
  "cleanup_timeout", "invalid_response", "cancelled"] as const;
export type ForegroundCause = typeof foregroundCauses[number];
export type DiscoveryCause = ForegroundCause | "device_not_booted" | "device_offline" | "device_unauthorized"
  | "missing_executable" | "deadline_exceeded" | "output_limit" | "process_signalled" | "command_failed" | "unknown";
export type CommandTermination = "exit" | "signal" | "deadline" | "cancelled" | "spawn_error" | "output_limit" | "unknown";
export type DiscoveryCommandDiagnostic = {
  command: DiscoveryCommand;
  cause: DiscoveryCause;
  termination: CommandTermination;
  elapsed_ms: number;
  deadline_ms: number;
  exit_status?: number;
  signal?: "SIGABRT" | "SIGBUS" | "SIGFPE" | "SIGILL" | "SIGKILL" | "SIGPIPE" | "SIGSEGV" | "SIGTERM" | "SIGTRAP" | "other";
};

const diagnostics = new WeakMap<object, DiscoveryCommandDiagnostic>();

export function setDiscoveryCommandDiagnostic(error: object, diagnostic: DiscoveryCommandDiagnostic) {
  diagnostics.set(error, diagnostic);
}

export function getDiscoveryCommandDiagnostic(error: unknown): DiscoveryCommandDiagnostic | undefined {
  if (error === null || typeof error !== "object") return;
  return diagnostics.get(error);
}

export function discoveryCommandTags(error: unknown): Record<string, string> {
  const diagnostic = getDiscoveryCommandDiagnostic(error);
  if (diagnostic === undefined) return {};
  const tags: Record<string, string> = { discovery_command: diagnostic.command, discovery_cause: diagnostic.cause,
    discovery_termination: diagnostic.termination };
  if (diagnostic.signal !== undefined) tags.discovery_signal = diagnostic.signal;
  return tags;
}
