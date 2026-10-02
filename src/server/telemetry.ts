import * as Sentry from "@sentry/node";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { MeasurementWindow, TELEMETRY_INTERVAL_MS, TELEMETRY_META_KEY } from "../shared/telemetry.ts";
import { SimulatorUnavailableError } from "./simulator-unavailable.ts";
import { closeNativeTelemetry } from "./native-telemetry.ts";

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
  Sentry.captureException(error, { tags: { operation } });
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
