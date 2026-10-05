import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Sentry from "@sentry/node";
import type { Envelope } from "@sentry/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { MeasurementWindow, sampleTrace, scrubErrorEvent, scrubMetric, scrubSpan, TELEMETRY_META_KEY } from "../src/shared/telemetry.ts";
import { captureServerError, installTracePropagation, instrumentMcpServer, IOSLogProcessingTelemetry, recordAndroidBackendStartup, recordPluginUpdate } from "../src/server/telemetry.ts";
import { ExpectedOperationError, FailureEpisodes } from "../src/shared/error-reporting.ts";
import { parseResourceInput } from "../src/server/resource-input.ts";
import { openRequestSession } from "../src/server/request-session.ts";
import { registerDeviceAppsTool } from "../src/server/device-apps/tools.ts";
import { directoryBytes } from "../src/server/storage-metrics.ts";
import { SimulatorUnavailableError } from "../src/server/simulator-unavailable.ts";
import { registerDeviceChoiceTools } from "../src/server/device-choice-tools.ts";
import type { OpenAIFormResult } from "@openai/mcp-extensions/server";
import { adapterClient } from "./agent-device-fixtures.ts";

function contains(text: string, fragment: string, expected = true) {
  const included = text.includes(fragment);
  assert.equal(included, expected, `Telemetry fragment: ${fragment}`);
}

test("UI timing windows retain exact totals, reset, and ignore invalid measurements", () => {
  const window = new MeasurementWindow();
  for (let value = 1; value <= 200; value++) window.record(value);
  window.record(Number.NaN);
  window.record(-1);
  const initial = window.take();
  assert.deepEqual(initial, { count: 200, mean: 100.5, p95: 190, max: 200 });
  const empty = window.take();
  assert.equal(empty, undefined);
  for (let index = 0; index < 100_000; index++) window.record(16);
  const many = window.take();
  assert.deepEqual(many, { count: 100_000, mean: 16, p95: 16, max: 16 });
});

test("high frequency reads and input avoid trace sampling even with a sampled parent", () => {
  let inherited = 0;
  const inherit = (rate: number) => { inherited++; return rate; };
  for (const name of ["resources/read frame://private-session", "notifications/tools/list_changed", "tools/call mobile_stream_input", "tools/call mobile_ios_mirror_input", "tools/call mobile_read_cpu", "tools/call devices", "tools/call session", "tools/call events"]) {
    const rate = sampleTrace(name, inherit);
    assert.equal(rate, 0);
  }
  assert.equal(inherited, 0);
  const rate = sampleTrace("tools/call mobile_cpu_session", inherit);
  assert.equal(rate, 0.1);
  const screenshotRate = sampleTrace("tools/call mobile_ios_mirror_capture_screenshot", inherit);
  assert.equal(screenshotRate, 0.1);
});

test("iOS parser telemetry aggregates bounded timings and flushes once on stream cleanup", async t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const envelopes: Envelope[] = [];
  Sentry.init({
    dsn: "https://public@example.com/1", defaultIntegrations: false, beforeSendMetric: scrubMetric,
    transport: () => ({ async send(envelope) { envelopes.push(envelope); return { statusCode: 200 }; }, async flush() { return true; } }),
  });
  t.after(async () => { await Sentry.close(); });
  const telemetry = new IOSLogProcessingTelemetry("physical");
  t.after(() => telemetry.close());
  for (let index = 0; index < 1000; index++) telemetry.record(2);
  await Sentry.flush();
  const before = JSON.stringify(envelopes);
  contains(before, "logs.ios.parse", false);
  t.mock.timers.tick(30000);
  await Sentry.flush();
  const periodic = JSON.stringify(envelopes);
  for (const name of ["samples", "mean", "p95", "max"]) contains(periodic, `logs.ios.parse.${name}`);
  contains(periodic, "millisecond");
  contains(periodic, '"surface":{"value":"logs"');
  contains(periodic, '"device_kind":{"value":"physical"');
  contains(periodic, '"device_platform":{"value":"ios"');
  telemetry.record(3);
  telemetry.close();
  await Sentry.flush();
  const closed = JSON.stringify(envelopes);
  telemetry.record(4);
  telemetry.close();
  t.mock.timers.tick(60000);
  await Sentry.flush();
  const after = JSON.stringify(envelopes);
  assert.equal(after, closed, "Closing stops the timer and ignores late measurements.");
});

test("Android backend startup metrics retain product attribution and honor opt-out", async t => {
  const envelopes: Envelope[] = [];
  Sentry.init({
    dsn: "https://public@example.com/1", defaultIntegrations: false, beforeSendMetric: scrubMetric,
    transport: () => ({ async send(envelope) { envelopes.push(envelope); return { statusCode: 200 }; }, async flush() { return true; } }),
  });
  t.after(async () => { await Sentry.close(); });
  recordAndroidBackendStartup(150, "ready");
  recordAndroidBackendStartup(300, "failed");
  await Sentry.flush();
  const sent = JSON.stringify(envelopes);
  for (const fragment of ["android.backend.startup.samples", "android.backend.startup.duration", "millisecond", '"surface":{"value":"simulator"', '"device_platform":{"value":"android"', '"outcome":{"value":"ready"', '"outcome":{"value":"failed"']) {
    contains(sent, fragment);
  }
  const previous = process.env.MOBILE_DEV_TELEMETRY;
  process.env.MOBILE_DEV_TELEMETRY = "off";
  t.after(() => {
    if (previous === undefined) delete process.env.MOBILE_DEV_TELEMETRY;
    else process.env.MOBILE_DEV_TELEMETRY = previous;
  });
  recordAndroidBackendStartup(999, "failed");
  await Sentry.flush();
  const afterOptOut = JSON.stringify(envelopes);
  assert.equal(afterOptOut, sent);
});

