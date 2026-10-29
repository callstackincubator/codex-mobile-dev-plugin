import { execFile } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { androidDeviceState, androidStartupMessageSchema, setAndroidStartupDiagnostic } from "@mobile-dev/shared/android-startup-diagnostics.ts";
import type { AndroidStartupContext, AndroidStartupFailure, AndroidStartupSummary } from "@mobile-dev/shared/android-startup-diagnostics.ts";
import { BackendStartError } from "./backend-process.ts";
import { recordAndroidBackendStartup, recordAndroidStartupContext, recordAndroidStartupDeviceState, recordAndroidStartupStages } from "./telemetry.ts";

const execute = promisify(execFile);
const parentOutcomes = { exit: "error", deadline: "timeout", cancelled: "aborted" } as const;

/**
 * One serve-emu start's telemetry. The child reports its startup stages over IPC; a failed start is
 * attributed to the stage the child failed in or last reached, and to how the child or the parent saw it end.
 */
export class AndroidStartupTracker {
  readonly context: AndroidStartupContext;
  private readonly startedAt = performance.now();
  private stage: AndroidStartupFailure["stage"] = "process-launch";
  private summary?: AndroidStartupSummary;
  private observedFailure?: AndroidStartupFailure;

  constructor(context: AndroidStartupContext) {
    this.context = context;
    recordAndroidStartupContext(context);
  }

  observe(child: ChildProcess) {
    const onDiagnostic = (message: unknown) => {
      if (process.env.MOBILE_DEV_TELEMETRY === "off" || this.summary) return;
      const parsed = androidStartupMessageSchema.safeParse(message);
      if (parsed.success === false) return;
      if (parsed.data.type === "mobile-dev/android-startup") this.stage = parsed.data.stage;
      else if (parsed.data.type === "mobile-dev/android-startup-failure") this.observedFailure = { stage: parsed.data.stage, outcome: parsed.data.outcome };
      else {
        this.summary = parsed.data;
        if (this.summary.outcome === "ready") this.stage = "health-readiness";
        recordAndroidStartupStages(this.summary, this.context);
        child.off("message", onDiagnostic);
      }
    };
    child.on("message", onDiagnostic);
    child.once("close", () => child.off("message", onDiagnostic));
  }

  ready() {
    const duration = performance.now() - this.startedAt;
    recordAndroidBackendStartup(duration, "ready");
  }

  /** Records a failed start on its error and returns the failure. */
  failure(error: unknown): AndroidStartupFailure {
    const duration = performance.now() - this.startedAt;
    recordAndroidBackendStartup(duration, "failed");
    // A process that could not spawn fails without a BackendStartError.
    const parentOutcome = error instanceof BackendStartError ? parentOutcomes[error.failure] : "spawn-error";
    const failure: AndroidStartupFailure = {
      stage: this.summary?.failedStage ?? this.observedFailure?.stage ?? this.stage,
      outcome: this.summary?.failure ?? this.observedFailure?.outcome ?? parentOutcome,
    };
    setAndroidStartupDiagnostic(error, failure, this.context);
    return failure;
  }

  /** Records, in the background, whether adb still lists the device after a failed start. */
  checkDeviceAfter(adb: string, serial: string, failure: AndroidStartupFailure, signal: AbortSignal) {
    if (process.env.MOBILE_DEV_TELEMETRY === "off") return;
    const checkedAt = performance.now();
    void execute(adb, ["devices"], { timeout: 2000, maxBuffer: 1024 * 1024, signal }).then(response => {
      const state = androidDeviceState(response.stdout, serial);
      const elapsed = performance.now() - checkedAt;
      recordAndroidStartupDeviceState(state, elapsed, this.context, failure);
    }, () => {
      const elapsed = performance.now() - checkedAt;
      recordAndroidStartupDeviceState("unknown", elapsed, this.context, failure);
    });
  }
}
