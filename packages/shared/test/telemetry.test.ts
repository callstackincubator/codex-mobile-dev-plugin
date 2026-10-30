import test from "node:test";
import assert from "node:assert/strict";
import * as Sentry from "@sentry/node";
import { MeasurementWindow, sampleTrace, scrubErrorEvent, scrubSpan, sampleMetric, createErrorEventFilter, METRIC_SAMPLE_RATE } from "../src/telemetry.ts";
import { ExpectedOperationError } from "../src/error-reporting.ts";
import { setDiscoveryCommandDiagnostic } from "../src/device-apps-command-diagnostics.ts";
import { assertFragment, captureSentry } from "@mobile-dev/test-support/sentry.ts";

test("production metric sampling drops 99.5% before transport and preserves sample values and privacy", async t => {
  let sequence = 0;
  t.mock.method(Math, "random", () => (sequence++ % 200) / 200);
  const sentry = captureSentry(t, { beforeSendMetric: sampleMetric });
  Sentry.setUser({ id: "anon_0123456789abcdef0123456789abcdef" });
  for (let index = 0; index < 20_000; index++) {
    Sentry.metrics.gauge("sampling.test", index, { attributes: { surface: "logs", telemetry_session: "PRIVATE_SESSION" } });
  }
  const retained = await sentry.metrics();
  assert.equal(retained.length, 100);
  for (const [index, metric] of retained.entries()) {
    assert.equal(metric.value, retained[0].value + index * 200);
    assert.equal(metric.attributes["telemetry.sample_rate"].value, METRIC_SAMPLE_RATE);
    assert.equal(metric.attributes.surface.value, "logs");
    assert.equal(metric.attributes["user.id"], undefined);
    assert.equal(metric.attributes.telemetry_session, undefined);
  }
});

test("production error policy samples handled failures, bounds storms and retains new unhandled failures", t => {
  let now = 1000;
  t.mock.method(Date, "now", () => now);
  const filter = createErrorEventFilter();
  const hint = { originalException: new Error("Unexpected failure") };
  const event = (name: string, handled = true) => ({
    tags: { operation: name },
    exception: { values: [{ type: "Error", value: name, mechanism: { type: "generic", handled } }] },
  });
  const originalRandom = Math.random;
  let random = 0.5;
  Math.random = () => random;
  try {
    const discarded = filter(event("sampled"), hint);
    assert.equal(discarded, null);
    random = 0;
    const first = filter(event("sampled"), hint);
    const repeated = filter(event("sampled"), hint);
    assert.ok(first);
    assert.equal(repeated, null);
    for (let index = 0; index < 19; index++) {
      const accepted = filter(event(`different.${index}`), hint);
      assert.ok(accepted);
    }
    const capped = filter(event("over-budget"), hint);
    assert.equal(capped, null);
    random = 0.99;
    const unhandled = filter(event("unhandled", false), hint);
    assert.ok(unhandled);
    const duplicateUnhandled = filter(event("unhandled", false), hint);
    assert.equal(duplicateUnhandled, null);
    const expected = new ExpectedOperationError("device_unavailable", "No connected device");
    const excluded = filter(event("expected", false), { originalException: expected });
    assert.equal(excluded, null);
    now += 3_600_000;
    random = 0;
    const nextWindow = filter(event("sampled"), hint);
    assert.ok(nextWindow, "The next hourly window permits a fresh report.");
  } finally {
    Math.random = originalRandom;
  }
});

test("expected host lifecycle and discovery conditions do not become Sentry errors", () => {
  for (const cause of ["device_not_found", "device_not_booted", "device_offline", "device_unauthorized", "foreground_unavailable", "unsupported_service"] as const) {
    const error = new Error("Synthetic command failure");
    setDiscoveryCommandDiagnostic(error, { command: "ios_simulator_apps", cause, termination: "exit", elapsed_ms: 10, deadline_ms: 1000 });
    const filtered = scrubErrorEvent({}, { originalException: error });
    assert.equal(filtered, null, cause);
  }
  for (const message of ["MCP error -32600: thread not found: SYNTHETIC_THREAD", "MCP error -32000: CancelledError"]) {
    const error = new Error(message);
    const filtered = scrubErrorEvent({}, { originalException: error });
    assert.equal(filtered, null);
  }
  const deadline = new Error("Synthetic command timeout");
  setDiscoveryCommandDiagnostic(deadline, { command: "ios_simulator_apps", cause: "deadline_exceeded", termination: "deadline", elapsed_ms: 1000, deadline_ms: 1000 });
  const retained = scrubErrorEvent({}, { originalException: deadline });
  assert.ok(retained);
  const missingHelper = new Error("Synthetic bundled helper is missing");
  setDiscoveryCommandDiagnostic(missingHelper, { command: "ios_simulator_foreground", cause: "missing_executable", termination: "spawn_error", elapsed_ms: 1, deadline_ms: 1000 });
  const actionable = scrubErrorEvent({}, { originalException: missingHelper });
  assert.ok(actionable);
});

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
  for (const name of ["resources/read frame://private-session", "notifications/tools/list_changed", "tools/call mobile_stream_input", "tools/call mobile_ios_mirror_input", "tools/call mobile_read_cpu", "tools/call device_devices", "tools/call device_session", "tools/call device_events"]) {
    const rate = sampleTrace(name, inherit);
    assert.equal(rate, 0);
  }
  assert.equal(inherited, 0);
  const rate = sampleTrace("tools/call mobile_cpu_session", inherit);
  assert.equal(rate, 0.1);
  assert.equal(sampleTrace("tools/call device_press", inherit), 0.1);
  const screenshotRate = sampleTrace("tools/call mobile_ios_mirror_capture_screenshot", inherit);
  assert.equal(screenshotRate, 0.1);
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
  assertFragment(encoded, "private", false);
  assertFragment(encoded, "alice", false);
  assertFragment(encoded, "SECRET", false);
  assert.equal(filtered.exception?.values?.[0].value, "Child process command failed");
  assert.equal(filtered.exception?.values?.[0].stacktrace?.frames?.[0].filename, "app:///mobile-dev-ui.js");
  const span = scrubSpan({
    trace_id: traceId, span_id: spanId, name: "resources/read frame://private-session", start_timestamp: 1, timestamp: 2,
    attributes: { "mcp.request.argument.secret": "private", "mcp.response.content": "private", "mcp.resource.uri": "private", "error.message": "private", surface: "logs" },
  });
  assert.equal(span.name, "resources/read");
  assert.deepEqual(span.attributes, { surface: "logs" });
});