test("plugin update metrics measure plugin work without device context and honor opt-out", async t => {
  const envelopes: Envelope[] = [];
  Sentry.init({
    dsn: "https://public@example.com/1", defaultIntegrations: false, beforeSendMetric: scrubMetric,
    transport: () => ({ async send(envelope) { envelopes.push(envelope); return { statusCode: 200 }; }, async flush() { return true; } }),
  });
  const previous = process.env.MOBILE_DEV_TELEMETRY;
  delete process.env.MOBILE_DEV_TELEMETRY;
  t.after(async () => {
    if (previous === undefined) delete process.env.MOBILE_DEV_TELEMETRY;
    else process.env.MOBILE_DEV_TELEMETRY = previous;
    await Sentry.close();
  });
  recordPluginUpdate("check", "available", 80);
  recordPluginUpdate("install", "updated", 2000);
  recordPluginUpdate("install", "failed", 3000);
  await Sentry.flush();
  const sent = JSON.stringify(envelopes);
  for (const fragment of ["plugin.update.operations", "plugin.update.duration", "millisecond", '"operation":{"value":"check"', '"outcome":{"value":"updated"', '"outcome":{"value":"failed"']) contains(sent, fragment);
  for (const fragment of ["device_platform", "device_kind", "latestVersion", "currentVersion", "user.id", "telemetry_session"]) contains(sent, fragment, false);
  process.env.MOBILE_DEV_TELEMETRY = "off";
  recordPluginUpdate("install", "updated", 999);
  await Sentry.flush();
  const afterOptOut = JSON.stringify(envelopes);
  assert.equal(afterOptOut, sent);
});

test("Agent Device adapter continues traces and reports failures without native tool payloads", async t => {
  const envelopes: Envelope[] = [];
  Sentry.init({
    dsn: "https://public@example.com/1", defaultIntegrations: false,
    tracesSampler: context => context.inheritOrSampleWith(1), beforeSend: scrubErrorEvent, beforeSendSpan: scrubSpan,
    transport: () => ({ async send(envelope) { envelopes.push(envelope); return { statusCode: 200 }; }, async flush() { return true; } }),
  });
  t.after(async () => { await Sentry.close(); });
  let observedTrace: string | undefined;
  let calls = 0;
  const { client } = await adapterClient(t, async () => {
    calls++;
    const span = Sentry.getActiveSpan();
    observedTrace = span?.spanContext().traceId;
    if (calls === 2) throw new Error("PRIVATE_NATIVE_ERROR with PRIVATE_NATIVE_ARGUMENT");
    if (calls > 2) return { isError: true, content: [], structuredContent: { code: "DEVICE_NOT_FOUND", message: "PRIVATE_STOPPED_DEVICE" } };
    return { isError: true, content: [{ type: "text", text: "PRIVATE_NATIVE_RESULT" }] };
  });
  const traceId = "1234567890abcdef1234567890abcdef";
  await client.callTool({ name: "type", arguments: { session: "PRIVATE_SESSION", text: "PRIVATE_NATIVE_ARGUMENT" }, _meta: {
    "sentry-trace": `${traceId}-1234567890abcdef-1`,
  } });
  assert.equal(observedTrace, traceId);
  await client.callTool({ name: "type", arguments: { session: "PRIVATE_SESSION", text: "PRIVATE_NATIVE_ARGUMENT" } });
  await Sentry.flush();
  const encoded = JSON.stringify(envelopes);
  contains(encoded, "PRIVATE_", false);
  contains(encoded, traceId);
  contains(encoded, "Agent Device command failed.");
  contains(encoded, "Agent Device tool transport failed.");
  contains(encoded, "agent_device.catalog.ready");
  const items = envelopes.flatMap(envelope => envelope[1]);
  const errors = items.filter(item => item[0].type === "event");
  await client.callTool({ name: "type", arguments: { session: "PRIVATE_SESSION", text: "PRIVATE_NATIVE_ARGUMENT" } });
  await Sentry.flush();
  const afterItems = envelopes.flatMap(envelope => envelope[1]);
  const afterErrors = afterItems.filter(item => item[0].type === "event");
  assert.equal(afterErrors.length, errors.length, "Expected unavailable devices must not produce Sentry issues");
});

