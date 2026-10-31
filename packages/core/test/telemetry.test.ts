import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import * as Sentry from "@sentry/node";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { sampleTrace, scrubErrorEvent, scrubMetric, scrubSpan, TELEMETRY_META_KEY } from "@mobile-dev/shared/telemetry.ts";
import { deferEpisodeReport, ExpectedOperationError, FailureEpisodes } from "@mobile-dev/shared/error-reporting.ts";
import { captureServerError, installTracePropagation, instrumentMcpServer, setLaunchingTelemetryHost, setServerTelemetryHost } from "../src/telemetry.ts";
import { parseResourceInput } from "../src/resource-input.ts";
import { PHONE_ICONS, toolIcons } from "../src/tool-icons.ts";
import { SimulatorUnavailableError } from "../src/simulator-unavailable.ts";
import { assertFragment, captureSentry } from "@mobile-dev/test-support/sentry.ts";
import { connectClient } from "@mobile-dev/test-support/mcp.ts";

test("the bundled HTTP dispatcher preserves Sentry fetch tracing and privacy", async t => {
  const receivedTraceHeaders: string[] = [];
  const server = createServer((request, response) => {
    const header = request.headers["sentry-trace"];
    if (typeof header === "string") receivedTraceHeaders.push(header);
    response.end("ok");
  });
  server.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => { server.once("listening", resolve); });
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}/PRIVATE_PATH?token=PRIVATE_TOKEN`;
  const sentry = captureSentry(t, {
    environment: "release", integrations: [Sentry.nativeNodeFetchIntegration()], tracesSampleRate: 1,
    beforeSend: scrubErrorEvent, beforeSendSpan: scrubSpan, beforeBreadcrumb: () => null,
  });
  const spanOptions = { name: "http.runtime.test", attributes: { component: "server", surface: "simulator" } };
  await Sentry.startSpan(spanOptions, async () => {
    const response = await fetch(url);
    const text = await response.text();
    assert.equal(text, "ok");
  });
  await sentry.flush();
  assert.equal(receivedTraceHeaders.length, 1);
  assert.match(receivedTraceHeaders[0], /^[a-f0-9]{32}-[a-f0-9]{16}-1$/);
  const encoded = JSON.stringify(sentry.sent("span"));
  assertFragment(encoded, "http.runtime.test");
  assertFragment(encoded, "auto.http.node_fetch");
  assertFragment(encoded, "PRIVATE", false);
  assertFragment(encoded, "simulator");
  assertFragment(encoded, "server");
});

test("Node system error integration cannot send command arguments or output", async t => {
  const sentry = captureSentry(t, { integrations: [Sentry.systemErrorIntegration()], beforeSend: scrubErrorEvent });
  const error = new Error("Command failed: PRIVATE_COMMAND PRIVATE_ARGUMENT");
  Object.assign(error, {
    errno: -2, code: "ENOENT", path: "/Users/private/helper", dest: "/Users/private/output",
    cmd: "PRIVATE_COMMAND PRIVATE_ARGUMENT", spawnargs: ["PRIVATE_DEVICE", "PRIVATE_TOKEN"],
    syscall: "spawn PRIVATE_COMMAND", stdout: "PRIVATE_APP_OUTPUT", stderr: "PRIVATE_ERROR_OUTPUT",
  });
  Sentry.captureException(error);
  const encoded = await sentry.text();
  assertFragment(encoded, "Child process command failed");
  assertFragment(encoded, "node_system_error", false);
  assertFragment(encoded, "PRIVATE_", false);
  assertFragment(encoded, "/Users/private", false);
});

test("UI trace context crosses the MCP bridge and handled server errors exclude tool payloads", async t => {
  const sentry = captureSentry(t, { tracesSampler: context => context.inheritOrSampleWith(1), beforeSend: scrubErrorEvent, beforeSendSpan: scrubSpan });
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
  const client = await connectClient(t, server, { name: "test-client", prepare: installTracePropagation });
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
  // TraceSift is its own workspace surface; its attribution must survive the metadata allowlist.
  await client.callTool({ name: "test_action", arguments: { secret: "PRIVATE_PROFILE_PATH" }, _meta: {
    [TELEMETRY_META_KEY]: { surface: "tracesift", view: "tracesift", profilePath: "PRIVATE_PROFILE_PATH" },
  } });
  assert.equal(observedTags?.surface, "tracesift");
  assert.equal(observedTags?.view, "tracesift");
  assert.equal(observedTags?.profilePath, undefined);
  // Every host shares this server, so a known host value survives the allowlist; anything else is dropped.
  await client.callTool({ name: "test_action", arguments: { secret: "PRIVATE_HOST_ARGUMENT" }, _meta: {
    [TELEMETRY_META_KEY]: { surface: "logs", view: "workspace", host: "claude" },
  } });
  assert.equal(observedTags?.host, "claude");
  await client.callTool({ name: "test_action", arguments: { secret: "PRIVATE_HOST_ARGUMENT" }, _meta: {
    [TELEMETRY_META_KEY]: { surface: "logs", view: "workspace", host: "PRIVATE_HOST" },
  } });
  assert.equal(observedTags?.host, undefined);
  const encoded = await sentry.text();
  assertFragment(encoded, "PRIVATE_", false);
  assertFragment(encoded, "alice", false);
  assertFragment(encoded, traceId);
  assertFragment(encoded, "Handled tool failed");
  // One handled failure per tool call above: logs, recording, comparison, TraceSift and two host checks.
  assert.equal((await sentry.events()).length, 6);
  const unavailable = new SimulatorUnavailableError("Expected stopped simulator");
  captureServerError(unavailable, "expected");
  assert.equal((await sentry.events()).length, 6);
});

test("error filters retain only generated identity while metrics and spans omit user dimensions", async t => {
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
  const sentry = captureSentry(t, {
    initialScope: { user: { id: userId }, tags: { telemetry_session: sessionId } },
    beforeSend: scrubErrorEvent, beforeSendMetric: scrubMetric,
  });
  const error = new Error("Anonymous identity test");
  captureServerError(error, "identity.test");
  Sentry.metrics.count("identity.test", 1, { attributes: { surface: "logs", telemetry_session: sessionId } });
  const errors = await sentry.events();
  assert.equal(errors.length, 1);
  const encodedError = JSON.stringify(errors[0]);
  assertFragment(encodedError, userId);
  assertFragment(encodedError, sessionId);
  const metrics = sentry.sent("trace_metric");
  assert.ok(metrics.length > 0);
  const encodedMetrics = JSON.stringify(metrics);
  assertFragment(encodedMetrics, userId, false);
  assertFragment(encodedMetrics, sessionId, false);
  const span = scrubSpan({ trace_id: "1".repeat(32), span_id: "2".repeat(16), name: "identity.test", start_timestamp: 1, timestamp: 2,
    attributes: { "user.id": userId, "user.email": "private@example.com", "session.id": sessionId, telemetry_session: sessionId, surface: "logs" } });
  assert.deepEqual(span.attributes, { surface: "logs" });
});

test("Node runtime metrics report CPU, memory and event-loop measurements with component labels", async t => {
  const runtimeMetrics = Sentry.nodeRuntimeMetricsIntegration({ collectionIntervalMs: 1000, collect: { memExternal: true } });
  const sentry = captureSentry(t, { integrations: [runtimeMetrics] });
  Sentry.setAttribute("component", "server");
  await new Promise(resolve => { setTimeout(resolve, 1100); });
  const encoded = await sentry.text();
  for (const name of ["node.runtime.cpu.utilization", "node.runtime.mem.rss", "node.runtime.mem.heap_used", "node.runtime.mem.external", "node.runtime.mem.array_buffers", "node.runtime.event_loop.delay.p99", "node.runtime.event_loop.utilization"]) {
    assertFragment(encoded, name);
  }
  assertFragment(encoded, '"component":{"value":"server"');
});

test("definition failure tags survive Sentry scrubbing with surface, release and anonymous attribution", async t => {
  const { parseDefinitionDiagnostic, setDefinitionDiagnostic } = await import("@mobile-dev/shared/simulator-definition-diagnostics.ts");
  const sentry = captureSentry(t, { beforeSend: scrubErrorEvent, environment: "release", release: "mobile-dev@definition-test" });
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
  const events = await sentry.events();
  assert.equal(events.length, 1);
  const encoded = JSON.stringify(events[0]);
  for (const expected of ["chrome_parse", "invalid", "iPhone 17", "simulator", "release", "mobile-dev@definition-test"]) assertFragment(encoded, expected);
  assertFragment(encoded, "PRIVATE_", false);
  assertFragment(encoded, "B5C969F6", false);
  assertFragment(encoded, userId);
});

test("MCP reporting retains original failures once and keeps unowned protocol and transport errors", async t => {
  const sentry = captureSentry(t, {
    environment: "release", beforeSend: scrubErrorEvent, beforeSendSpan: scrubSpan,
    tracesSampler: context => sampleTrace(context.name, context.inheritOrSampleWith),
    initialScope: { user: { id: "anon_0123456789abcdef0123456789abcdef" }, tags: { telemetry_session: "run_1234567890abcdef1234567890abcdef" } },
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
  let serverTransport!: Parameters<typeof installTracePropagation>[0];
  const client = await connectClient(t, server, { prepare: transport => { serverTransport = transport; installTracePropagation(transport); } });
  const reads = ["unexpected", "expiry", "unavailable", "input", "response", "primitive"].map(name => client.readResource({ uri: `logs://${name}` }));
  const results = await Promise.allSettled(reads);
  const rejected = results.every(result => result.status === "rejected");
  assert.equal(rejected, true);
  await client.callTool({ name: "guarded" });
  const events = await sentry.events();
  assert.equal(events.length, 4);
  const encoded = JSON.stringify(events);
  assertFragment(encoded, "Unexpected resource failure");
  assertFragment(encoded, "ZodError");
  assertFragment(encoded, "Guarded failure");
  assertFragment(encoded, "JsonRpcError", false);
  assertFragment(encoded, "session expired", false);
  assertFragment(encoded, "PRIVATE", false);
  assertFragment(encoded, '"environment":"release"');
  assertFragment(encoded, '"user":{"id":"anon_0123456789abcdef0123456789abcdef"}');
  assertFragment(encoded, '"operation":"resources.read"');
  const encodedSpans = JSON.stringify(sentry.sent("span"));
  assertFragment(encodedSpans, "resources/read", false);
  await serverTransport.send({ jsonrpc: "2.0", id: 123456, error: { code: -32603, message: "Unowned protocol failure" } });
  const transportFailure = new Error("Unexpected transport failure");
  serverTransport.onerror?.(transportFailure);
  const afterEvents = await sentry.events();
  assert.equal(afterEvents.length, 6);
  const after = JSON.stringify(afterEvents);
  assertFragment(after, "Unowned protocol failure");
  assertFragment(after, "Unexpected transport failure");
});

