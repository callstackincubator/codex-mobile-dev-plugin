import type { SessionStatus } from "./shared/api-contracts.ts";

export type { SessionStatus } from "./shared/api-contracts.ts";

// Terminal status precedence. The first transition out of "streaming" normally
// wins, but a later abnormal scrcpy exit ("error") may escalate a clean-eof
// "stopped" — because the video socket can end cleanly at a frame boundary a
// moment before the process reports its crash. Nothing downgrades an "error".
export function terminalTransitionAllowed(
  current: SessionStatus,
  next: Exclude<SessionStatus, "streaming">,
): boolean {
  if (current === "error") return false;
  if (current !== "streaming" && next !== "error") return false;
  return true;
}

// scrcpy died unexpectedly when it exits with a non-zero code or is killed by a
// signal. A clean code-0 exit is a normal shutdown, not a crash.
export function isAbnormalExit(
  code: number | null,
  signal: NodeJS.Signals | null,
): boolean {
  return signal !== null || (code ?? 0) !== 0;
}

// Human-readable reason plus the structured code/meta surfaced on /health when
// scrcpy exits abnormally.
export function procExitDetail(
  code: number | null,
  signal: NodeJS.Signals | null,
): { reason: string; code: string; meta: Record<string, string | number> } {
  return {
    reason: `scrcpy exited with code ${code ?? "null"} signal ${signal ?? "null"}`,
    code: "process-exit",
    meta: {
      ...(code !== null ? { exitCode: code } : {}),
      ...(signal !== null ? { signal } : {}),
    },
  };
}
