import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { recordingFixture } from "./recording-fixtures.ts";

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
    const html = `<html><head><meta name="mobile-dev-environment" content="${environment}"><meta name="mobile-dev-live-revision" content="test"></head></html>`;
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
    const other = environment === "development" ? "release" : "development";
    contains(captured, `"environment":"${other}"`, false);
  }
  const invalid = new JSDOM("<html><head></head></html>", { runScripts: "outside-only" });
  t.after(() => invalid.window.close());
  invalid.window.eval(built.outputFiles[0].text);
  assert.throws(() => invalid.window.Telemetry.startUiTelemetry({}), /Sentry environment must be/);
});

test("browser telemetry labels surface measurements, propagates traces, and flushes on teardown", async t => {
  const root = process.cwd();
  const built = await build({
    stdin: { contents: 'export * from "./src/ui/telemetry.ts"; export { RecordingController } from "./src/ui/recording-controller.ts"; export * as Sentry from "@sentry/react"; export { ScreenAnnotationsStore } from "./src/ui/screen-annotations.ts"; export { PanelContext } from "./src/ui/model-context.ts";', resolveDir: root, loader: "ts" },
    bundle: true, write: false, format: "iife", globalName: "Telemetry", platform: "browser", target: "chrome120",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const dom = new JSDOM('<html data-view="workspace"><head><meta name="mobile-dev-environment" content="development"></head><body></body></html>', {
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
  const app = { async callServerTool(params: Record<string, unknown>) { calls.push(params); return { content: [{ type: "text", text: "PRIVATE_TOOL_RESULT" }] }; } };
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
    component: "PRIVATE_COMPONENT", owners: ["PRIVATE_OWNER"], source: { file: "/Users/alice/private.tsx", line: 49, column: 11 },
  } }];
  await store.toggle(); store.select({ x: 50, y: 40 }); store.setText("PRIVATE_NOTE"); await store.save(); await store.send();
  store.select({ x: 50, y: 40 }); store.setText("PRIVATE_NOTE_AGAIN"); await store.save();
  for (const failure of ["timeout", "composer", "unexpected", ""]) { sendFailure = failure; await store.send(); }
  store.dispose();
  api.countUiEvent("ui.annotations.runtime_available");
  api.countUiEvent("ui.annotations.inspection_fallback");
  api.setUiSurface("logs");
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
  controller.accept({ content: [], structuredContent: { recording } });
  assert.equal(api.getUiTelemetryAttributes().surface, "recording");
  assert.equal(api.getUiTelemetryAttributes().device_platform, "android");
  api.setUiTelemetryContext({ view: "recording" });
  api.recordUiTiming("ui.recording.derive", 3);
  await app.callServerTool({ name: "mobile_read_performance_recording", arguments: { recordingId: "PRIVATE_RECORDING_ID" } });
  assert.equal(calls[3]._meta, undefined, "Recording polling does not create a trace per refresh.");
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
  contains(encoded, "ui.annotations.tree_processing.mean");
  contains(encoded, "ui.annotations.inspection.mean");
  contains(encoded, "ui.annotations.message_build.mean");
  contains(encoded, "ui.annotations.send.mean");
  contains(encoded, "ui.annotations.send_success");
  contains(encoded, "ui.annotations.send_timeout");
  contains(encoded, "ui.annotations.send_composer_unavailable");
  contains(encoded, "ui.annotations.send_failure");
  contains(encoded, "ui.annotations.source_available");
  contains(encoded, "ui.annotations.runtime_available");
  contains(encoded, "ui.annotations.inspection_fallback");
  contains(encoded, '"surface":{"value":"simulator"');
  contains(encoded, "ui.performance.batch.mean");
  contains(encoded, "ui.recording.process.mean");
  contains(encoded, "ui.recording.derive.mean");
  contains(encoded, "ui.screenshot.capture.mean");
  contains(encoded, "ui.annotations.inspection_truncated");
  contains(encoded, '"surface":{"value":"logs"');
  contains(encoded, '"surface":{"value":"performance"');
  contains(encoded, '"surface":{"value":"simulator"');
  contains(encoded, '"surface":{"value":"recording"');
  contains(encoded, "ui.frame_interval.mean");
  contains(encoded, "UI failure");
  contains(encoded, "PRIVATE_", false);
  contains(encoded, "alice", false);
  contains(encoded, '"value":999', false);
});