test("error and streamed-span filters remove app payloads and local identifiers", () => {
  const traceId = "1".repeat(32);
  const spanId = "2".repeat(16);
  const filtered = scrubErrorEvent({
    message: "Failed /Users/alice/private.log for alice@example.com at https://private.test/path Bearer SECRET",
    request: { data: "private request" }, extra: { logs: "private logs" }, user: { email: "alice@example.com" }, server_name: "private-host",
    exception: { values: [{ value: "Command failed: secret --token password", mechanism: { type: "generic", data: { input: "private input" } }, stacktrace: { frames: [{ filename: "app:///mobile-dev-ui.js", vars: { token: "private" }, pre_context: ["private"], context_line: "private", post_context: ["private"] }] } }] },
    contexts: { trace: { trace_id: traceId, span_id: spanId, data: { logs: "private" } }, device: { name: "private device" } },
  });
  const encoded = JSON.stringify(filtered);
  contains(encoded, "private", false);
  contains(encoded, "alice", false);
  contains(encoded, "SECRET", false);
  assert.equal(filtered.exception?.values?.[0].value, "Child process command failed");
  assert.equal(filtered.exception?.values?.[0].stacktrace?.frames?.[0].filename, "app:///mobile-dev-ui.js");
  const span = scrubSpan({
    trace_id: traceId, span_id: spanId, name: "resources/read frame://private-session", start_timestamp: 1, timestamp: 2,
    attributes: { "mcp.request.argument.secret": "private", "mcp.response.content": "private", "mcp.resource.uri": "private", "error.message": "private", surface: "logs" },
  });
  assert.equal(span.name, "resources/read");
  assert.deepEqual(span.attributes, { surface: "logs" });
});

test("Node system error integration cannot send command arguments or output", async t => {
  const envelopes: Envelope[] = [];
  Sentry.init({
    dsn: "https://public@example.com/1", defaultIntegrations: false,
    integrations: [Sentry.systemErrorIntegration()], beforeSend: scrubErrorEvent,
    transport: () => ({ async send(envelope) { envelopes.push(envelope); return { statusCode: 200 }; }, async flush() { return true; } }),
  });
  t.after(async () => { await Sentry.close(); });
  const error = new Error("Command failed: PRIVATE_COMMAND PRIVATE_ARGUMENT");
  Object.assign(error, {
    errno: -2, code: "ENOENT", path: "/Users/private/helper", dest: "/Users/private/output",
    cmd: "PRIVATE_COMMAND PRIVATE_ARGUMENT", spawnargs: ["PRIVATE_DEVICE", "PRIVATE_TOKEN"],
    syscall: "spawn PRIVATE_COMMAND", stdout: "PRIVATE_APP_OUTPUT", stderr: "PRIVATE_ERROR_OUTPUT",
  });
  Sentry.captureException(error);
  await Sentry.flush();
  const encoded = JSON.stringify(envelopes);
  contains(encoded, "Child process command failed");
  contains(encoded, "node_system_error", false);
  contains(encoded, "PRIVATE_", false);
  contains(encoded, "/Users/private", false);
});

