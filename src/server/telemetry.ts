import * as Sentry from "@sentry/node";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { MeasurementWindow, TELEMETRY_INTERVAL_MS, TELEMETRY_META_KEY } from "../shared/telemetry.ts";
import { SimulatorUnavailableError } from "./simulator-unavailable.ts";
import { closeNativeTelemetry } from "./native-telemetry.ts";
import { deviceAppsDiagnosticTags } from "../shared/device-apps-diagnostics.ts";
import { androidStartupDiagnosticTags } from "../shared/android-startup-diagnostics.ts";
import type { AndroidStartupSummary, AndroidStartupContext, AndroidStartupFailure, AndroidDeviceState } from "../shared/android-startup-diagnostics.ts";

export function recordAndroidBackendStartup(duration: number, outcome: "ready" | "failed") {
  if (process.env.MOBILE_DEV_TELEMETRY === "off") return;
  const attributes = { component: "server", surface: "simulator", device_platform: "android", outcome };
  Sentry.metrics.count("android.backend.startup.samples", 1, { attributes });
  Sentry.metrics.gauge("android.backend.startup.duration", duration, { unit: "millisecond", attributes });
}

function androidStartupAttributes(context: AndroidStartupContext) {
  return {
    component: "server", surface: "simulator", device_platform: "android",
    device_kind: context.deviceKind, android_transport: context.transport,
    android_device_state_before: context.stateBefore,
  };
}

export function recordAndroidStartupStages(summary: AndroidStartupSummary, context: AndroidStartupContext) {
  if (process.env.MOBILE_DEV_TELEMETRY === "off") return;
  const product = androidStartupAttributes(context);
  for (const stage of summary.stages) {
    if (stage.samples === 0) continue;
    const attributes = { ...product, stage: stage.stage, outcome: summary.outcome };
    const mean = stage.totalMs / stage.samples;
    Sentry.metrics.count("android.backend.startup.stage.samples", stage.samples, { attributes });
    Sentry.metrics.gauge("android.backend.startup.stage.mean", mean, { unit: "millisecond", attributes });
    Sentry.metrics.gauge("android.backend.startup.stage.max", stage.maxMs, { unit: "millisecond", attributes });
    for (const [commandOutcome, samples] of Object.entries(stage.outcomes)) {
      if (samples === undefined || samples === 0) continue;
      const outcomeAttributes = { ...attributes, command_outcome: commandOutcome };
      Sentry.metrics.count("android.backend.startup.stage.outcomes", samples, { attributes: outcomeAttributes });
    }
    if (stage.timedSamples > 0) {
      Sentry.metrics.count("android.backend.startup.execution.spawned", stage.spawnedSamples, { attributes });
      const queueMean = stage.queueMs / stage.timedSamples;
      const executionMean = stage.executionMs / stage.timedSamples;
      Sentry.metrics.gauge("android.backend.startup.queue.mean", queueMean, { unit: "millisecond", attributes });
      Sentry.metrics.gauge("android.backend.startup.execution.mean", executionMean, { unit: "millisecond", attributes });
    }
  }
}

export function recordAndroidStartupContext(context: AndroidStartupContext) {
  if (process.env.MOBILE_DEV_TELEMETRY === "off") return;
  const attributes = androidStartupAttributes(context);
  Sentry.metrics.gauge("android.backend.startup.active_backends", context.activeBackends, { attributes });
  Sentry.metrics.gauge("android.backend.startup.stopping_backends", context.stoppingBackends, { attributes });
  Sentry.metrics.gauge("android.backend.startup.in_flight", context.startingBackends, { attributes });
}

export function recordAndroidStartupDeviceState(state: AndroidDeviceState, duration: number, context: AndroidStartupContext, failure: AndroidStartupFailure) {
  if (process.env.MOBILE_DEV_TELEMETRY === "off") return;
  const product = androidStartupAttributes(context);
  const attributes = { ...product, android_device_state_after: state, stage: failure.stage, command_outcome: failure.outcome };
  Sentry.metrics.count("android.backend.startup.device_state.samples", 1, { attributes });
  Sentry.metrics.gauge("android.backend.startup.device_state.duration", duration, { unit: "millisecond", attributes });
}

