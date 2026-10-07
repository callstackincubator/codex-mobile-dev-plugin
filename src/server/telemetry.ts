import * as Sentry from "@sentry/node";
import { AsyncLocalStorage } from "node:async_hooks";
import type { McpServer, ResourceTemplate, ResourceMetadata, ReadResourceCallback, ReadResourceTemplateCallback, RegisteredResource, RegisteredResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { MeasurementWindow, TELEMETRY_INTERVAL_MS, TELEMETRY_META_KEY } from "../shared/telemetry.ts";
import { ExpectedOperationError, expectedOutcome } from "../shared/error-reporting.ts";
import { closeNativeTelemetry } from "./native-telemetry.ts";
import { definitionDiagnosticTags } from "../shared/simulator-definition-diagnostics.ts";
import { deviceAppsDiagnosticTags } from "../shared/device-apps-diagnostics.ts";
import { getDiscoveryCommandDiagnostic } from "../shared/device-apps-command-diagnostics.ts";
import { androidStartupDiagnosticTags } from "../shared/android-startup-diagnostics.ts";
import type { AndroidStartupSummary, AndroidStartupContext, AndroidStartupFailure, AndroidDeviceState } from "../shared/android-startup-diagnostics.ts";

export function recordIosMirrorSharing(captures: number, subscribers: number, dropped: number) {
  if (process.env.MOBILE_DEV_TELEMETRY === "off") return;
  const attributes = { component: "ios-mirror-service", surface: "simulator", device_platform: "ios", device_kind: "physical" };
  Sentry.metrics.gauge("ios.mirror.shared.captures", captures, { attributes });
  Sentry.metrics.gauge("ios.mirror.shared.subscribers", subscribers, { attributes });
  if (dropped > 0) Sentry.metrics.count("ios.mirror.shared.queue_dropped", dropped, { attributes });
}

export function recordPluginUpdate(operation: "check" | "install", outcome: "disabled" | "unavailable" | "current" | "available" | "updated" | "failed", duration: number) {
  if (process.env.MOBILE_DEV_TELEMETRY === "off") return;
  const attributes = { component: "server", operation, outcome };
  Sentry.metrics.count("plugin.update.operations", 1, { attributes });
  Sentry.metrics.gauge("plugin.update.duration", duration, { unit: "millisecond", attributes });
}

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

export function captureServerError(error: unknown, operation: string, options?: { report?: boolean; signal?: AbortSignal }) {
  const outcome = options?.signal?.aborted ? "cancelled" : expectedOutcome(error);
  const diagnosticTags = deviceAppsDiagnosticTags(error);
  const definitionTags = definitionDiagnosticTags(error);
  if (process.env.MOBILE_DEV_TELEMETRY === "off") return;
  Sentry.metrics.count("server.error.outcome", 1, { attributes: { operation, outcome: outcome ?? "unexpected", ...diagnosticTags } });
  if (outcome !== undefined) return;
  if (options?.report === false) {
    Sentry.metrics.count("server.error.repeated", 1, { attributes: { operation, ...diagnosticTags } });
    return;
  }
  const androidTags = androidStartupDiagnosticTags(error);
  const command = getDiscoveryCommandDiagnostic(error);
  const contexts = command ? { device_apps_command: { elapsed_ms: command.elapsed_ms, deadline_ms: command.deadline_ms,
    exit_status: command.exit_status } } : undefined;
  Sentry.captureException(error, { tags: { ...diagnosticTags, ...definitionTags, ...androidTags, operation }, contexts });
}

type RequestReporting = { accounted: boolean; sessionResponse?: { release: () => void; close: () => Promise<void> } };
const requestReporting = new AsyncLocalStorage<RequestReporting>();

export function registerRequestSessionResponse(release: () => void, close: () => Promise<void>) {
  const reporting = requestReporting.getStore();
  if (reporting) reporting.sessionResponse = { release, close };
}

function recordResourceFailure(error: unknown, signal: AbortSignal): Error {
  let normalized: Error;
  if (signal.aborted) normalized = new ExpectedOperationError("cancelled", "Resource read cancelled.");
  else if (error instanceof Error) normalized = error;
  else {
    const message = String(error);
    normalized = new Error(message);
  }
  const reporting = requestReporting.getStore();
  if (reporting) reporting.accounted = true;
  if (process.env.MOBILE_DEV_TELEMETRY !== "off") {
    const outcome = expectedOutcome(normalized) ?? "unexpected";
    Sentry.metrics.count("server.error.outcome", 1, { attributes: { operation: "resources.read", outcome } });
  }
  return normalized;
}

export function instrumentMcpServer(server: McpServer) {
  const register = server.server.setRequestHandler.bind(server.server);
  server.server.setRequestHandler = (schema, handler) => {
    register(schema, async (request, extra) => {
      const reporting = requestReporting.getStore();
      try {
        return await handler(request, extra);
      } catch (error) {
        const accounted = reporting?.accounted === true;
        if (reporting) {
          reporting.accounted = true;
        }
        if (accounted === false && extra.signal.aborted === false) captureServerError(error, "mcp.request");
        throw error;
      }
    });
  };
  Sentry.wrapMcpServerWithSentry(server, { recordInputs: false, recordOutputs: false });
  const registerResource = server.registerResource.bind(server);
  function resource(name: string, uri: string, metadata: ResourceMetadata, handler: ReadResourceCallback): RegisteredResource;
  function resource(name: string, uri: ResourceTemplate, metadata: ResourceMetadata, handler: ReadResourceTemplateCallback): RegisteredResourceTemplate;
  function resource(name: string, uri: string | ResourceTemplate, metadata: ResourceMetadata, handler: ReadResourceCallback | ReadResourceTemplateCallback) {
    // Each overload pairs its URI kind with the corresponding callback signature.
    if (typeof uri === "string") {
      const read = handler as ReadResourceCallback;
      const wrapped: ReadResourceCallback = async (url, extra) => {
        try { return await read(url, extra); }
        catch (error) { throw recordResourceFailure(error, extra.signal); }
      };
      return registerResource(name, uri, metadata, wrapped);
    }
    const read = handler as ReadResourceTemplateCallback;
    const wrapped: ReadResourceTemplateCallback = async (url, variables, extra) => {
      try { return await read(url, variables, extra); }
      catch (error) { throw recordResourceFailure(error, extra.signal); }
    };
    return registerResource(name, uri, metadata, wrapped);
  }
  server.registerResource = resource;
}

const resourceKinds: Record<string, string> = {
  "logs:": "logs", "cpu:": "cpu", "display-fps:": "display_fps", "mobile-frame:": "simulator_video",
  "android-stream:": "android_video", "ios-video:": "ios_video", "ui:": "ui",
};
const allowedContext: Record<string, readonly string[]> = {
  surface: ["logs", "performance", "simulator", "recording", "comparison"], view: ["panel", "workspace", "recording", "comparison"], layout: ["ios", "android", "both", "none"],
  device_platform: ["ios", "android", "mixed"], device_kind: ["physical", "simulator", "emulator", "none"],
};

export function installTracePropagation(transport: Transport) {
  const send = transport.send.bind(transport);
  transport.send = async (message, options) => {
    const reporting = requestReporting.getStore();
    const session = reporting?.sessionResponse;
    const response = "result" in message || "error" in message;
    if (response && session) {
      reporting.sessionResponse = undefined;
      session.release();
      try { await send(message, options); }
      catch (error) { await session.close(); throw error; }
      return;
    }
    await send(message, options);
  };
  const start = transport.start.bind(transport);
  transport.start = async () => {
    const receive = transport.onmessage;
    transport.onmessage = (message, extra) => {
      if ("method" in message) {
        const meta = message.params?._meta ?? {};
        const sentryTrace = typeof meta["sentry-trace"] === "string" ? meta["sentry-trace"] : undefined;
        const baggage = typeof meta.baggage === "string" ? meta.baggage : undefined;
        Sentry.continueTrace({ sentryTrace, baggage }, () => {
          Sentry.withIsolationScope(scope => {
            const reporting: RequestReporting = { accounted: false };
            scope.addEventProcessor(event => {
              const mechanisms = event.exception?.values ?? [];
              const automatic = mechanisms.find(value => value.mechanism?.type === "auto.ai.mcp_server");
              const errorType = automatic?.mechanism?.data?.error_type;
              if (errorType === "protocol" && reporting.accounted) return null;
              return event;
            });
            const context = meta[TELEMETRY_META_KEY];
            const attributes: Record<string, string> = {};
            if (context !== null && typeof context === "object") {
              for (const [key, value] of Object.entries(context)) {
                if (typeof value === "string" && allowedContext[key]?.includes(value)) attributes[key] = value;
              }
            }
            scope.setAttributes(attributes);
            scope.setTags(attributes);
            if (message.method === "resources/read") {
              scope.setTag("operation", "resources.read");
              const uri = message.params?.uri;
              if (typeof uri === "string") {
                const prefix = uri.split(":", 1)[0];
                const kind = resourceKinds[`${prefix}:`] ?? "unknown";
                scope.setTag("resource_kind", kind);
              }
            }
            requestReporting.run(reporting, () => receive?.(message, extra));
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