test("an episode's report goes to the first capture site that sends it, and repeats are only counted", async t => {
  const sentry = captureSentry(t, { beforeSend: scrubErrorEvent, beforeSendMetric: scrubMetric });
  const episodes = new FailureEpisodes();
  const failure = () => {
    const error = new Error("Cannot reach Baguette at http://127.0.0.1:1. Baguette returned HTTP 500 for /simulators.json.");
    deferEpisodeReport(error, () => episodes.shouldReport("start", error.message));
    return error;
  };
  // A cancelled caller and one that only logs the failure don't use up the episode's report.
  const controller = new AbortController();
  controller.abort();
  captureServerError(failure(), "simulator.tool", { signal: controller.signal });
  failure();
  const first = failure();
  captureServerError(first, "simulator.tool");
  // A caller that joined the same start shares its error.
  captureServerError(first, "simulator.tool");
  captureServerError(failure(), "simulator.tool");
  const events = await sentry.events();
  assert.equal(events.length, 1);
  const sent = await sentry.text();
  assertFragment(sent, "server.error.repeated");
  assertFragment(sent, '"outcome":{"value":"cancelled"');
});

test("resource teardown is classified before automatic SDK capture", async t => {
  const sentry = captureSentry(t, { beforeSend: scrubErrorEvent, beforeSendMetric: scrubMetric });
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
  const client = await connectClient(t, server, { prepare: installTracePropagation });
  const abort = new AbortController();
  const pending = client.readResource({ uri: "logs://cancel" }, { signal: abort.signal });
  const rejection = assert.rejects(pending);
  await opening;
  abort.abort();
  await rejection;
  await new Promise<void>(resolve => setImmediate(resolve));
  const events = await sentry.events();
  assert.equal(events.length, 0);
  const encoded = await sentry.text();
  assertFragment(encoded, "server.error.outcome");
  assertFragment(encoded, "cancelled");
  assertFragment(encoded, "Deliberate teardown", false);
});