export function recordAndroidBackendStop(duration: number, context: AndroidStartupContext) {
  if (process.env.MOBILE_DEV_TELEMETRY === "off") return;
  const attributes = androidStartupAttributes(context);
  Sentry.metrics.gauge("android.backend.process_shutdown.duration", duration, { unit: "millisecond", attributes });
}

export class IOSLogProcessingTelemetry {
  private readonly window = new MeasurementWindow();
  private readonly attributes: { surface: string; device_platform: string; device_kind: string };
  private readonly timer?: NodeJS.Timeout;
  private closed = false;

  constructor(kind: "physical" | "simulator") {
    this.attributes = { surface: "logs", device_platform: "ios", device_kind: kind };
    if (process.env.MOBILE_DEV_TELEMETRY === "off") return;
    this.timer = setInterval(() => this.flush(), TELEMETRY_INTERVAL_MS);
    this.timer.unref();
  }

  record(duration: number) {
    if (this.closed || process.env.MOBILE_DEV_TELEMETRY === "off") return;
    this.window.record(duration);
  }

  private flush() {
    const summary = this.window.take();
    if (summary === undefined || process.env.MOBILE_DEV_TELEMETRY === "off") return;
    const attributes = this.attributes;
    Sentry.metrics.count("logs.ios.parse.samples", summary.count, { attributes });
    Sentry.metrics.gauge("logs.ios.parse.mean", summary.mean, { unit: "millisecond", attributes });
    Sentry.metrics.gauge("logs.ios.parse.p95", summary.p95, { unit: "millisecond", attributes });
    Sentry.metrics.gauge("logs.ios.parse.max", summary.max, { unit: "millisecond", attributes });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    this.flush();
  }
}

export function captureServerError(error: unknown, operation: string) {
  if (error instanceof SimulatorUnavailableError) return;
  if (error instanceof Error && error.name === "AbortError") return;
  const diagnosticTags = deviceAppsDiagnosticTags(error);
  const androidTags = androidStartupDiagnosticTags(error);
  Sentry.captureException(error, { tags: { ...diagnosticTags, ...androidTags, operation } });
}

export function installTracePropagation(transport: Transport) {
  const start = transport.start.bind(transport);
  transport.start = async () => {
    const receive = transport.onmessage;
    transport.onmessage = (message, extra) => {
      if ("method" in message && message.params?._meta) {
        const meta = message.params._meta;
        const sentryTrace = typeof meta["sentry-trace"] === "string" ? meta["sentry-trace"] : undefined;
        const baggage = typeof meta.baggage === "string" ? meta.baggage : undefined;
        Sentry.continueTrace({ sentryTrace, baggage }, () => {
          Sentry.withIsolationScope(scope => {
            const context = meta[TELEMETRY_META_KEY];
            const attributes: Record<string, string> = {};
            if (context !== null && typeof context === "object") {
              const allowed: Record<string, readonly string[]> = {
                surface: ["logs", "performance", "simulator", "recording", "comparison"], view: ["panel", "workspace", "recording", "comparison"], layout: ["ios", "android", "both", "none"],
                device_platform: ["ios", "android", "mixed"], device_kind: ["physical", "simulator", "emulator", "none"],
              };
              for (const [key, value] of Object.entries(context)) {
                if (typeof value === "string" && allowed[key]?.includes(value)) attributes[key] = value;
              }
            }
            scope.setAttributes(attributes);
            scope.setTags(attributes);
            receive?.(message, extra);
          });
        });
        return;
      }
      receive?.(message, extra);
    };
    await start();
  };
}

export async function closeServerTelemetry() {
  await closeNativeTelemetry();
  await Sentry.close(2000);
}
