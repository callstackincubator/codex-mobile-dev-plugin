import * as Sentry from "@sentry/node";
import { AsyncLocalStorage } from "node:async_hooks";
import type { McpServer, ResourceTemplate, ResourceMetadata, ReadResourceCallback, ReadResourceTemplateCallback, RegisteredResource, RegisteredResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { MeasurementWindow, TELEMETRY_HOSTS, TELEMETRY_INTERVAL_MS, TELEMETRY_META_KEY, telemetryHost } from "@mobile-dev/shared/telemetry.ts";
import type { TelemetryHost } from "@mobile-dev/shared/telemetry.ts";
import { ExpectedOperationError, expectedOutcome, isRepeatedFailure } from "@mobile-dev/shared/error-reporting.ts";
import { closeNativeTelemetry } from "./native-telemetry.ts";
import { closeHttpRuntime } from "./http-runtime.ts";
import { diagnosticContexts, diagnosticReportTags, diagnosticTags } from "@mobile-dev/shared/error-diagnostics.ts";
import type { AndroidStartupSummary, AndroidStartupContext, AndroidStartupFailure, AndroidDeviceState } from "@mobile-dev/shared/android-startup-diagnostics.ts";

/** Whether the user allows telemetry; read on each call, since tests switch it. */
export const telemetryEnabled = () => process.env.MOBILE_DEV_TELEMETRY !== "off";

type Attributes = Record<string, string | number | boolean>;
/** Adds `value` to the count `name`, unless telemetry is off. */
export function count(name: string, value: number, attributes: Attributes) {
  if (telemetryEnabled()) Sentry.metrics.count(name, value, { attributes });
}
/** Records the gauge `name`, unless telemetry is off. */
export function gauge(name: string, value: number, attributes: Attributes, unit?: "millisecond" | "byte") {
  if (telemetryEnabled()) Sentry.metrics.gauge(name, value, unit === undefined ? { attributes } : { unit, attributes });
}

export function recordIosMirrorSharing(captures: number, subscribers: number, dropped: number) {
  const attributes = { component: "ios-mirror-service", surface: "simulator", device_platform: "ios", device_kind: "physical" };
  gauge("ios.mirror.shared.captures", captures, attributes);
  gauge("ios.mirror.shared.subscribers", subscribers, attributes);
  if (dropped > 0) count("ios.mirror.shared.queue_dropped", dropped, attributes);
}

export type AppStorageOperation = "read" | "clear" | "reset" | "table" | "file";
export function recordAppStorageOperation(operation: AppStorageOperation, platform: "ios" | "android", outcome: "success" | "failed", duration: number) {
  const attributes = { component: "server", surface: "storage", operation, device_platform: platform, outcome };
  count("app_storage.operation.samples", 1, attributes);
  gauge("app_storage.operation.duration", duration, attributes, "millisecond");
}

export function recordTraceSiftOperation(operation: "ready" | "analyze" | "remember" | "restore" | "handoff" | "task" | "payload" | "pick" | "project", outcome: "success" | "failed", duration: number) {
  const attributes = { component: "server", surface: "tracesift", operation, outcome };
  count("tracesift.operation.samples", 1, attributes);
  gauge("tracesift.operation.duration", duration, attributes, "millisecond");
}

/**
 * How much Explore data a payload delivery carried. A tree that grows past what
 * the bridge handles shows up here long before a reader reports it.
 */
export function recordTraceSiftPayload(kind: "task" | "react", bytes: number) {
  gauge("tracesift.explore.payload_bytes", bytes, { component: "server", surface: "tracesift", kind }, "byte");
}

export type CollectorReadiness = { collector: "cpu" | "fps"; platform: "ios" | "android"; kind: "simulator" | "physical" | "emulator" };
export function recordCollectorReady({ collector, platform, kind }: CollectorReadiness, outcome: "ready" | "failed" | "cancelled", duration: number) {
  const attributes = { component: "server", surface: "performance", collector, device_platform: platform, device_kind: kind, outcome };
  count("collector.ready.samples", 1, attributes);
  gauge("collector.ready.duration", duration, attributes, "millisecond");
}

export function recordAccessibilityBridgeRestart(outcome: "recovered" | "unavailable" | "failed") {
  count("ios.accessibility_bridge.restarts", 1, { component: "server", device_platform: "ios", device_kind: "simulator", outcome });
}

export function recordAndroidEmulatorReconnect(trigger: "boot" | "selection") {
  count("android.emulator.adb_reconnects", 1, { component: "server", surface: "simulator", device_platform: "android", device_kind: "emulator", trigger });
}

export function recordAndroidBackendStartup(duration: number, outcome: "ready" | "failed") {
  const attributes = { component: "server", surface: "simulator", device_platform: "android", outcome };
  count("android.backend.startup.samples", 1, attributes);
  gauge("android.backend.startup.duration", duration, attributes, "millisecond");
}

function androidStartupAttributes(context: AndroidStartupContext) {
  return {
    component: "server", surface: "simulator", device_platform: "android",
    device_kind: context.deviceKind, android_transport: context.transport,
    android_device_state_before: context.stateBefore,
  };
}

export function recordAndroidStartupStages(summary: AndroidStartupSummary, context: AndroidStartupContext) {
  const product = androidStartupAttributes(context);
  for (const stage of summary.stages) {
    if (stage.samples === 0) continue;
    const attributes = { ...product, stage: stage.stage, outcome: summary.outcome };
    const mean = stage.totalMs / stage.samples;
    count("android.backend.startup.stage.samples", stage.samples, attributes);
    gauge("android.backend.startup.stage.mean", mean, attributes, "millisecond");
    gauge("android.backend.startup.stage.max", stage.maxMs, attributes, "millisecond");
    for (const [commandOutcome, samples] of Object.entries(stage.outcomes)) {
      if (samples === undefined || samples === 0) continue;
      count("android.backend.startup.stage.outcomes", samples, { ...attributes, command_outcome: commandOutcome });
    }
    if (stage.timedSamples > 0) {
      count("android.backend.startup.execution.spawned", stage.spawnedSamples, attributes);
      const queueMean = stage.queueMs / stage.timedSamples;
      const executionMean = stage.executionMs / stage.timedSamples;
      gauge("android.backend.startup.queue.mean", queueMean, attributes, "millisecond");
      gauge("android.backend.startup.execution.mean", executionMean, attributes, "millisecond");
    }
  }
}

export function recordAndroidStartupContext(context: AndroidStartupContext) {
  const attributes = androidStartupAttributes(context);
  gauge("android.backend.startup.active_backends", context.activeBackends, attributes);
  gauge("android.backend.startup.stopping_backends", context.stoppingBackends, attributes);
  gauge("android.backend.startup.in_flight", context.startingBackends, attributes);
}

export function recordAndroidStartupDeviceState(state: AndroidDeviceState, duration: number, context: AndroidStartupContext, failure: AndroidStartupFailure) {
  const product = androidStartupAttributes(context);
  const attributes = { ...product, android_device_state_after: state, stage: failure.stage, command_outcome: failure.outcome };
  count("android.backend.startup.device_state.samples", 1, attributes);
  gauge("android.backend.startup.device_state.duration", duration, attributes, "millisecond");
}

export function recordAndroidBackendStop(duration: number, context: AndroidStartupContext) {
  gauge("android.backend.process_shutdown.duration", duration, androidStartupAttributes(context), "millisecond");
}

export class IOSLogProcessingTelemetry {
  private readonly window = new MeasurementWindow();
  private readonly attributes: { surface: string; device_platform: string; device_kind: string };
  private readonly timer?: NodeJS.Timeout;
  private closed = false;

  constructor(kind: "physical" | "simulator") {
    this.attributes = { surface: "logs", device_platform: "ios", device_kind: kind };
    if (!telemetryEnabled()) return;
    this.timer = setInterval(() => this.flush(), TELEMETRY_INTERVAL_MS);
    this.timer.unref();
  }

  record(duration: number) {
    if (this.closed || !telemetryEnabled()) return;
    this.window.record(duration);
  }

  private flush() {
    const summary = this.window.take();
    if (summary === undefined) return;
    const attributes = this.attributes;
    count("logs.ios.parse.samples", summary.count, attributes);
    gauge("logs.ios.parse.mean", summary.mean, attributes, "millisecond");
    gauge("logs.ios.parse.p95", summary.p95, attributes, "millisecond");
    gauge("logs.ios.parse.max", summary.max, attributes, "millisecond");
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
  const tags = { ...diagnosticTags(error), ...options?.tags };
  if (!telemetryEnabled()) return;
  count("server.error.outcome", 1, { operation, outcome: outcome ?? "unexpected", ...tags });
  if (outcome !== undefined) return;
  if (options?.report === false || isRepeatedFailure(error)) {
    count("server.error.repeated", 1, { operation, ...tags });
    return;
  }
  Sentry.captureException(options?.reportAs ?? error, { tags: { ...tags, ...diagnosticReportTags(error), operation }, contexts: diagnosticContexts(error) });
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
  count("server.error.outcome", 1, { operation: "resources.read", outcome: expectedOutcome(normalized) ?? "unexpected" });
  return normalized;
}

type SetRequestHandler = McpServer["server"]["setRequestHandler"];
type RequestHandler = Parameters<SetRequestHandler>[1];
/** Adapts a request handler before the server registers it, such as toolIcons. */
export type RequestHandlerWrapper = (schema: Parameters<SetRequestHandler>[0], handler: RequestHandler) => RequestHandler;

/**
 * Accounts and reports MCP request failures, traces tools and resources, and applies
 * `wrappers` to every request handler, first outermost, inside that accounting. This is
 * the one patch of setRequestHandler, so call it before registering any tool: the SDK
 * sets the tools/list handler on the first registration.
 */
export function instrumentMcpServer(server: McpServer, ...wrappers: RequestHandlerWrapper[]) {
  const register = server.server.setRequestHandler.bind(server.server);
  server.server.setRequestHandler = (schema, handler) => {
    const adapted = wrappers.reduceRight((inner, wrap) => wrap(schema, inner), handler as RequestHandler);
    register(schema, async (request, extra) => {
      const reporting = requestReporting.getStore();
      try {
        return await adapted(request, extra);
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

let launchingHost: TelemetryHost | undefined;

function tagServerHost(host: TelemetryHost) {
  Sentry.setTag("host", host);
  Sentry.setAttribute("host", host);
}

/** Attributes server telemetry to the host whose own server entry launched it, whatever its MCP client reports. */
export function setLaunchingTelemetryHost(host: TelemetryHost) {
  launchingHost = host;
  tagServerHost(host);
}

/** Attributes server telemetry to the host its MCP client names, unless the launching host named itself. */
export function setServerTelemetryHost(clientName: string | undefined) {
  tagServerHost(launchingHost ?? telemetryHost(clientName));
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