test("request handler wrappers run inside the MCP error accounting, which patches the server once", async t => {
  const sentry = captureSentry(t, { telemetry: "on", beforeSendMetric: scrubMetric });
  const server = new McpServer({ name: "wrapped-handlers", version: "1" });
  const order: string[] = [];
  instrumentMcpServer(server, (_schema, handler) => async (request, extra) => { order.push("outer"); return handler(request, extra); },
    toolIcons({ listed: PHONE_ICONS }), (schema, handler) => schema === ListToolsRequestSchema ? async () => { order.push("inner"); throw new Error("Listing failed."); } : handler);
  server.registerTool("listed", { description: "A listed tool." }, async () => ({ content: [] }));
  const client = await connectClient(t, server, { prepare: installTracePropagation });
  await assert.rejects(client.listTools(), /Listing failed/);
  assert.deepEqual(order, ["outer", "inner"]);
  assertFragment(await sentry.text(), "mcp.request");
});

// Runs last: the launching host stays set for the rest of this process.
test("a host label the server entry passes outranks the connecting client's name", async t => {
  const sentry = captureSentry(t);
  const scope = () => Sentry.getIsolationScope().getScopeData();
  setServerTelemetryHost("Claude");
  assert.equal(scope().tags.host, "claude");
  setServerTelemetryHost("PRIVATE_HOST");
  assert.equal(scope().tags.host, "other");
  setLaunchingTelemetryHost("mac");
  assert.equal(scope().tags.host, "mac");
  assert.equal(scope().attributes?.host, "mac");
  setServerTelemetryHost("mobile-dev-mac");
  setServerTelemetryHost("Claude");
  assert.equal(scope().tags.host, "mac");
  assert.equal(scope().attributes?.host, "mac");
  Sentry.captureException(new Error("Launching host"));
  assert.equal((await sentry.events())[0]?.tags?.host, "mac");
});
