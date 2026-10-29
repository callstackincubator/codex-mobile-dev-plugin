import { z } from "zod";
import { setErrorDiagnostic } from "./error-diagnostics.ts";
// Copied from the serve-emu runtime so shared code stays free of vendored runtimes;
// a test keeps the two lists equal.
export const startupStages = [
  "locate-server", "hash-server", "cache-probe", "push-server", "publish-cache",
  "copy-server", "forward-socket", "launch-server", "socket-ready", "socket-poll", "connect-video",
  "connect-control", "video-preamble", "cleanup", "cleanup-forward", "cleanup-jars",
] as const;
export const startupOutcomes = ["ok", "nonzero", "timeout", "aborted", "offline", "unauthorized", "missing", "closed", "spawn-error", "error"] as const;

const stageSchema = z.enum(startupStages);
const outcomeSchema = z.enum(startupOutcomes);
const measurement = z.number().finite().min(0).max(60_000_000);
const count = z.number().int().min(0).max(10_000);
const stageSummary = z.object({
  stage: stageSchema, samples: count, totalMs: measurement, maxMs: measurement,
  timedSamples: count, spawnedSamples: count, queueMs: measurement, executionMs: measurement,
  outcomes: z.partialRecord(outcomeSchema, count),
}).strict().refine(value => {
  const outcomes = Object.values(value.outcomes);
  let samples = 0;
  for (const count of outcomes) samples += count ?? 0;
  return samples === value.samples && value.timedSamples <= value.samples && value.spawnedSamples <= value.timedSamples && value.maxMs <= value.totalMs;
});
export const androidStartupMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("mobile-dev/android-startup"), stage: stageSchema }).strict(),
  z.object({ type: z.literal("mobile-dev/android-startup-failure"), stage: stageSchema, outcome: outcomeSchema }).strict(),
  z.object({
    type: z.literal("mobile-dev/android-startup-complete"), outcome: z.enum(["ready", "failed"]),
    failedStage: stageSchema.optional(), failure: outcomeSchema.optional(),
    stages: z.array(stageSummary).max(startupStages.length).refine(values => {
      const names = values.map(value => value.stage);
      const stages = new Set(names);
      return stages.size === values.length;
    }),
  }).strict(),
]);
export type AndroidStartupSummary = Extract<z.infer<typeof androidStartupMessageSchema>, { type: "mobile-dev/android-startup-complete" }>;
export type AndroidDeviceState = "online" | "offline" | "unauthorized" | "missing" | "unknown";
export type AndroidStartupContext = {
  deviceKind: "emulator" | "physical"; transport: "emulator" | "wired" | "localNetwork" | "unknown";
  stateBefore: AndroidDeviceState; activeBackends: number; stoppingBackends: number;
  startingBackends: number;
};
export type AndroidStartupFailure = { stage: typeof startupStages[number] | "process-launch" | "health-readiness" | "unknown"; outcome: typeof startupOutcomes[number] | "unknown" };

export function setAndroidStartupDiagnostic(error: unknown, startup: AndroidStartupFailure, context: AndroidStartupContext) {
  if (error instanceof Error) setErrorDiagnostic(error, "androidStartup", { startup, context });
}

export function androidDeviceState(output: string, serial: string): AndroidDeviceState {
  const lines = output.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    const columns = trimmed.split(/\s+/);
    if (columns[0] !== serial) continue;
    if (columns[1] === "device") return "online";
    if (columns[1] === "offline" || columns[1] === "unauthorized") return columns[1];
    return "unknown";
  }
  return "missing";
}
