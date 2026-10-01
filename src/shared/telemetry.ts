import type { init } from "@sentry/react";
import { PLUGIN_VERSION } from "./version.ts";

export const SENTRY_UI_DSN = "https://09bfb50068dbab86252bbb5489ce38ce@o4512180958068736.ingest.de.sentry.io/4512181027471440";
export const SENTRY_SERVER_DSN = "https://2ee03a9449e1f1b48e3e7c7606b6f562@o4512180958068736.ingest.de.sentry.io/4512181033173072";
export const SENTRY_NATIVE_DSN = "https://1deeefda39022a67df902c638dcf3c8f@o4512180958068736.ingest.de.sentry.io/4512181036318800";
export const SENTRY_ORIGIN = "https://o4512180958068736.ingest.de.sentry.io";
export const SENTRY_RELEASE = `mobile-dev@${PLUGIN_VERSION}`;
export const TELEMETRY_META_KEY = "mobile-dev/telemetry";
export const TELEMETRY_INTERVAL_MS = 30_000;
export type TelemetryEnvironment = "development" | "release";
export type Surface = "logs" | "performance" | "simulator";
export type TelemetryAttributes = Record<string, string | number | boolean>;
type Options = NonNullable<Parameters<typeof init>[0]>;
type ErrorEvent = Parameters<NonNullable<Options["beforeSend"]>>[0];
type StreamedSpanJSON = Parameters<NonNullable<Options["beforeSendSpan"]>>[0];
type Metric = Parameters<NonNullable<Options["beforeSendMetric"]>>[0];

const frequentTools = new Set([
  "mobile_stream_input", "mobile_android_stream_input", "mobile_android_send_input", "mobile_ios_mirror_input", "mobile_read_logs", "mobile_read_cpu",
  "mobile_read_display_fps", "mobile_logs_keep_alive", "mobile_log_sources", "mobile_performance_sources",
  "mobile_list_simulators", "mobile_list_ios_devices", "mobile_list_android_devices",
]);

export function isFrequentTool(name: string): boolean {
  return frequentTools.has(name);
}

export function sampleTrace(name: string, inheritOrSampleWith: (rate: number) => number): number {
  if (name.startsWith("resources/") || name.startsWith("notifications/")) return 0;
  const toolName = name.replace(/^tools\/call /, "");
  if (isFrequentTool(toolName)) return 0;
  return inheritOrSampleWith(0.1);
}

export function scrubText(text: string): string {
  if (text.startsWith("Command failed:")) return "Child process command failed";
  let scrubbed = text.replace(/(?:Bearer\s+|sntrys_)[A-Za-z0-9._-]+/gi, "[token]");
  scrubbed = scrubbed.replace(/\b[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12}\b/g, "[identifier]");
  scrubbed = scrubbed.replace(/\b[A-Fa-f0-9]{24,}\b/g, "[identifier]");
  scrubbed = scrubbed.replace(/\b[^\s@]+@[^\s@]+\.[^\s@]+\b/g, "[email]");
  scrubbed = scrubbed.replace(/(?:\/Users\/|\/home\/)[^\s"')]+/g, "[local path]");
  scrubbed = scrubbed.replace(/https?:\/\/[^\s"')]+/g, "[url]");
  return scrubbed.slice(0, 512);
}

export function scrubErrorEvent(event: ErrorEvent): ErrorEvent {
  delete event.request;
  delete event.user;
  delete event.extra;
  delete event.server_name;
  if (event.message) event.message = scrubText(event.message);
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = scrubText(exception.value);
    if (exception.mechanism) delete exception.mechanism.data;
    for (const frame of exception.stacktrace?.frames ?? []) {
      delete frame.vars;
      delete frame.pre_context;
      delete frame.post_context;
      delete frame.context_line;
    }
  }
  if (event.contexts) {
    delete event.contexts.device;
    delete event.contexts.app;
    delete event.contexts.culture;
    if (event.contexts.trace) delete event.contexts.trace.data;
  }
  return event;
}

export function scrubSpan(span: StreamedSpanJSON): StreamedSpanJSON {
  for (const key of Object.keys(span.attributes)) {
    if (key.includes("argument") || key.includes("content") || key.includes("uri") || key.includes("url") || key.includes("address") || key.includes("session.id") || key.includes("command")) {
      delete span.attributes[key];
    }
  }
  if (span.name.startsWith("resources/read ")) span.name = "resources/read";
  span.name = scrubText(span.name);
  delete span.attributes["error.message"];
  return span;
}

export function scrubMetric(metric: Metric): Metric {
  if (metric.attributes === undefined) return metric;
  delete metric.attributes["server.address"];
  delete metric.attributes["user.id"];
  delete metric.attributes["user.name"];
  delete metric.attributes["user.email"];
  return metric;
}

export type MeasurementSummary = { count: number; mean: number; p95: number; max: number };

export class MeasurementWindow {
  private count = 0;
  private total = 0;
  private max = 0;
  private readonly values: number[] = [];

  record(value: number) {
    if (Number.isFinite(value) === false || value < 0) return;
    this.count++;
    this.total += value;
    this.max = Math.max(this.max, value);
    if (this.values.length < 256) this.values.push(value);
    else {
      const random = Math.random();
      const index = Math.floor(random * this.count);
      if (index < 256) this.values[index] = value;
    }
  }

  take(): MeasurementSummary | undefined {
    if (this.count === 0) return;
    this.values.sort((left, right) => left - right);
    const percentileIndex = Math.ceil(this.values.length * 0.95) - 1;
    const result = { count: this.count, mean: this.total / this.count, p95: this.values[percentileIndex], max: this.max };
    this.count = 0;
    this.total = 0;
    this.max = 0;
    this.values.length = 0;
    return result;
  }
}
