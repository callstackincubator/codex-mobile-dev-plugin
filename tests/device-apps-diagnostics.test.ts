import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import * as Sentry from "@sentry/node";
import type { Envelope } from "@sentry/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { annotateDeviceAppsError, deviceAppsDiagnostic, deviceAppsDiagnosticSchema, getDeviceAppsDiagnostic,
  withDeviceAppsDiagnostic, DEVICE_APPS_DIAGNOSTIC_META } from "../src/shared/device-apps-diagnostics.ts";
import { readDeviceApps } from "../src/server/device-apps/sources.ts";
import { registerDeviceAppsTool } from "../src/server/device-apps/tools.ts";
import { registerCpuTools } from "../src/server/cpu/tools.ts";
import { CpuSessions } from "../src/server/cpu/sessions.ts";
import { Baguette } from "../src/server/baguette.ts";
import { SimulatorUnavailableError } from "../src/server/simulator-unavailable.ts";
import { scrubErrorEvent } from "../src/shared/telemetry.ts";

test("discovery classification preserves original errors and never derives telemetry from their text", async () => {
  const missing = new Error("PRIVATE_COMMAND PRIVATE_PATH PRIVATE_DEVICE");
  Object.assign(missing, { code: "ENOENT", spawnargs: ["PRIVATE_ARGUMENT"], stderr: "PRIVATE_OUTPUT" });
  const annotated = annotateDeviceAppsError(missing, "foreground", "ios", "physical");
  assert.equal(annotated, missing);
  const outer = annotateDeviceAppsError(annotated, "discovery", "ios", "physical");
  assert.equal(outer, missing);
  const diagnostic = getDeviceAppsDiagnostic(outer);
  assert.deepEqual(diagnostic, { stage: "foreground", failure: "missing_executable", platform: "ios", kind: "physical" });
  const encoded = JSON.stringify(diagnostic);
  const includesPrivate = encoded.includes("PRIVATE");
  assert.equal(includesPrivate, false);
  const cases = [
    { error: { code: "ETIMEDOUT" }, expected: "timeout" },
    { error: { code: -32001 }, expected: "timeout" },
    { error: { killed: true, signal: "SIGTERM" }, expected: "timeout" },
    { error: { code: 1 }, expected: "command_failed" },
    { error: { signal: "SIGABRT" }, expected: "command_failed" },
    { error: { name: "ZodError" }, expected: "invalid_response" },
    { error: new SyntaxError("PRIVATE_OUTPUT"), expected: "invalid_response" },
    { error: { name: "AbortError", code: "ETIMEDOUT" }, expected: "cancelled" },
    { error: new Error("ENOENT timeout PRIVATE_OUTPUT"), expected: "unknown" },
  ];
  for (const entry of cases) {
    const diagnostic = deviceAppsDiagnostic(entry.error, "running_apps", "android");
    assert.equal(diagnostic.failure, entry.expected);
    assert.equal(diagnostic.kind, "unknown");
  }
  const aborted = new Error("cancelled");
  aborted.name = "AbortError";
  const pending = withDeviceAppsDiagnostic(async () => { throw aborted; }, "running_apps", "ios");
  await assert.rejects(pending, error => error === aborted);
});

test("shared discovery distinguishes running-app and foreground failures without changing concurrency", async () => {
  const sources = {
    async apps() { return []; },
    async physical() { return null; },
    async simulator() { return null; },
    async android() { return null; },
  };
  let detected = false;
  const failure = new Error("original command error");
  Object.assign(failure, { code: 1 });
  sources.apps = async () => { throw failure; };
  sources.android = async () => { detected = true; return null; };
  const running = readDeviceApps("PRIVATE_DEVICE", undefined, "android", undefined, sources);
  await assert.rejects(running, error => error === failure);
  assert.equal(detected, true);
  const runningDiagnostic = getDeviceAppsDiagnostic(failure);
  assert.deepEqual(runningDiagnostic, {
    stage: "running_apps", failure: "command_failed", platform: "android", kind: "unknown",
  });
  sources.apps = async () => [];
  const text = z.string();
  const parsed = text.safeParse(null);
  assert.equal(parsed.success, false);
  if (parsed.success) return;
  sources.simulator = async () => { throw parsed.error; };
  const foreground = readDeviceApps("PRIVATE_DEVICE", undefined, "ios", undefined, sources);
  await assert.rejects(foreground, error => error === parsed.error);
  const foregroundDiagnostic = getDeviceAppsDiagnostic(parsed.error);
  assert.deepEqual(foregroundDiagnostic, {
    stage: "foreground", failure: "invalid_response", platform: "ios", kind: "simulator",
  });
});

