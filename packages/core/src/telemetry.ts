import * as Sentry from "@sentry/node";
import { AsyncLocalStorage } from "node:async_hooks";
import type { McpServer, ResourceTemplate, ResourceMetadata, ReadResourceCallback, ReadResourceTemplateCallback, RegisteredResource, RegisteredResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { MeasurementWindow, TELEMETRY_HOSTS, TELEMETRY_INTERVAL_MS, TELEMETRY_META_KEY, telemetryHost } from "@mobile-dev/shared/telemetry.ts";
import { ExpectedOperationError, expectedOutcome, isRepeatedFailure } from "@mobile-dev/shared/error-reporting.ts";
import { closeNativeTelemetry } from "./native-telemetry.ts";
import { closeHttpRuntime } from "./http-runtime.ts";
import { definitionDiagnosticTags } from "@mobile-dev/shared/simulator-definition-diagnostics.ts";
import { deviceAppsDiagnosticTags } from "@mobile-dev/shared/device-apps-diagnostics.ts";
import { getDiscoveryCommandDiagnostic } from "@mobile-dev/shared/device-apps-command-diagnostics.ts";
import { androidStartupDiagnosticTags } from "@mobile-dev/shared/android-startup-diagnostics.ts";
import { installIntegrityTags } from "./install-integrity.ts";
import type { AndroidStartupSummary, AndroidStartupContext, AndroidStartupFailure, AndroidDeviceState } from "@mobile-dev/shared/android-startup-diagnostics.ts";

export function recordBrowserPanelSessions(active: number) {
  if (process.env.MOBILE_DEV_TELEMETRY === "off") return;
  Sentry.metrics.gauge("browser_panel.sessions", active, { attributes: { component: "server" } });
}

/** Counts browser panel context updates by outcome; sizes only for stored updates, never their content. */
export function recordBrowserPanelContext(outcome: "stored" | "invalid" | "too_large", bytes?: number) {
  if (process.env.MOBILE_DEV_TELEMETRY === "off") return;
  const attributes = { component: "server", outcome };
  Sentry.metrics.count("browser_panel.context_update", 1, { attributes });
  if (bytes !== undefined) Sentry.metrics.distribution("browser_panel.context_bytes", bytes, { attributes: { component: "server" }, unit: "byte" });
}

/**
 * How long the panel's downloaded runtime took to be ready, by outcome: found complete,
 * downloaded and extracted, or failed with a bounded reason. Sizes only for downloads.
 */
export function recordPanelRuntime(outcome: "cached" | "downloaded" | "failed", duration: number, bytes?: number, reason?: string) {
  if (process.env.MOBILE_DEV_TELEMETRY === "off") return;
  const attributes = { component: "server", outcome, ...reason ? { reason } : {} };
  Sentry.metrics.distribution("panel_runtime.ready", duration, { attributes, unit: "millisecond" });
  if (bytes !== undefined) Sentry.metrics.distribution("panel_runtime.download_bytes", bytes, { attributes: { component: "server" }, unit: "byte" });
}

export function recordIosMirrorSharing(captures: number, subscribers: number, dropped: number) {
  if (process.env.MOBILE_DEV_TELEMETRY === "off") return;
  const attributes = { component: "ios-mirror-service", surface: "simulator", device_platform: "ios", device_kind: "physical" };
  Sentry.metrics.gauge("ios.mirror.shared.captures", captures, { attributes });
  Sentry.metrics.gauge("ios.mirror.shared.subscribers", subscribers, { attributes });
  if (dropped > 0) Sentry.metrics.count("ios.mirror.shared.queue_dropped", dropped, { attributes });
}

export type AppStorageOperation = "read" | "clear" | "reset" | "table" | "file";
export function recordAppStorageOperation(operation: AppStorageOperation, platform: "ios" | "android", outcome: "success" | "failed", duration: number) {
  if (process.env.MOBILE_DEV_TELEMETRY === "off") return;
  const attributes = { component: "server", surface: "storage", operation, device_platform: platform, outcome };
  Sentry.metrics.count("app_storage.operation.samples", 1, { attributes });
  Sentry.metrics.gauge("app_storage.operation.duration", duration, { unit: "millisecond", attributes });
}

export function recordTraceSiftOperation(operation: "ready" | "analyze" | "remember" | "restore" | "handoff" | "task" | "payload" | "pick" | "project", outcome: "success" | "failed", duration: number) {
  if (process.env.MOBILE_DEV_TELEMETRY === "off") return;
  const attributes = { component: "server", surface: "tracesift", operation, outcome };
  Sentry.metrics.count("tracesift.operation.samples", 1, { attributes });
  Sentry.metrics.gauge("tracesift.operation.duration", duration, { unit: "millisecond", attributes });
}

/**
 * How much Explore data a payload delivery carried. A tree that grows past what
 * the bridge handles shows up here long before a reader reports it.
 */
export function recordTraceSiftPayload(kind: "task" | "react", bytes: number) {
  if (process.env.MOBILE_DEV_TELEMETRY === "off") return;
  const attributes = { component: "server", surface: "tracesift", kind };
  Sentry.metrics.gauge("tracesift.explore.payload_bytes", bytes, { unit: "byte", attributes });
}

export function recordAccessibilityBridgeRestart(outcome: "recovered" | "unavailable" | "failed") {
  if (process.env.MOBILE_DEV_TELEMETRY === "off") return;
  const attributes = { component: "server", device_platform: "ios", device_kind: "simulator", outcome };
  Sentry.metrics.count("ios.accessibility_bridge.restarts", 1, { attributes });
}

export function recordAndroidEmulatorReconnect(trigger: "boot" | "selection") {
  if (process.env.MOBILE_DEV_TELEMETRY === "off") return;
  const attributes = { component: "server", surface: "simulator", device_platform: "android", device_kind: "emulator", trigger };
  Sentry.metrics.count("android.emulator.adb_reconnects", 1, { attributes });
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

/**
 * Counts a handled failure and reports it when it is unexpected. `reportAs` stands in for an error whose message
 * can carry app IDs, URLs, serials or paths; create it where the failure is caught so Sentry keeps that location.
 * The outcome and diagnostic tags still come from the original error.
 */
export function captureServerError(error: unknown, operation: string, options?: { report?: boolean; signal?: AbortSignal; reportAs?: Error; tags?: Record<string, string> }) {
  const outcome = options?.signal?.aborted ? "cancelled" : expectedOutcome(error);
  const diagnosticTags = { ...deviceAppsDiagnosticTags(error), ...options?.tags };
  const definitionTags = definitionDiagnosticTags(error);
  if (process.env.MOBILE_DEV_TELEMETRY === "off") return;
  Sentry.metrics.count("server.error.outcome", 1, { attributes: { operation, outcome: outcome ?? "unexpected", ...diagnosticTags } });
  if (outcome !== undefined) return;
  if (options?.report === false || isRepeatedFailure(error)) {
    Sentry.metrics.count("server.error.repeated", 1, { attributes: { operation, ...diagnosticTags } });
    return;
  }
  const androidTags = androidStartupDiagnosticTags(error);
  const installTags = installIntegrityTags(error);
  const command = getDiscoveryCommandDiagnostic(error);
  const contexts = command ? { device_apps_command: { elapsed_ms: command.elapsed_ms, deadline_ms: command.deadline_ms,
    exit_status: command.exit_status } } : undefined;
  Sentry.captureException(options?.reportAs ?? error, { tags: { ...diagnosticTags, ...definitionTags, ...androidTags, ...installTags, operation }, contexts });
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
  surface: ["logs", "performance", "storage", "simulator", "recording", "comparison", "tracesift"], view: ["panel", "workspace", "recording", "comparison", "tracesift"], layout: ["ios", "android", "both", "none"],
  device_platform: ["ios", "android", "mixed"], device_kind: ["physical", "simulator", "emulator", "none"], host: TELEMETRY_HOSTS,
};

/** Attributes server telemetry to the host that launched it: the Mac app sets `MOBILE_DEV_HOST`, other hosts are named by their MCP client. */
export function setServerTelemetryHost(clientName: string | undefined) {
  const host = process.env.MOBILE_DEV_HOST === "mac" ? "mac" : telemetryHost(clientName);
  Sentry.setTag("host", host);
  Sentry.setAttribute("host", host);
}

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
  try {
    await closeNativeTelemetry();
    await Sentry.close(2000);
  } finally {
    await closeHttpRuntime();
  }
}
