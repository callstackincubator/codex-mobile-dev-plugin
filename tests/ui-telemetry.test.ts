import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { recordingFixture } from "./recording-fixtures.ts";

const userId = "anon_0123456789abcdef0123456789abcdef";
const sessionId = "run_1234567890abcdef1234567890abcdef";
const identityMeta = `<meta name="mobile-dev-user-id" content="${userId}"><meta name="mobile-dev-session-id" content="${sessionId}">`;

function contains(text: string, fragment: string, expected = true) {
  const included = text.includes(fragment);
  assert.equal(included, expected, `Telemetry fragment: ${fragment}`);
}

test("browser errors use the served environment regardless of live-reload markers", async t => {
  const root = process.cwd();
  const built = await build({
    stdin: { contents: 'export * from "./src/ui/telemetry.ts";', resolveDir: root, loader: "ts" },
    bundle: true, write: false, format: "iife", globalName: "Telemetry", platform: "browser", target: "chrome120",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  for (const environment of ["development", "release"]) {
    const html = `<html><head><meta name="mobile-dev-environment" content="${environment}"><meta name="mobile-dev-live-revision" content="test">${identityMeta}</head></html>`;
    const dom = new JSDOM(html, { pretendToBeVisual: true, runScripts: "outside-only", url: "https://mobile-dev.test/" });
    t.after(() => dom.window.close());
    Object.defineProperty(dom.window.performance, "getEntriesByType", { value: () => [] });
    Object.defineProperty(dom.window.performance, "getEntries", { value: () => [] });
    const bodies: string[] = [];
    dom.window.fetch = async (_url, options) => {
      const body = String(options?.body ?? "");
      bodies.push(body);
      return new Response("", { status: 200 });
    };
    dom.window.eval(built.outputFiles[0].text);
    const api = dom.window.Telemetry;
    api.startUiTelemetry({ async callServerTool() { return { content: [] }; } });
    const error = new dom.window.Error("Environment validation");
    api.captureUiError(error, "test");
    await api.stopUiTelemetry();
    const captured = bodies.join("\n");
    contains(captured, `"environment":"${environment}"`);
    contains(captured, `"user":{"id":"${userId}"}`);
    contains(captured, `"telemetry_session":"${sessionId}"`);
    const other = environment === "development" ? "release" : "development";
    contains(captured, `"environment":"${other}"`, false);
  }
  const invalid = new JSDOM("<html><head></head></html>", { runScripts: "outside-only" });
  t.after(() => invalid.window.close());
  invalid.window.eval(built.outputFiles[0].text);
  assert.throws(() => invalid.window.Telemetry.startUiTelemetry({}), /Sentry environment must be/);
  const missingIdentity = new JSDOM('<head><meta name="mobile-dev-environment" content="development"></head>', { runScripts: "outside-only" });
  t.after(() => missingIdentity.window.close());
  missingIdentity.window.eval(built.outputFiles[0].text);
  assert.throws(() => missingIdentity.window.Telemetry.startUiTelemetry({}), /generated anonymous/);
  const disabled = new JSDOM('<head><meta name="mobile-dev-environment" content="development"><meta name="mobile-dev-telemetry" content="off"></head>', { runScripts: "outside-only" });
  t.after(() => disabled.window.close());
  let disabledRequests = 0;
  disabled.window.fetch = async () => { disabledRequests++; return new Response("", { status: 200 }); };
  disabled.window.eval(built.outputFiles[0].text);
  disabled.window.Telemetry.startUiTelemetry({});
  const disabledError = new disabled.window.Error("Disabled telemetry");
  disabled.window.Telemetry.captureUiError(disabledError, "test");
  await disabled.window.Telemetry.stopUiTelemetry();
  assert.equal(disabledRequests, 0);
});

test("browser telemetry labels surface measurements, propagates traces, and flushes on teardown", async t => {
  const root = process.cwd();
  const built = await build({
    stdin: { contents: 'export * from "./src/ui/telemetry.ts"; export { RecordingController } from "./src/ui/recording-controller.ts"; export * as Sentry from "@sentry/react"; export { ScreenAnnotationsStore } from "./src/ui/screen-annotations.ts"; export { PanelContext } from "./src/ui/model-context.ts"; export { LogList } from "./src/ui/log-list.ts"; export { LogsPanel } from "./src/ui/logs-panel.ts"; export { DeviceAppsStore } from "./src/ui/device-apps.ts";', resolveDir: root, loader: "ts" },
    bundle: true, write: false, format: "iife", globalName: "Telemetry", platform: "browser", target: "chrome120",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const html = `<html data-view="workspace"><head><meta name="mobile-dev-environment" content="development">${identityMeta}</head><body></body></html>`;
  const dom = new JSDOM(html, {
    pretendToBeVisual: true, runScripts: "outside-only", url: "https://mobile-dev.test/",
  });
  t.after(() => { dom.window.close(); });
  const window = dom.window;
  const requests: { url: string; body: string }[] = [];
  window.fetch = async (url, options) => {
    const address = String(url);
    const body = String(options?.body ?? "");
    requests.push({ url: address, body });
    return new Response("", { status: 200 });
  };
  let now = 100;
  Object.defineProperty(window.performance, "now", { value: () => now });
  Object.defineProperty(window.performance, "getEntriesByType", { value: () => [] });
  Object.defineProperty(window.performance, "getEntries", { value: () => [] });
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 1;
  window.requestAnimationFrame = callback => { const id = nextFrame++; frames.set(id, callback); return id; };
  window.cancelAnimationFrame = id => { frames.delete(id); };
  function frame(timestamp: number) {
    now = timestamp;
    const callbacks = [...frames.values()];
    frames.clear();
    for (const callback of callbacks) callback(timestamp);
  }
  window.eval(built.outputFiles[0].text);
  const api = window.Telemetry;
  const calls: Record<string, unknown>[] = [];
  const callRestriction = "A phone or VoIP call is currently in progress on the device.";
  const app = { async callServerTool(params: Record<string, unknown>) {
    calls.push(params);
    if (params.name === "mobile_ios_mirror_session") return { isError: true, content: [{ type: "text", text: callRestriction }] };
    return { content: [{ type: "text", text: "PRIVATE_TOOL_RESULT" }] };
  } };
  api.startUiTelemetry(app);
  api.setUiSurface("logs");
  api.setUiTelemetryContext({ layout: "both", device_platform: "ios", device_kind: "physical" });
  api.recordUiTiming("ui.logs.publish", 7);
  api.setUiSurface("simulator");
  api.recordUiTiming("ui.annotations.tree_processing", 3);
  api.recordUiTiming("ui.annotations.inspection", 12);
  let sendFailure = "";
  const context = new api.PanelContext({ getHostCapabilities: () => ({ message: { text: {} } }), async sendMessage() {
    if (sendFailure === "timeout") throw Object.assign(new Error("Request timed out"), { code: -32001 });
    if (sendFailure === "composer") throw new Error("MCP app messages require an available composer");
    if (sendFailure) throw new Error("PRIVATE_SEND_ERROR");
    return {};
  } }, {
    modelContext: { getCurrent: () => undefined, async update() { return { updateId: "PRIVATE_UPDATE" }; } },
  });
  const store = new api.ScreenAnnotationsStore();
  store.connect(context);
  store.configure({ udid: "PRIVATE_DEVICE", name: "PRIVATE_DEVICE_NAME", runtime: "iOS 26", state: "Booted" }, false);
  store.capture = () => ({ screenshot: { id: "PRIVATE_CAPTURE", data: "PRIVATE_IMAGE", capturedAt: "2026-10-01T10:00:00Z" }, screen: { width: 402, height: 874, units: "points" } });
  store.readTree = async () => [{ source: "react-native", role: "RCTText", label: "PRIVATE_LABEL", bounds: { x: 10, y: 20, width: 100, height: 40 }, react: {
    component: "PRIVATE_COMPONENT", owners: ["PRIVATE_OWNER"], key: "PRIVATE_REACT_KEY", source: { file: "/Users/alice/private.tsx", line: 49, column: 11 },
  } }];
  await store.toggle(); store.select({ x: 50, y: 40 }); store.setText("PRIVATE_NOTE"); await store.save(); await store.send();
  store.select({ x: 50, y: 40 }); store.setText("PRIVATE_NOTE_AGAIN"); await store.save();
  for (const failure of ["timeout", "composer", "unexpected", ""]) { sendFailure = failure; await store.send(); }
  store.dispose();
  api.countUiEvent("ui.annotations.runtime_available");
  api.countUiEvent("ui.annotations.inspection_fallback");
  api.setUiSurface("logs");
  const expiredClient = {
    async callServerTool() { return { content: [], _meta: { sessionId: "PRIVATE_SESSION", logsUri: "logs://mobile-dev/PRIVATE_SESSION/batch?after=0" } }; },
    async readServerResource() { throw new window.Error("MCP error -32603: This log session expired or closed. Reopen the log panel."); },
  };
  const expiredApps = new api.DeviceAppsStore(expiredClient, window.document);
  const expiredLogs = new api.LogsPanel(expiredClient, { canAttach: true }, expiredApps);
  expiredLogs.configure({ followApp: false });
  t.after(() => { expiredApps.dispose(); return expiredLogs.dispose(); });
  expiredApps.selectDevice({ udid: "PRIVATE_DEVICE", name: "PRIVATE_NAME", state: "Booted", runtime: "iOS" });
  expiredLogs.setAvailable(true);
  expiredLogs.show();
  await new Promise(resolve => window.setTimeout(resolve, 0));
  assert.equal(expiredLogs.getSnapshot().status, "Reconnecting...");
  assert.equal(expiredLogs.getSnapshot().error, "");
  await expiredLogs.dispose();
  const logList = new api.LogList(context);
  logList.append([{ sequence: 1, timestamp: "2026-10-02T10:00:00Z", level: "error", source: "js", origin: "metro", message: "PRIVATE_LOG_MESSAGE", stack: "PRIVATE_LOG_STACK" }], 0);
  logList.search('level:error message:"PRIVATE_LOG_MESSAGE"');
  logList.search('message~:"[PRIVATE_INVALID_PATTERN"');
  assert.ok(logList.getSnapshot().queryError);
  logList.search("age:5m");
  logList.refreshAge();
  let foreground = { bundleId: "PRIVATE_FOREGROUND_APP", pid: 123 };
  const logsClient = {
    async callServerTool(input: { name: string }) {
      if (input.name === "mobile_performance_sources") return { content: [], structuredContent: { apps: [], foregroundApp: foreground } };
      if (input.name === "mobile_logs_session") return { content: [], _meta: { sessionId: "PRIVATE_LOG_SESSION", logsUri: "logs://mobile-dev/PRIVATE_LOG_SESSION/batch?after=0" } };
      return { content: [] };
    },
    readServerResource(_input: unknown, options: { signal: AbortSignal }) {
      return new Promise((_, reject) => {
        options.signal.addEventListener("abort", () => reject(new Error("Read cancelled")), { once: true });
      });
    },
  };
  const logApps = new api.DeviceAppsStore(logsClient, window.document);
  const logPanel = new api.LogsPanel(logsClient, context, logApps);
  logApps.selectDevice({ udid: "PRIVATE_DEVICE", name: "PRIVATE_DEVICE_NAME", state: "Booted", platform: "ios" });
  logPanel.setAvailable(true);
  logPanel.show();
  logApps.setAvailable(true);
  await logApps.refresh();
  foreground = { bundleId: "PRIVATE_NEXT_APP", pid: 456 };
  await logApps.refresh();
  const foregroundBeforeHide = logPanel.list.getSnapshot();
  logPanel.hide();
  foreground = { bundleId: "PRIVATE_HIDDEN_APP", pid: 789 };
  await logApps.refresh();
  assert.equal(logPanel.list.getSnapshot(), foregroundBeforeHide);
  await logPanel.dispose();
  logApps.dispose();
  await context.sendLogToChat({
    timestamp: "2026-10-02T10:00:00Z", lastTimestamp: "2026-10-02T10:00:00Z", count: 1, sequence: 1,
    origin: "metro", source: "js", level: "error", deviceId: "PRIVATE_DEVICE",
    message: "PRIVATE_LOG_MESSAGE", stack: "PRIVATE_LOG_STACK",
  });
  const logs = new api.LogList(context);
  logs.append(Array.from({ length: 2100 }, (_, sequence) => ({
    timestamp: "2026-10-02T10:00:00Z", sequence, source: "native", origin: "ios", level: "info",
    message: "PRIVATE_LOG_MESSAGE", stack: "PRIVATE_LOG_STACK", deviceId: "PRIVATE_DEVICE",
  })), 0);
  frame(116);
  frame(132);
  api.flushUiMeasurements();
  const traceId = "1234567890abcdef1234567890abcdef";
  await api.Sentry.continueTrace({ sentryTrace: `${traceId}-1234567890abcdef-1` }, async () => {
    await app.callServerTool({ name: "mobile_cpu_session", arguments: { token: "PRIVATE_TOOL_ARGUMENT" }, _meta: { existing: "PRIVATE_METADATA" } });
  });
  const propagated = calls[0]._meta;
  assert.equal(propagated.existing, "PRIVATE_METADATA");
  const tracePattern = new RegExp(`^${traceId}-`);
  assert.match(propagated["sentry-trace"], tracePattern);
  assert.equal(propagated["mobile-dev/telemetry"].surface, "logs");
  const input = { name: "mobile_android_stream_input", arguments: { text: "PRIVATE_INPUT" } };
  await app.callServerTool(input);
  assert.equal(calls[1], input, "High frequency input stays on the original MCP path.");
  api.setUiSurface("simulator");
  api.recordUiTiming("ui.screenshot.capture", 12);
  api.countUiEvent("ui.annotations.inspection_truncated");
  await app.callServerTool({ name: "mobile_ios_mirror_capture_screenshot", arguments: { sessionId: "PRIVATE_DEVICE_SESSION", image: "PRIVATE_SCREENSHOT" } });
  const screenshotContext = calls[2]._meta["mobile-dev/telemetry"];
  assert.equal(screenshotContext.surface, "simulator");
  assert.equal(screenshotContext.device_platform, "ios");
  assert.equal(screenshotContext.device_kind, "physical");
  api.setUiSurface("performance");
  api.recordUiTiming("ui.performance.batch", 9);
  const controller = new api.RecordingController(app);
  const recording = recordingFixture();
  recording.title = "PRIVATE_RECORDING_TITLE";
  recording.deviceName = "PRIVATE_RECORDING_DEVICE";
  recording.fps.samples[0].frameTimeline = {
    clock: "boottime", intervalEndNs: "9007200254740993", frames: [
      { token: "9007199254740995", startTimeNs: "9007199744741116", endTimeNs: "9007199754741116", presentType: 2, jankType: 48 },
    ],
  };
  controller.accept({ content: [], structuredContent: { recording } });
  assert.equal(api.getUiTelemetryAttributes().surface, "recording");
  assert.equal(api.getUiTelemetryAttributes().device_platform, "android");
  api.setUiTelemetryContext({ view: "recording" });
  api.recordUiTiming("ui.recording.derive", 3);
  await app.callServerTool({ name: "mobile_read_performance_recording", arguments: { recordingId: "PRIVATE_RECORDING_ID" } });
  assert.equal(calls[3]._meta, undefined, "Recording polling does not create a trace per refresh.");
  api.setUiSurface("simulator");
  api.setUiTelemetryContext({ device_platform: "ios", device_kind: "physical" });
  const restricted = await app.callServerTool({ name: "mobile_ios_mirror_session", arguments: { udid: "PRIVATE_PHONE" } });
  assert.equal(restricted.isError, true);
  const mirrorContext = calls[4]._meta["mobile-dev/telemetry"];
  assert.equal(mirrorContext.surface, "simulator");
  assert.equal(mirrorContext.device_platform, "ios");
  assert.equal(mirrorContext.device_kind, "physical");
  api.setUiSurface("app-flow");
  api.recordUiTiming("ui.app_flow.layout", 4);
  api.recordUiTiming("ui.app_flow.zoom", 16);
  api.recordUiTiming("ui.app_flow.update", 8);
  Object.defineProperty(window.document, "visibilityState", { configurable: true, value: "hidden" });
  const visibilityChange = new window.Event("visibilitychange");
  window.document.dispatchEvent(visibilityChange);
  api.recordUiTiming("ui.performance.batch", 999);
  frame(10_000);
  const error = new window.Error("UI failure /Users/alice/private.log");
  api.captureUiError(error, "test");
  controller.dispose();
  await api.stopUiTelemetry();
  assert.equal(frames.size, 0);
  const bodies = requests.map(request => request.body);
  const encoded = bodies.join("\n");
  assert.ok(requests.length > 0);
  const allowedRequests = requests.every(request => request.url.startsWith("https://o4512180958068736.ingest.de.sentry.io/"));
  assert.ok(allowedRequests);
  contains(encoded, '"environment":"development"');
  contains(encoded, "ui.logs.publish.mean");
  contains(encoded, "ui.logs.send.mean");
  contains(encoded, "ui.logs.retention.mean");
  contains(encoded, "ui.logs.evicted");
  contains(encoded, "ui.logs.session_expired");
  contains(encoded, "This log session expired or closed", false);
  contains(encoded, "ui.logs.query_parse.mean");
  contains(encoded, "ui.logs.app_identity.mean");
  contains(encoded, "ui.logs.filter.mean");
  contains(encoded, "ui.logs.buffered_rows");
  contains(encoded, "ui.logs.filtered_rows");
  contains(encoded, "ui.logs.search");
  contains(encoded, "ui.logs.foreground_change");
  contains(encoded, "ui.annotations.tree_processing.mean");
  contains(encoded, "ui.annotations.inspection.mean");
  contains(encoded, "ui.annotations.message_build.mean");
  contains(encoded, "ui.annotations.selection_context.mean");
  contains(encoded, "ui.annotations.context_build.mean");
  contains(encoded, "ui.annotations.send.mean");
  contains(encoded, "ui.annotations.send_success");
  contains(encoded, "ui.annotations.send_timeout");
  contains(encoded, "ui.annotations.send_composer_unavailable");
  contains(encoded, "ui.annotations.send_failure");
  contains(encoded, "ui.annotations.source_available");
  contains(encoded, "ui.annotations.runtime_available");
  contains(encoded, "ui.annotations.inspection_fallback");
  contains(encoded, '"surface":{"value":"simulator"');
  contains(encoded, "ui.app_flow.layout.mean");
  contains(encoded, "ui.app_flow.zoom.mean");
  contains(encoded, "ui.app_flow.update.mean");
  contains(encoded, '"surface":{"value":"app-flow"');
  contains(encoded, "ui.performance.batch.mean");
  contains(encoded, "ui.recording.process.mean");
  contains(encoded, "ui.recording.display_frames");
  assert.equal(encoded.includes("9007199254740995"), false, "Display frame tokens remain local.");
  assert.equal(encoded.includes("9007199754741116"), false, "Device frame timestamps remain local.");
  assert.equal(encoded.includes("jankType"), false, "Device jank measurements remain local.");
  assert.equal(encoded.includes("jankRatePercent"), false, "Derived device jank statistics remain local.");
  assert.equal(encoded.includes("p95FrameIntervalMs"), false, "Device frame pacing remains local.");
  contains(encoded, "ui.recording.derive.mean");
  contains(encoded, "ui.screenshot.capture.mean");
  contains(encoded, "ui.annotations.inspection_truncated");
  contains(encoded, '"surface":{"value":"logs"');
  contains(encoded, '"surface":{"value":"performance"');
  contains(encoded, '"surface":{"value":"simulator"');
  contains(encoded, '"surface":{"value":"recording"');
  contains(encoded, "ui.frame_interval.mean");
  contains(encoded, "UI failure");
  contains(encoded, '"action":{"value":"mobile_ios_mirror_session"');
  contains(encoded, '"outcome":{"value":"error"');
  contains(encoded, callRestriction, false);
  contains(encoded, "PRIVATE_", false);
  contains(encoded, "alice", false);
  contains(encoded, '"value":999', false);
});

test("shared app discovery measures the active context and excludes cancelled or cross-surface work", async t => {
  const root = process.cwd();
  const built = await build({
    stdin: { contents: 'export * from "./src/ui/telemetry.ts"; export { DeviceAppsStore } from "./src/ui/device-apps.ts";', resolveDir: root, loader: "ts" },
    bundle: true, write: false, format: "iife", globalName: "Telemetry", platform: "browser", target: "chrome120",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const html = `<html><head><meta name="mobile-dev-environment" content="development">${identityMeta}</head></html>`;
  const dom = new JSDOM(html, { pretendToBeVisual: true, runScripts: "outside-only", url: "https://mobile-dev.test/" });
  t.after(() => dom.window.close());
  const window = dom.window;
  let now = 100;
  let visibility = "visible";
  Object.defineProperty(window.performance, "now", { value: () => now });
  Object.defineProperty(window.performance, "getEntriesByType", { value: () => [] });
  Object.defineProperty(window.performance, "getEntries", { value: () => [] });
  Object.defineProperty(window.document, "visibilityState", { get: () => visibility });
  const bodies: string[] = [];
  window.fetch = async (_url, options) => {
    bodies.push(String(options?.body ?? ""));
    return new Response("", { status: 200 });
  };
  window.eval(built.outputFiles[0].text);
  const api = window.Telemetry;
  let resolve!: (result: unknown) => void;
  const app = { callServerTool() { return new Promise(done => { resolve = done; }); } };
  api.startUiTelemetry(app);
  api.setUiSurface("logs");
  api.setUiTelemetryContext({ device_platform: "ios", device_kind: "simulator" });
  const store = new api.DeviceAppsStore(app, window.document);
  t.after(() => store.dispose());
  store.selectDevice({ udid: "PRIVATE_DEVICE", name: "PRIVATE_NAME", state: "Booted", runtime: "iOS" });
  store.setAvailable(true);
  const initial = store.refresh();
  now = 130;
  resolve({ content: [], structuredContent: { apps: [{ bundleId: "PRIVATE_BUNDLE", pid: 123, foreground: true }], foregroundApp: { bundleId: "PRIVATE_BUNDLE", pid: 123 } } });
  await initial;
  api.flushUiMeasurements();
  const crossSurface = store.refresh();
  api.setUiSurface("performance");
  now = 160;
  resolve({ content: [], structuredContent: { apps: [], foregroundApp: null } });
  await crossSurface;
  const crossDevice = store.refresh();
  api.setUiTelemetryContext({ device_platform: "android" });
  now = 190;
  resolve({ content: [], structuredContent: { apps: [], foregroundApp: null } });
  await crossDevice;
  const hidden = store.refresh();
  visibility = "hidden";
  const hiddenEvent = new window.Event("visibilitychange");
  window.document.dispatchEvent(hiddenEvent);
  now = 220;
  resolve({ content: [], structuredContent: { apps: [], foregroundApp: null } });
  await hidden;
  store.dispose();
  await api.stopUiTelemetry();
  const captured = bodies.join("\n");
  contains(captured, "ui.device_apps.discovery.samples");
  contains(captured, "ui.device_apps.discovery.mean");
  contains(captured, "PRIVATE_DEVICE", false);
  contains(captured, "PRIVATE_NAME", false);
  contains(captured, "PRIVATE_BUNDLE", false);
  const metricLines = captured.split("\n").filter(line => line.includes("ui.device_apps.discovery.mean"));
  const metrics = [];
  for (const line of metricLines) {
    const payload = JSON.parse(line);
    for (const metric of payload.items) {
      if (metric.name === "ui.device_apps.discovery.mean") metrics.push(metric);
    }
  }
  assert.equal(metrics.length, 1);
  assert.equal(metrics[0].attributes.surface.value, "logs");
  assert.equal(metrics[0].attributes.device_platform.value, "ios");
  assert.equal(metrics[0].value, 30);
});
