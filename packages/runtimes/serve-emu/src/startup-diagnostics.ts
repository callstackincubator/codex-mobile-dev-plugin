export const startupStages = [
  "locate-server", "hash-server", "cache-probe", "push-server", "publish-cache",
  "copy-server", "forward-socket", "launch-server", "socket-ready", "socket-poll", "connect-video",
  "connect-control", "video-preamble", "cleanup", "cleanup-forward", "cleanup-jars",
] as const;
export type StartupStage = typeof startupStages[number];
export const startupOutcomes = ["ok", "nonzero", "timeout", "aborted", "offline", "unauthorized", "missing", "closed", "spawn-error", "error"] as const;
export type StartupOutcome = typeof startupOutcomes[number];
export type StartupTiming = { queueMs: number; executionMs: number; spawned: boolean };
export type StartupStageSummary = {
  stage: StartupStage; samples: number; totalMs: number; maxMs: number;
  timedSamples: number; spawnedSamples: number; queueMs: number; executionMs: number;
  outcomes: Partial<Record<StartupOutcome, number>>;
};
export type StartupMessage = {
  type: "mobile-dev/android-startup"; stage: StartupStage;
} | {
  type: "mobile-dev/android-startup-failure"; stage: StartupStage; outcome: StartupOutcome;
} | {
  type: "mobile-dev/android-startup-complete"; outcome: "ready" | "failed";
  failedStage?: StartupStage; failure?: StartupOutcome; stages: StartupStageSummary[];
};
export type StartupReporter = (message: StartupMessage) => void;

export class StartupTimeoutError extends Error {}

export function startupErrorOutcome(error: unknown): StartupOutcome {
  if (error instanceof StartupTimeoutError) return "timeout";
  if (error instanceof Error && error.name === "AbortError") return "aborted";
  if (error instanceof Error && "code" in error) {
    if (error.code === "ENOENT" || error.code === "EACCES") return "spawn-error";
    if (error.code === "aborted") return "aborted";
  }
  return "error";
}

export function adbStartupOutcome(result: { status: number | null; stdout: string; stderr: string; timedOut?: boolean; error?: Error | null }): StartupOutcome {
  if (result.timedOut) return "timeout";
  if (result.status === 0 && result.error == null) return "ok";
  const detail = `${result.stderr} ${result.stdout}`;
  if (/\bunauthorized\b/i.test(detail)) return "unauthorized";
  if (/\bdevice offline\b/i.test(detail)) return "offline";
  if (/\b(?:device .* not found|no devices?)\b/i.test(detail)) return "missing";
  if (/\bclosed\b/i.test(detail)) return "closed";
  if (result.error && "code" in result.error) {
    if (result.error.code === "aborted") return "aborted";
    if (result.error.code === "ENOENT" || result.error.code === "EACCES") return "spawn-error";
  }
  if (result.error) return "error";
  return result.status === 0 ? "ok" : "nonzero";
}

export class StartupDiagnostics {
  private readonly report: StartupReporter;
  private readonly stages = new Map<StartupStage, StartupStageSummary>();
  private completed = false;
  private failure?: { stage: StartupStage; outcome: StartupOutcome };
  private activeStage: StartupStage = "locate-server";
  cleaning = false;

  constructor(report: StartupReporter) { this.report = report; }

  private begin(stage: StartupStage) {
    this.activeStage = stage;
    let summary = this.stages.get(stage);
    if (summary === undefined) {
      summary = { stage, samples: 0, totalMs: 0, maxMs: 0, timedSamples: 0, spawnedSamples: 0, queueMs: 0, executionMs: 0, outcomes: {} };
      this.stages.set(stage, summary);
      this.report({ type: "mobile-dev/android-startup", stage });
    }
    return summary;
  }

  fail(stage: StartupStage, outcome: StartupOutcome) {
    if (this.failure || this.completed) return;
    this.failure = { stage, outcome };
    this.report({ type: "mobile-dev/android-startup-failure", stage, outcome });
  }

  enter(stage: StartupStage) { if (this.completed === false) this.begin(stage); }
  abort() { this.fail(this.activeStage, "aborted"); }
  failCurrent(error: unknown) {
    const outcome = startupErrorOutcome(error);
    this.fail(this.activeStage, outcome);
  }

  private addTiming(summary: StartupStageSummary, timing: StartupTiming | undefined) {
    if (timing === undefined) return;
    summary.timedSamples++;
    if (timing.spawned) summary.spawnedSamples++;
    summary.queueMs += timing.queueMs;
    summary.executionMs += timing.executionMs;
  }

  async measure<T>(stage: StartupStage, operation: () => Promise<T>, classify?: (result: T) => { outcome: StartupOutcome; timing?: StartupTiming }, failureTiming?: () => StartupTiming | undefined): Promise<T> {
    if (this.completed) return operation();
    const summary = this.begin(stage);
    const started = performance.now();
    let outcome: StartupOutcome = "ok";
    try {
      const result = await operation();
      if (classify) {
        const classification = classify(result);
        outcome = classification.outcome;
        this.addTiming(summary, classification.timing);
      }
      return result;
    } catch (error) {
      outcome = startupErrorOutcome(error);
      const timing = failureTiming?.();
      this.addTiming(summary, timing);
      this.fail(stage, outcome);
      throw error;
    } finally {
      const duration = performance.now() - started;
      summary.samples++;
      summary.totalMs += duration;
      summary.maxMs = Math.max(summary.maxMs, duration);
      summary.outcomes[outcome] = (summary.outcomes[outcome] ?? 0) + 1;
    }
  }

  finish(outcome: "ready" | "failed") {
    if (this.completed) return;
    if (outcome === "failed" && this.failure === undefined) this.fail(this.activeStage, "error");
    this.completed = true;
    const stages = Array.from(this.stages.values());
    this.report({ type: "mobile-dev/android-startup-complete", outcome, failedStage: this.failure?.stage, failure: this.failure?.outcome, stages });
  }
}