test("MCP discovery reports one classified error, returns only bounded metadata, and retains expected-error exclusions", async t => {
  const envelopes: Envelope[] = [];
  Sentry.init({ dsn: "https://public@example.com/1", defaultIntegrations: false, beforeSend: scrubErrorEvent,
    transport: () => ({ async send(envelope) { envelopes.push(envelope); return { statusCode: 200 }; }, async flush() { return true; } }),
  });
  const server = new McpServer({ name: "discovery-diagnostic-test", version: "1" });
  const failed = new Error("Command failed: PRIVATE_PATH PRIVATE_DEVICE PRIVATE_ARGUMENT\nPRIVATE_OUTPUT");
  Object.assign(failed, { code: 2 });
  let failure: Error = failed;
  registerDeviceAppsTool(server, async () => {
    const annotated = annotateDeviceAppsError(failure, "foreground", "ios", "physical");
    throw annotated;
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "discovery-diagnostic-client", version: "1" });
  t.after(async () => { await client.close(); await server.close(); await Sentry.close(); });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const result = await client.callTool({ name: "mobile_performance_sources", arguments: { deviceId: "PRIVATE_DEVICE", kind: "physical" } });
  assert.equal(result.isError, true);
  assert.deepEqual(result._meta?.[DEVICE_APPS_DIAGNOSTIC_META], {
    stage: "foreground", failure: "command_failed", platform: "ios", kind: "physical",
  });
  assert.deepEqual(result.content, [{ type: "text", text: failed.message }]);
  await Sentry.flush(2000);
  const items = envelopes.flatMap(envelope => envelope[1]);
  const events = items.filter(item => item[0].type === "event");
  assert.equal(events.length, 1);
  const event = events[0][1];
  assert.equal(typeof event, "object");
  assert.ok(event && "tags" in event);
  assert.deepEqual(event.tags, { discovery_stage: "foreground", discovery_failure: "command_failed",
    device_platform: "ios", device_kind: "physical", operation: "device_apps.discover" });
  const encoded = JSON.stringify(envelopes);
  const includesPrivate = encoded.includes("PRIVATE");
  assert.equal(includesPrivate, false);
  const abort = new Error("aborted");
  abort.name = "AbortError";
  for (const expected of [abort, new SimulatorUnavailableError("stopped")]) {
    failure = expected;
    await client.callTool({ name: "mobile_performance_sources", arguments: { deviceId: "PRIVATE_DEVICE", kind: "physical" } });
  }
  await Sentry.flush(2000);
  const remainingItems = envelopes.flatMap(envelope => envelope[1]);
  const remaining = remainingItems.filter(item => item[0].type === "event");
  assert.equal(remaining.length, 1);
});

test("CPU discovery validation failures carry their stage through the MCP response", async t => {
  const server = new McpServer({ name: "validation-diagnostic-test", version: "1" });
  const cpu = new CpuSessions();
  const baguette = new Baguette("http://127.0.0.1:1");
  registerCpuTools(server, cpu, baguette, { apps: async () => { throw new Error("should not discover"); },
    androidDevices: async () => [], iosDevices: async () => [] });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "validation-diagnostic-client", version: "1" });
  t.after(async () => { await client.close(); await server.close(); await cpu.close(); baguette.dispose(); });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const result = await client.callTool({ name: "mobile_performance_sources", arguments: { platform: "android", deviceId: "PRIVATE_DEVICE" } });
  assert.deepEqual(result._meta?.[DEVICE_APPS_DIAGNOSTIC_META], {
    stage: "device_validation", failure: "unknown", platform: "android", kind: "unknown",
  });
});

test("diagnostic metadata rejects unknown values and extra fields rather than forwarding payloads", () => {
  const diagnostic = { stage: "foreground", failure: "timeout", platform: "ios", kind: "physical" };
  for (const invalid of [{ ...diagnostic, stage: "PRIVATE_PATH" }, { ...diagnostic, failure: "PRIVATE_OUTPUT" },
    { ...diagnostic, platform: "PRIVATE_DEVICE" }, { ...diagnostic, kind: "PRIVATE_DEVICE" }, { ...diagnostic, command: "PRIVATE_COMMAND" }]) {
    const parsed = deviceAppsDiagnosticSchema.safeParse(invalid);
    assert.equal(parsed.success, false);
  }
});

