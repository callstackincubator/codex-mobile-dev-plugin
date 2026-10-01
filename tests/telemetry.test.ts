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
import { captureServerError, installTracePropagation } from "../src/server/telemetry.ts";
import { directoryBytes } from "../src/server/storage-metrics.ts";
import { SimulatorUnavailableError } from "../src/server/simulator-unavailable.ts";
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
  await Sentry.flush();
  const encoded = JSON.stringify(envelopes);
  contains(encoded, "PRIVATE_", false);
  contains(encoded, "alice", false);
  contains(encoded, traceId);
  contains(encoded, "Handled tool failed");
  const eventItems = envelopes.flatMap(envelope => envelope[1]);
  const errors = eventItems.filter(item => item[0].type === "event");
  assert.equal(errors.length, 2);
  const unavailable = new SimulatorUnavailableError("Expected stopped simulator");
  captureServerError(unavailable, "expected");
  await Sentry.flush();
  const afterItems = envelopes.flatMap(envelope => envelope[1]);
  const afterErrors = afterItems.filter(item => item[0].type === "event");
  assert.equal(afterErrors.length, 2);
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
