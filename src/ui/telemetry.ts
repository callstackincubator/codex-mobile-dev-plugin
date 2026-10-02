import * as Sentry from "@sentry/react";
import type { App } from "@modelcontextprotocol/ext-apps";
import {
  MeasurementWindow, SENTRY_RELEASE, SENTRY_UI_DSN, TELEMETRY_INTERVAL_MS, TELEMETRY_META_KEY,
  isFrequentTool, sampleTrace, scrubErrorEvent, scrubMetric, scrubSpan, validateTelemetryEnvironment,
} from "../shared/telemetry.ts";
import type { Surface, TelemetryAttributes } from "../shared/telemetry.ts";
import { validateTelemetryIdentity } from "../shared/telemetry-identity.ts";

export { ErrorBoundary } from "@sentry/react";

let running = false;
let surface: Surface = "simulator";
let attributes: TelemetryAttributes = { component: "ui", surface, view: "panel", layout: "ios" };
let visibleSince = 0;
let previousFrame: number | undefined;
let frameId: number | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let observer: PerformanceObserver | undefined;
const measurements = new Map<string, MeasurementWindow>();
const gauges = new Map<string, number>();
const counts = new Map<string, number>();
const readinessFrames = new Set<number>();

function cancelReadinessFrames() {
  for (const id of readinessFrames) cancelAnimationFrame(id);
  readinessFrames.clear();
}

export function recordUiTiming(name: string, duration: number) {
  if (running === false || document.visibilityState === "hidden") return;
  let window = measurements.get(name);
  if (window === undefined) {
    window = new MeasurementWindow();
    measurements.set(name, window);
  }
  window.record(duration);
}

export function setUiGauge(name: string, value: number) {
  if (running && Number.isFinite(value)) gauges.set(name, value);
}

export function countUiEvent(name: string, value = 1) {
  if (running === false) return;
  const previous = counts.get(name) ?? 0;
  counts.set(name, previous + value);
}

function recordVisibleTime(now: number) {
  if (visibleSince === 0) return;
  const seconds = (now - visibleSince) / 1000;
  Sentry.metrics.count("ui.surface.visible_seconds", seconds, { attributes });
  visibleSince = now;
}

export function flushUiMeasurements() {
  if (running === false) return;
  const now = performance.now();
  recordVisibleTime(now);
  for (const [name, window] of measurements) {
    const summary = window.take();
    if (summary === undefined) continue;
    Sentry.metrics.count(`${name}.samples`, summary.count, { attributes });
    Sentry.metrics.gauge(`${name}.mean`, summary.mean, { unit: "millisecond", attributes });
    Sentry.metrics.gauge(`${name}.p95`, summary.p95, { unit: "millisecond", attributes });
    Sentry.metrics.gauge(`${name}.max`, summary.max, { unit: "millisecond", attributes });
  }
  for (const [name, value] of gauges) Sentry.metrics.gauge(name, value, { attributes });
  for (const [name, value] of counts) Sentry.metrics.count(name, value, { attributes });
  counts.clear();
}

function recordEntries(entries: PerformanceEntry[]) {
  for (const entry of entries) {
    if (entry.entryType === "event") recordUiTiming("ui.interaction", entry.duration);
    else if (entry.entryType === "longtask") recordUiTiming("ui.long_task", entry.duration);
    else if (entry.entryType === "long-animation-frame") recordUiTiming("ui.long_animation_frame", entry.duration);
  }
}

export function setUiSurface(next: Surface) {
  if (surface === next) return;
  if (observer) {
    const entries = observer.takeRecords();
    recordEntries(entries);
  }
  flushUiMeasurements();
  cancelReadinessFrames();
  surface = next;
  attributes = { ...attributes, surface };
  measurements.clear();
  gauges.clear();
  previousFrame = undefined;
  if (running) {
    Sentry.setTags({ surface });
    Sentry.setAttributes(attributes);
    Sentry.metrics.count("ui.surface.views", 1, { attributes });
    Sentry.addBreadcrumb({ category: "mobile-dev", message: "Surface selected", data: { surface } });
  }
}

export function setUiTelemetryContext(next: TelemetryAttributes) {
  const changed = Object.entries(next).some(([key, value]) => attributes[key] !== value);
  if (changed === false) return;
  flushUiMeasurements();
  attributes = { ...attributes, ...next };
  if (running) Sentry.setAttributes(attributes);
}

export function getUiTelemetryAttributes(): TelemetryAttributes {
  return attributes;
}

export function captureUiError(error: unknown, operation: string) {
  if (running === false) return;
  if (error instanceof Error && error.name === "AbortError") return;
  Sentry.captureException(error, { tags: { operation, surface } });
}

export function markUiSurfaceReady(startedAt: number) {
  if (running === false) return;
  const selectedSurface = surface;
  const firstFrame = requestAnimationFrame(() => {
    readinessFrames.delete(firstFrame);
    if (running === false || surface !== selectedSurface) return;
    const secondFrame = requestAnimationFrame(() => {
      readinessFrames.delete(secondFrame);
      if (running === false || surface !== selectedSurface) return;
      const elapsed = performance.now() - startedAt;
      recordUiTiming("ui.surface.ready", elapsed);
    });
    readinessFrames.add(secondFrame);
  });
  readinessFrames.add(firstFrame);
}