test("UI trace context crosses the MCP bridge and handled server errors exclude tool payloads", async t => {
  const envelopes: Envelope[] = [];
  Sentry.init({
    dsn: "https://public@example.com/1", defaultIntegrations: false,
    tracesSampler: context => context.inheritOrSampleWith(1), beforeSend: scrubErrorEvent, beforeSendSpan: scrubSpan,
    transport: () => ({ async send(envelope) { envelopes.push(envelope); return { statusCode: 200 }; }, async flush() { return true; } }),
  });
  const server = new McpServer({ name: "telemetry-test", version: "1" });
  Sentry.wrapMcpServerWithSentry(server, { recordInputs: false, recordOutputs: false });
  let observedTrace: string | undefined;
  let observedTags: Record<string, unknown> | undefined;
  const secret = z.string();
  server.registerTool("test_action", { inputSchema: { secret } }, async () => {
    const span = Sentry.getActiveSpan();
    observedTrace = span?.spanContext().traceId;
    const scope = Sentry.getIsolationScope();
    observedTags = scope.getScopeData().tags;
    const error = new Error("Handled tool failed /Users/alice/private.log");
    captureServerError(error, "test_action");
    return { isError: true, content: [{ type: "text", text: "PRIVATE_TOOL_RESULT" }] };
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  installTracePropagation(serverTransport);
  const client = new Client({ name: "test-client", version: "1" });
  t.after(async () => { await client.close(); await server.close(); await Sentry.close(); });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const traceId = "1234567890abcdef1234567890abcdef";
  const parentId = "1234567890abcdef";
  await client.callTool({ name: "test_action", arguments: { secret: "PRIVATE_TOOL_ARGUMENT" }, _meta: {
    "sentry-trace": `${traceId}-${parentId}-1`,
    [TELEMETRY_META_KEY]: { surface: "logs", layout: "both", view: "workspace", device_platform: "ios", device_kind: "physical", user: "PRIVATE_USER", logs: "PRIVATE_LOGS", component: "spoofed" },
  } });
  assert.equal(observedTrace, traceId);
  assert.equal(observedTags?.surface, "logs");
  assert.equal(observedTags?.layout, "both");
  assert.equal(observedTags?.user, undefined);
  assert.equal(observedTags?.component, undefined);
  await client.callTool({ name: "test_action", arguments: { secret: "PRIVATE_RECORDING_ARGUMENT" }, _meta: {
    [TELEMETRY_META_KEY]: { surface: "recording", view: "recording", recordingId: "PRIVATE_RECORDING_ID" },
  } });
  assert.equal(observedTags?.surface, "recording");
  assert.equal(observedTags?.view, "recording");
  assert.equal(observedTags?.recordingId, undefined);
  await client.callTool({ name: "test_action", arguments: { secret: "PRIVATE_COMPARISON_ARGUMENT" }, _meta: {
    [TELEMETRY_META_KEY]: { surface: "comparison", view: "comparison", device_platform: "mixed", device_kind: "none", recordingIds: ["PRIVATE_RUN_A", "PRIVATE_RUN_B"] },
  } });
  assert.equal(observedTags?.surface, "comparison");
  assert.equal(observedTags?.view, "comparison");
  assert.equal(observedTags?.device_platform, "mixed");
  assert.equal(observedTags?.device_kind, "none");
  assert.equal(observedTags?.recordingIds, undefined);
  await Sentry.flush();
  const encoded = JSON.stringify(envelopes);
  contains(encoded, "PRIVATE_", false);
  contains(encoded, "alice", false);
  contains(encoded, traceId);
  contains(encoded, "Handled tool failed");
  const eventItems = envelopes.flatMap(envelope => envelope[1]);
  const errors = eventItems.filter(item => item[0].type === "event");
  assert.equal(errors.length, 3);
  const unavailable = new SimulatorUnavailableError("Expected stopped simulator");
  captureServerError(unavailable, "expected");
  await Sentry.flush();
  const afterItems = envelopes.flatMap(envelope => envelope[1]);
  const afterErrors = afterItems.filter(item => item[0].type === "event");
  assert.equal(afterErrors.length, 3);
});

test("error filters retain only generated identity while metrics and spans omit user dimensions", async () => {
  const userId = "anon_0123456789abcdef0123456789abcdef";
  const sessionId = "run_1234567890abcdef1234567890abcdef";
  const filtered = scrubErrorEvent({
    user: { id: userId, email: "private@example.com", username: "private-name", ip_address: "127.0.0.1", extra: "private-account" },
    tags: { telemetry_session: sessionId, surface: "logs" },
  });
  assert.deepEqual(filtered.user, { id: userId });
  assert.equal(filtered.tags?.telemetry_session, sessionId);
  const rejected = scrubErrorEvent({ user: { id: "private-account" }, tags: { telemetry_session: "private-thread" } });
  assert.equal(rejected.user, undefined);
  assert.equal(rejected.tags?.telemetry_session, undefined);
  const envelopes: Envelope[] = [];
  Sentry.init({
    dsn: "https://public@example.com/1", defaultIntegrations: false,
    initialScope: { user: { id: userId }, tags: { telemetry_session: sessionId } },
    beforeSend: scrubErrorEvent, beforeSendMetric: scrubMetric,
    transport: () => ({ async send(envelope) { envelopes.push(envelope); return { statusCode: 200 }; }, async flush() { return true; } }),
  });
  const error = new Error("Anonymous identity test");
  captureServerError(error, "identity.test");
  Sentry.metrics.count("identity.test", 1, { attributes: { surface: "logs", telemetry_session: sessionId } });
  await Sentry.close();
  const items = envelopes.flatMap(envelope => envelope[1]);
  const errors = items.filter(item => item[0].type === "event");
  assert.equal(errors.length, 1);
  const encodedError = JSON.stringify(errors[0]);
  contains(encodedError, userId);
  contains(encodedError, sessionId);
  const metrics = items.filter(item => item[0].type === "trace_metric");
  assert.ok(metrics.length > 0);
  const encodedMetrics = JSON.stringify(metrics);
  contains(encodedMetrics, userId, false);
  contains(encodedMetrics, sessionId, false);
  const span = scrubSpan({ trace_id: "1".repeat(32), span_id: "2".repeat(16), name: "identity.test", start_timestamp: 1, timestamp: 2,
    attributes: { "user.id": userId, "user.email": "private@example.com", "session.id": sessionId, telemetry_session: sessionId, surface: "logs" } });
  assert.deepEqual(span.attributes, { surface: "logs" });
});

test("native device picker measures preparation and outcomes without private form content", async t => {
  const envelopes: Envelope[] = [];
  Sentry.init({
    dsn: "https://public@example.com/1", defaultIntegrations: false,
    beforeSend: scrubErrorEvent, beforeSendMetric: scrubMetric,
    transport: () => ({ async send(envelope) { envelopes.push(envelope); return { statusCode: 200 }; }, async flush() { return true; } }),
  });
  const server = new McpServer({ name: "picker-telemetry", version: "1" });
  let answer: OpenAIFormResult = { action: "accept", content: { device: "device-1" } };
  registerDeviceChoiceTools(server, { async elicitInput() { return answer; } }, {
    async simulators() { throw new Error("PRIVATE unrelated discovery"); },
    async physicalIos() { throw new Error("PRIVATE unrelated discovery"); },
    async android() { return { connected: true, managed: false, baseUrl: "", devices: [
      { udid: "PRIVATE_SERIAL", name: "PRIVATE_DEVICE_NAME", runtime: "Android", state: "Booted", platform: "android", kind: "physical" },
    ] }; },
  });
  const client = new Client({ name: "picker-host", version: "1" }, { capabilities: { extensions: { "openai/elicitation": { form: {} } } } });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); await Sentry.close(); });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const arguments_ = { message: "PRIVATE_QUESTION", context: "PRIVATE_OPERATION", devices: [
    { platform: "android", kind: "physical", deviceId: "PRIVATE_SERIAL", appName: "PRIVATE_APP" },
  ] };
  for (const action of ["accept", "cancel", "decline"] as const) {
    answer = action === "accept" ? { action, content: { device: "device-1" } } : { action };
    const result = await client.callTool({ name: "mobile_choose_devices", arguments: arguments_ });
    assert.equal(result.isError, undefined);
  }
  answer = { action: "accept", content: { device: "not-offered" } };
  const invalid = await client.callTool({ name: "mobile_choose_devices", arguments: arguments_ });
  assert.equal(invalid.isError, true);
  await Sentry.close();
  const encoded = JSON.stringify(envelopes);
  contains(encoded, "device_picker.prepare");
  contains(encoded, "device_picker.result");
  contains(encoded, "device_picker.selected");
  contains(encoded, "PRIVATE", false);
  contains(encoded, "device-1", false);
  contains(encoded, "selection_mode");
  contains(encoded, "millisecond");
  const items = envelopes.flatMap(envelope => envelope[1]);
  const errors = items.filter(item => item[0].type === "event");
  assert.equal(errors.length, 0, "Expected stale/invalid device responses do not produce issues.");
});