test("UI discovery leaves server errors with the server and reports transport and malformed responses", async t => {
  const root = process.cwd();
  const built = await build({ stdin: { contents: 'export * from "./src/ui/telemetry.ts"; export { DeviceAppsStore } from "./src/ui/device-apps.ts";', resolveDir: root, loader: "ts" },
    bundle: true, write: false, format: "iife", globalName: "Telemetry", platform: "browser", target: "chrome120",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const html = '<html><head><meta name="mobile-dev-environment" content="development"><meta name="mobile-dev-user-id" content="anon_0123456789abcdef0123456789abcdef"><meta name="mobile-dev-session-id" content="run_1234567890abcdef1234567890abcdef"></head></html>';
  const dom = new JSDOM(html, { pretendToBeVisual: true, runScripts: "outside-only", url: "https://mobile-dev.test/" });
  t.after(() => dom.window.close());
  const bodies: string[] = [];
  dom.window.fetch = async (_url, options) => { const body = String(options?.body ?? ""); bodies.push(body); return new Response("", { status: 200 }); };
  Object.defineProperty(dom.window.performance, "getEntriesByType", { value: () => [] });
  Object.defineProperty(dom.window.performance, "getEntries", { value: () => [] });
  dom.window.eval(built.outputFiles[0].text);
  const api = dom.window.Telemetry;
  let resolve: (result: unknown) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const app = { callServerTool() { return new Promise((accept, fail) => { resolve = accept; reject = fail; }); } };
  api.startUiTelemetry(app);
  api.setUiSurface("logs");
  const store = new api.DeviceAppsStore(app, dom.window.document);
  store.selectDevice({ udid: "PRIVATE_DEVICE", name: "PRIVATE_NAME", state: "connected", runtime: "iOS", platform: "ios", kind: "physical" });
  store.setAvailable(true);
  let pending = store.refresh();
  resolve({ isError: true, content: [{ type: "text", text: "PRIVATE_COMMAND PRIVATE_OUTPUT" }],
    _meta: { [DEVICE_APPS_DIAGNOSTIC_META]: { stage: "foreground", failure: "command_failed", platform: "ios", kind: "physical" } } });
  await pending;
  const snapshot = store.getSnapshot();
  assert.equal(snapshot.error, "PRIVATE_COMMAND PRIVATE_OUTPUT");
  pending = store.refresh();
  resolve({ isError: true, content: [{ type: "text", text: "PRIVATE_OUTPUT" }],
    _meta: { [DEVICE_APPS_DIAGNOSTIC_META]: { stage: "PRIVATE_STAGE", failure: "PRIVATE_FAILURE", platform: "ios", kind: "physical" } } });
  await pending;
  pending = store.refresh();
  const timeout = new dom.window.Error("PRIVATE_TRANSPORT");
  timeout.name = "TimeoutError";
  reject(timeout);
  await pending;
  pending = store.refresh();
  reject(timeout);
  await pending;
  pending = store.refresh();
  resolve({ content: [], structuredContent: { apps: [], foregroundApp: null } });
  await pending;
  pending = store.refresh();
  const recoveredTimeout = new dom.window.Error("PRIVATE_TRANSPORT");
  recoveredTimeout.name = "TimeoutError";
  reject(recoveredTimeout);
  await pending;
  pending = store.refresh();
  resolve({ content: [], structuredContent: { apps: "PRIVATE_RESPONSE" } });
  await pending;
  pending = store.refresh();
  resolve({ isError: true, content: [{ type: "text", text: "PRIVATE_CANCELLED" }],
    _meta: { [DEVICE_APPS_DIAGNOSTIC_META]: { stage: "foreground", failure: "cancelled", platform: "ios", kind: "physical" } } });
  await pending;
  pending = store.refresh();
  store.dispose();
  const cancelled = new dom.window.Error("PRIVATE_CANCELLED");
  cancelled.name = "AbortError";
  reject(cancelled);
  await pending;
  await api.stopUiTelemetry();
  const captured = bodies.join("\n");
  const includesPrivate = captured.includes("PRIVATE");
  assert.equal(includesPrivate, false);
  const includesRepeated = captured.includes("ui.device_apps.discovery_repeated");
  assert.equal(includesRepeated, true);
  const events = bodies.flatMap(body => {
    const lines = body.split("\n");
    const items = [];
    for (let index = 1; index < lines.length - 1; index += 2) {
      const header = JSON.parse(lines[index]);
      if (header.type === "event") {
        const event = JSON.parse(lines[index + 1]);
        items.push(event);
      }
    }
    return items;
  });
  assert.equal(events.length, 3);
  const diagnosticTags = events.map(event => ({ stage: event.tags.discovery_stage, failure: event.tags.discovery_failure,
    platform: event.tags.device_platform, kind: event.tags.device_kind, surface: event.tags.surface }));
  assert.deepEqual(diagnosticTags, [
    { stage: "transport", failure: "timeout", platform: "ios", kind: "physical", surface: "logs" },
    { stage: "transport", failure: "timeout", platform: "ios", kind: "physical", surface: "logs" },
    { stage: "response", failure: "invalid_response", platform: "ios", kind: "physical", surface: "logs" },
  ]);
});