function observeFrames(now: number) {
  if (running === false) return;
  if (document.visibilityState === "hidden") previousFrame = undefined;
  else {
    if (previousFrame !== undefined) {
      const interval = now - previousFrame;
      recordUiTiming("ui.frame_interval", interval);
      countUiEvent("ui.frames");
      if (interval > 50) countUiEvent("ui.frames.over_50ms");
    }
    previousFrame = now;
  }
  frameId = requestAnimationFrame(observeFrames);
}

function visibilityChanged() {
  flushUiMeasurements();
  visibleSince = document.visibilityState === "hidden" ? 0 : performance.now();
  previousFrame = undefined;
}

export function startUiTelemetry(app: App) {
  const environmentMeta = document.querySelector<HTMLMetaElement>('meta[name="mobile-dev-environment"]');
  const environment = validateTelemetryEnvironment(environmentMeta?.content);
  const telemetryMeta = document.querySelector<HTMLMetaElement>('meta[name="mobile-dev-telemetry"]');
  const enabled = telemetryMeta?.content !== "off";
  const userMeta = document.querySelector<HTMLMetaElement>('meta[name="mobile-dev-user-id"]');
  const sessionMeta = document.querySelector<HTMLMetaElement>('meta[name="mobile-dev-session-id"]');
  const identity = enabled ? validateTelemetryIdentity(userMeta?.content, sessionMeta?.content) : undefined;
  const browserTracing = Sentry.browserTracingIntegration({ instrumentNavigation: false });
  Sentry.init({
    dsn: SENTRY_UI_DSN,
    release: SENTRY_RELEASE,
    environment,
    enabled,
    initialScope: identity ? { user: { id: identity.userId }, tags: { telemetry_session: identity.sessionId } } : undefined,
    dataCollection: { userInfo: false, genAI: { inputs: false, outputs: false } },
    integrations: [browserTracing],
    tracePropagationTargets: [],
    tracesSampler: context => sampleTrace(context.name, context.inheritOrSampleWith),
    beforeSend: scrubErrorEvent,
    beforeSendSpan: scrubSpan,
    beforeSendMetric: scrubMetric,
    beforeBreadcrumb: breadcrumb => breadcrumb.category === "mobile-dev" ? breadcrumb : null,
  });
  running = enabled;
  if (running === false) return;
  const requestedView = document.documentElement.dataset.view;
  const view = requestedView === "recording" || requestedView === "workspace" || requestedView === "comparison" ? requestedView : "panel";
  attributes = { ...attributes, view };
  Sentry.setTags({ component: "ui", surface, view });
  Sentry.setAttributes(attributes);
  Sentry.metrics.count("ui.panel.opened", 1, { attributes });
  if (document.visibilityState !== "hidden") visibleSince = performance.now();
  document.addEventListener("visibilitychange", visibilityChanged);
  frameId = requestAnimationFrame(observeFrames);
  timer = setInterval(flushUiMeasurements, TELEMETRY_INTERVAL_MS);
  if (typeof PerformanceObserver !== "undefined") {
    const supported = PerformanceObserver.supportedEntryTypes;
    observer = new PerformanceObserver(list => {
      const entries = list.getEntries();
      recordEntries(entries);
    });
    for (const type of ["event", "longtask", "long-animation-frame"]) {
      const options: PerformanceObserverInit & { durationThreshold: number } = { type, buffered: false, durationThreshold: 16 };
      if (supported.includes(type)) observer.observe(options);
    }
    const interactionSupported = supported.includes("event");
    const supportValue = Number(interactionSupported);
    setUiGauge("ui.interaction.supported", supportValue);
  }

  const call = app.callServerTool.bind(app);
  app.callServerTool = (params, options) => {
    if (isFrequentTool(params.name)) return call(params, options);
    const operationAttributes = attributes;
    return Sentry.startSpan({ name: `tools/call ${params.name}`, op: "mcp.client", attributes: operationAttributes }, async () => {
      const trace = Sentry.getTraceData();
      const request = { ...params, _meta: { ...params._meta, ...trace, [TELEMETRY_META_KEY]: operationAttributes } };
      Sentry.metrics.count("ui.action", 1, { attributes: { ...operationAttributes, action: params.name } });
      try {
        const result = await call(request, options);
        const outcome = result.isError ? "error" : "success";
        Sentry.metrics.count("ui.action.result", 1, { attributes: { ...operationAttributes, action: params.name, outcome } });
        return result;
      } catch (error) {
        if (options?.signal?.aborted === false || options?.signal === undefined) captureUiError(error, params.name);
        throw error;
      }
    });
  };
}

export async function stopUiTelemetry() {
  flushUiMeasurements();
  running = false;
  cancelReadinessFrames();
  visibleSince = 0;
  if (frameId !== undefined) cancelAnimationFrame(frameId);
  clearInterval(timer);
  observer?.disconnect();
  document.removeEventListener("visibilitychange", visibilityChanged);
  await Sentry.close(2000);
}