test("storage measurements count owned files without following external symlinks", async t => {
  const temporary = tmpdir();
  const prefix = join(temporary, "mobile-dev-storage-test-");
  const directory = await mkdtemp(prefix);
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const owned = join(directory, "owned");
  const nested = join(owned, "nested");
  await mkdir(nested, { recursive: true });
  const first = join(owned, "one");
  const second = join(nested, "two");
  await writeFile(first, "123");
  await writeFile(second, "12345");
  const external = join(directory, "external");
  await writeFile(external, "external private data");
  const link = join(owned, "link");
  await symlink(external, link);
  const bytes = await directoryBytes(owned);
  assert.equal(bytes, 8);
  const missing = join(directory, "missing");
  const absentBytes = await directoryBytes(missing);
  assert.equal(absentBytes, 0);
});

test("Node runtime metrics report CPU, memory and event-loop measurements with component labels", async t => {
  const envelopes: Envelope[] = [];
  const runtimeMetrics = Sentry.nodeRuntimeMetricsIntegration({ collectionIntervalMs: 1000, collect: { memExternal: true } });
  Sentry.init({
    dsn: "https://public@example.com/1", defaultIntegrations: false,
    integrations: [runtimeMetrics],
    transport: () => ({ async send(envelope) { envelopes.push(envelope); return { statusCode: 200 }; }, async flush() { return true; } }),
  });
  t.after(async () => { await Sentry.close(); });
  Sentry.setAttribute("component", "server");
  await new Promise(resolve => { setTimeout(resolve, 1100); });
  await Sentry.flush();
  const encoded = JSON.stringify(envelopes);
  for (const name of ["node.runtime.cpu.utilization", "node.runtime.mem.rss", "node.runtime.mem.heap_used", "node.runtime.mem.external", "node.runtime.mem.array_buffers", "node.runtime.event_loop.delay.p99", "node.runtime.event_loop.utilization"]) {
    contains(encoded, name);
  }
  contains(encoded, '"component":{"value":"server"');
});

test("definition failure tags survive Sentry scrubbing with surface, release and anonymous attribution", async t => {
  const { parseDefinitionDiagnostic, setDefinitionDiagnostic } = await import("../src/shared/simulator-definition-diagnostics.ts");
  const envelopes: Envelope[] = [];
  Sentry.init({
    dsn: "https://public@example.com/1", defaultIntegrations: false, beforeSend: scrubErrorEvent,
    environment: "release", release: "mobile-dev@definition-test",
    transport: () => ({ async send(envelope) { envelopes.push(envelope); return { statusCode: 200 }; }, async flush() { return true; } }),
  });
  t.after(async () => { await Sentry.close(); });
  const error = new Error("Baguette returned HTTP 404 for /simulators/B5C969F6-58A4-4C31-AB12-FB9E56D681DE/definition.json.");
  const diagnostic = parseDefinitionDiagnostic({ definition_diagnostic: {
    schema: "1", stage: "chrome_parse", failure: "invalid", model: "iPhone 17", runtime: "iOS 27.0",
    state: "Booted", panel: "primary", xcode_version: "27.0", private: "PRIVATE_RESPONSE",
  } });
  diagnostic.deviceAfter = "Booted";
  setDefinitionDiagnostic(error, diagnostic);
  const userId = "anon_" + "a".repeat(32);
  Sentry.withScope(scope => {
    scope.setTag("surface", "simulator");
    scope.setUser({ id: userId });
    captureServerError(error, "simulator.tool");
  });
  await Sentry.flush();
  const items = envelopes.flatMap(envelope => envelope[1]);
  const events = items.filter(item => item[0].type === "event");
  assert.equal(events.length, 1);
  const encoded = JSON.stringify(events[0]);
  for (const expected of ["chrome_parse", "invalid", "iPhone 17", "simulator", "release", "mobile-dev@definition-test"]) contains(encoded, expected);
  contains(encoded, "PRIVATE_", false);
  contains(encoded, "B5C969F6", false);
  contains(encoded, userId);
});

test("MCP reporting retains original failures once and keeps unowned protocol and transport errors", async t => {
  const envelopes: Envelope[] = [];
  Sentry.init({
    dsn: "https://public@example.com/1", defaultIntegrations: false, environment: "release",
    beforeSend: scrubErrorEvent, beforeSendSpan: scrubSpan,
    tracesSampler: context => sampleTrace(context.name, context.inheritOrSampleWith),
    initialScope: { user: { id: "anon_0123456789abcdef0123456789abcdef" }, tags: { telemetry_session: "run_1234567890abcdef1234567890abcdef" } },
    transport: () => ({ async send(envelope) { envelopes.push(envelope); return { statusCode: 200 }; }, async flush() { return true; } }),
  });
  const server = new McpServer({ name: "reporting-test", version: "1" });
  instrumentMcpServer(server);
  server.registerResource("unexpected", "logs://unexpected", {}, async () => { throw new Error("Unexpected resource failure"); });
  server.registerResource("expiry", "logs://expiry", {}, async () => { throw new ExpectedOperationError("session_expired", "This log session expired or closed."); });
  server.registerResource("unavailable", "logs://unavailable", {}, async () => { throw new SimulatorUnavailableError("Expected unavailable device"); });
  const numberSchema = z.number();
  server.registerResource("input", "logs://input", {}, async () => { parseResourceInput(numberSchema, "PRIVATE_INPUT"); return { contents: [] }; });
  server.registerResource("response", "logs://response", {}, async () => { numberSchema.parse("PRIVATE_RESPONSE"); return { contents: [] }; });
  server.registerResource("primitive", "logs://primitive", {}, async () => { throw "Plain thrown failure"; });
  server.registerTool("guarded", {}, async () => {
    const error = new Error("Guarded failure");
    captureServerError(error, "guarded");
    return { isError: true, content: [] };
  });
  const client = new Client({ name: "test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  installTracePropagation(serverTransport);
  t.after(async () => { await client.close(); await server.close(); await Sentry.close(); });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const reads = ["unexpected", "expiry", "unavailable", "input", "response", "primitive"].map(name => client.readResource({ uri: `logs://${name}` }));
  const results = await Promise.allSettled(reads);
  const rejected = results.every(result => result.status === "rejected");
  assert.equal(rejected, true);
  await client.callTool({ name: "guarded" });
  await Sentry.flush();
  const items = envelopes.flatMap(envelope => envelope[1]);
  const eventItems = items.filter(item => item[0].type === "event");
  const events = eventItems.map(item => item[1]);
  assert.equal(events.length, 4);
  const encoded = JSON.stringify(events);
  contains(encoded, "Unexpected resource failure");
  contains(encoded, "ZodError");
  contains(encoded, "Guarded failure");
  contains(encoded, "JsonRpcError", false);
  contains(encoded, "session expired", false);
  contains(encoded, "PRIVATE", false);
  contains(encoded, '"environment":"release"');
  contains(encoded, '"user":{"id":"anon_0123456789abcdef0123456789abcdef"}');
  contains(encoded, '"operation":"resources.read"');
  const spans = items.filter(item => item[0].type === "span");
  const encodedSpans = JSON.stringify(spans);
  contains(encodedSpans, "resources/read", false);
  await serverTransport.send({ jsonrpc: "2.0", id: 123456, error: { code: -32603, message: "Unowned protocol failure" } });
  const transportFailure = new Error("Unexpected transport failure");
  serverTransport.onerror?.(transportFailure);
  await Sentry.flush();
  const afterItems = envelopes.flatMap(envelope => envelope[1]);
  const afterEvents = afterItems.filter(item => item[0].type === "event");
  assert.equal(afterEvents.length, 6);
  const after = JSON.stringify(afterEvents);
  contains(after, "Unowned protocol failure");
  contains(after, "Unexpected transport failure");
});

test("discovery reports the first failure per episode and counts repeated and expected outcomes", async t => {
  const envelopes: Envelope[] = [];
  Sentry.init({
    dsn: "https://public@example.com/1", defaultIntegrations: false, beforeSend: scrubErrorEvent, beforeSendMetric: scrubMetric,
    transport: () => ({ async send(envelope) { envelopes.push(envelope); return { statusCode: 200 }; }, async flush() { return true; } }),
  });
  const server = new McpServer({ name: "discovery-reporting-test", version: "1" });
  instrumentMcpServer(server);
  let outcome = "timeout";
  registerDeviceAppsTool(server, async () => {
    if (outcome === "ready") return { apps: [], foregroundApp: null };
    if (outcome === "offline") throw new ExpectedOperationError("device_unavailable", "Device offline");
    const error = new Error(`Discovery ${outcome}`);
    if (outcome === "timeout") error.name = "TimeoutError";
    throw error;
  });
  const client = new Client({ name: "test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  installTracePropagation(serverTransport);
  t.after(async () => { await client.close(); await server.close(); await Sentry.close(); });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const request = { name: "mobile_performance_sources", arguments: { platform: "android", deviceId: "PRIVATE_DEVICE" } };
  for (const next of ["timeout", "timeout", "different", "ready", "timeout", "offline"]) {
    outcome = next;
    await client.callTool(request);
  }
  await Sentry.flush();
  const items = envelopes.flatMap(envelope => envelope[1]);
  const events = items.filter(item => item[0].type === "event");
  assert.equal(events.length, 3);
  const encoded = JSON.stringify(envelopes);
  contains(encoded, "server.error.repeated");
  contains(encoded, "server.error.outcome");
  contains(encoded, "device_unavailable");
  contains(encoded, "PRIVATE_DEVICE", false);
  const capturedEvents = JSON.stringify(events);
  contains(capturedEvents, "Device offline", false);
});

test("failure episode memory is bounded and inactivity starts a new episode", () => {
  const episodes = new FailureEpisodes();
  const first = episodes.shouldReport("a", "first", 0);
  const repeated = episodes.shouldReport("a", "first", 1);
  const changed = episodes.shouldReport("a", "changed", 2);
  const inactive = episodes.shouldReport("a", "changed", 300002);
  assert.equal(first, true);
  assert.equal(repeated, false);
  assert.equal(changed, true);
  assert.equal(inactive, true);
  episodes.recover("a");
  const recovered = episodes.shouldReport("a", "changed", 300003);
  assert.equal(recovered, true);
  for (let index = 0; index < 64; index++) {
    const key = String(index);
    episodes.shouldReport(key, "failure", 300004);
  }
  const evicted = episodes.shouldReport("a", "changed", 300005);
  assert.equal(evicted, true);
  episodes.clear();
  const cleared = episodes.shouldReport("a", "changed", 300006);
  assert.equal(cleared, true);
});

test("Android startup diagnostics retain stage, device state and anonymous error attribution without private content", async t => {
  const { recordAndroidStartupStages, recordAndroidStartupContext, recordAndroidStartupDeviceState, recordAndroidBackendStop } = await import("../src/server/telemetry.ts");
  const { setAndroidStartupDiagnostic } = await import("../src/shared/android-startup-diagnostics.ts");
  const envelopes: Envelope[] = [];
  Sentry.init({
    dsn: "https://public@example.com/1", defaultIntegrations: false, environment: "release", release: "mobile-dev@test",
    beforeSend: scrubErrorEvent, beforeSendMetric: scrubMetric,
    initialScope: { user: { id: "anon_0123456789abcdef0123456789abcdef" }, tags: { telemetry_session: "run_0123456789abcdef0123456789abcdef", device_platform: "ios", device_kind: "simulator" } },
    transport: () => ({ async send(envelope) { envelopes.push(envelope); return { statusCode: 200 }; }, async flush() { return true; } }),
  });
  t.after(async () => { await Sentry.close(); });
  const context = { deviceKind: "physical", transport: "localNetwork", stateBefore: "online", activeBackends: 2, stoppingBackends: 1, startingBackends: 1 } as const;
  const failure = { stage: "socket-poll", outcome: "timeout" } as const;
  recordAndroidStartupContext(context);
  recordAndroidStartupStages({
    type: "mobile-dev/android-startup-complete", outcome: "failed", failedStage: failure.stage, failure: failure.outcome,
    stages: [{ stage: "socket-poll", samples: 2, totalMs: 2200, maxMs: 2000, timedSamples: 2, spawnedSamples: 2, queueMs: 20, executionMs: 2180, outcomes: { ok: 1, timeout: 1 } }],
  }, context);
  recordAndroidStartupDeviceState("offline", 5, context, failure);
  recordAndroidBackendStop(80, context);
  const error = new Error("Android backend startup failed");
  setAndroidStartupDiagnostic(error, failure, context);
  captureServerError(error, "android.tool");
  await Sentry.flush();
  const sent = JSON.stringify(envelopes);
  for (const name of ["stage.mean", "stage.max", "stage.outcomes", "queue.mean", "execution.mean", "execution.spawned", "device_state.samples", "active_backends", "stopping_backends", "in_flight"]) contains(sent, `android.backend.startup.${name}`);
  contains(sent, "android.backend.process_shutdown.duration");
  contains(sent, "android_startup_stage");
  contains(sent, "socket-poll");
  contains(sent, "android_device_state_after");
  contains(sent, "offline");
  contains(sent, '"device_platform":"android"');
  contains(sent, '"device_kind":"physical"');
  contains(sent, "anon_0123456789abcdef0123456789abcdef");
  contains(sent, "mobile-dev@test");
  const previous = process.env.MOBILE_DEV_TELEMETRY;
  process.env.MOBILE_DEV_TELEMETRY = "off";
  t.after(() => {
    if (previous === undefined) delete process.env.MOBILE_DEV_TELEMETRY;
    else process.env.MOBILE_DEV_TELEMETRY = previous;
  });
  recordAndroidStartupContext(context);
  recordAndroidStartupDeviceState("offline", 5, context, failure);
  recordAndroidBackendStop(80, context);
  recordAndroidStartupStages({ type: "mobile-dev/android-startup-complete", outcome: "ready", stages: [] }, context);
  await Sentry.flush();
  const afterOptOut = JSON.stringify(envelopes);
  assert.equal(afterOptOut, sent);
});

test("resource teardown is classified before automatic SDK capture", async t => {
  const envelopes: Envelope[] = [];
  Sentry.init({
    dsn: "https://public@example.com/1", defaultIntegrations: false, beforeSend: scrubErrorEvent, beforeSendMetric: scrubMetric,
    transport: () => ({ async send(envelope) { envelopes.push(envelope); return { statusCode: 200 }; }, async flush() { return true; } }),
  });
  const server = new McpServer({ name: "cancel-reporting-test", version: "1" });
  instrumentMcpServer(server);
  let started: () => void = () => {};
  const opening = new Promise<void>(resolve => { started = resolve; });
  server.registerResource("cancel", "logs://cancel", {}, async (_uri, extra) => {
    await new Promise<void>((_resolve, reject) => {
      extra.signal.addEventListener("abort", () => {
        const error = new Error("Deliberate teardown rejected the active read");
        reject(error);
      }, { once: true });
      started();
    });
    return { contents: [] };
  });
  const client = new Client({ name: "test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  installTracePropagation(serverTransport);
  t.after(async () => { await client.close(); await server.close(); await Sentry.close(); });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const abort = new AbortController();
  const pending = client.readResource({ uri: "logs://cancel" }, { signal: abort.signal });
  const rejection = assert.rejects(pending);
  await opening;
  abort.abort();
  await rejection;
  await new Promise<void>(resolve => setImmediate(resolve));
  await Sentry.flush();
  const items = envelopes.flatMap(envelope => envelope[1]);
  const events = items.filter(item => item[0].type === "event");
  assert.equal(events.length, 0);
  const encoded = JSON.stringify(envelopes);
  contains(encoded, "server.error.outcome");
  contains(encoded, "cancelled");
  contains(encoded, "Deliberate teardown", false);
});

test("cancelled stream requests close late sessions while delivered sessions remain open", async t => {
  const closed: string[] = [];
  const server = new McpServer({ name: "stream-cancellation-test", version: "1" });
  let finishOpen: (id: string) => void = () => {};
  let started: () => void = () => {};
  let settled: () => void = () => {};
  const opening = new Promise<string>(resolve => { finishOpen = resolve; });
  const startedOpening = new Promise<void>(resolve => { started = resolve; });
  const cancelledOpeningSettled = new Promise<void>(resolve => { settled = resolve; });
  server.registerTool("late", { inputSchema: {} }, async (_input, context) => {
    try {
      await openRequestSession(context.signal, () => { started(); return opening; }, id => { closed.push(id); });
      return { content: [] };
    } finally { settled(); }
  });
  server.registerTool("ready", { inputSchema: {} }, async (_input, context) => {
    const id = await openRequestSession(context.signal, async () => "delivered", id => { closed.push(id); });
    return { content: [{ type: "text", text: id }] };
  });
  const client = new Client({ name: "test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  let failResponse = false;
  const send = serverTransport.send.bind(serverTransport);
  serverTransport.send = async (message, options) => {
    if (failResponse && "result" in message) throw new Error("Test response delivery failed");
    await send(message, options);
  };
  installTracePropagation(serverTransport);
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const abort = new AbortController();
  const pending = client.callTool({ name: "late", arguments: {} }, undefined, { signal: abort.signal });
  const rejection = assert.rejects(pending);
  await startedOpening;
  abort.abort();
  await rejection;
  finishOpen("late");
  await cancelledOpeningSettled;
  assert.deepEqual(closed, ["late"]);
  const delivered = new AbortController();
  const result = await client.callTool({ name: "ready", arguments: {} }, undefined, { signal: delivered.signal });
  assert.equal(result.isError, undefined);
  delivered.abort();
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(closed, ["late"]);
  let failed: () => void = () => {};
  const failedResponse = new Promise<void>(resolve => { failed = resolve; });
  server.server.onerror = () => { failed(); };
  failResponse = true;
  const failedAbort = new AbortController();
  const failedCall = client.callTool({ name: "ready", arguments: {} }, undefined, { signal: failedAbort.signal });
  const failedRejection = assert.rejects(failedCall);
  await failedResponse;
  assert.deepEqual(closed, ["late", "delivered"]);
  failedAbort.abort();
  await failedRejection;
});

test("cancellation during stream response preparation closes the session and retains cleanup failures", async t => {
  const envelopes: Envelope[] = [];
  Sentry.init({
    dsn: "https://public@example.com/1", defaultIntegrations: false, beforeSend: scrubErrorEvent, beforeSendMetric: scrubMetric,
    transport: () => ({ async send(envelope) { envelopes.push(envelope); return { statusCode: 200 }; }, async flush() { return true; } }),
  });
  t.after(async () => { await Sentry.close(); });
  const closed: string[] = [];
  const prepared = new AbortController();
  const id = await openRequestSession(prepared.signal, async () => "prepared", id => { closed.push(id); });
  assert.equal(id, "prepared");
  prepared.abort();
  assert.deepEqual(closed, ["prepared"]);
  const late = new AbortController();
  const opening = openRequestSession(late.signal, async () => { late.abort(); return "late"; }, () => {
    throw new Error("Unexpected stream cleanup failure");
  });
  await assert.rejects(opening, { outcome: "cancelled" });
  const alreadyCancelled = new AbortController();
  alreadyCancelled.abort();
  let opened = false;
  const prevented = openRequestSession(alreadyCancelled.signal, async () => { opened = true; return "unexpected"; }, () => {});
  await assert.rejects(prevented, { name: "AbortError" });
  assert.equal(opened, false);
  await Sentry.flush();
  const items = envelopes.flatMap(envelope => envelope[1]);
  const events = items.filter(item => item[0].type === "event");
  assert.equal(events.length, 1);
  const encoded = JSON.stringify(events);
  contains(encoded, "stream.cancel_cleanup");
  contains(encoded, "Unexpected stream cleanup failure");
});
