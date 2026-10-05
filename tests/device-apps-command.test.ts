import test from "node:test";
import assert from "node:assert/strict";
import * as Sentry from "@sentry/node";
import type { Envelope } from "@sentry/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { runDiscoveryCommand, annotateDiscoveryCommand } from "../src/server/device-apps/command.ts";
import type { DiscoveryCommand, DiscoveryCause } from "../src/shared/device-apps-command-diagnostics.ts";
import { getDiscoveryCommandDiagnostic } from "../src/shared/device-apps-command-diagnostics.ts";
import { deviceAppsDiagnostic, annotateDeviceAppsError, DEVICE_APPS_DIAGNOSTIC_META } from "../src/shared/device-apps-diagnostics.ts";
import { expectedOutcome } from "../src/shared/error-reporting.ts";
import { scrubErrorEvent } from "../src/shared/telemetry.ts";
import { registerDeviceAppsTool } from "../src/server/device-apps/tools.ts";

const options: { encoding: "utf8"; timeout: number; maxBuffer: number } = { encoding: "utf8", timeout: 3000, maxBuffer: 4096 };

async function commandFailure(source: string, settings = options) {
  try {
    await runDiscoveryCommand("ios_physical_foreground", process.execPath, ["-e", source], settings);
    assert.fail("Expected the child command to fail");
  } catch (error) {
    assert.ok(error instanceof Error);
    return error;
  }
}

test("real child exits retain only validated helper causes and numeric command measurements", async () => {
  const source = 'console.error(\'mobile-dev-foreground-error:{"version":1,"cause":"query_timeout"}\'); console.error("PRIVATE_DEVICE PRIVATE_OUTPUT"); process.exit(1)';
  const error = await commandFailure(source);
  const diagnostic = getDiscoveryCommandDiagnostic(error);
  assert.ok(diagnostic);
  assert.equal(diagnostic.command, "ios_physical_foreground");
  assert.equal(diagnostic.cause, "query_timeout");
  assert.equal(diagnostic.termination, "exit");
  assert.equal(diagnostic.exit_status, 1);
  assert.ok(diagnostic.elapsed_ms >= 0);
  assert.equal(diagnostic.deadline_ms, 3000);
  const stage = deviceAppsDiagnostic(error, "foreground", "ios", "physical");
  assert.equal(stage.failure, "timeout");
  const encoded = JSON.stringify(diagnostic);
  const includesPrivate = encoded.includes("PRIVATE");
  assert.equal(includesPrivate, false);
  for (const payload of ['{"version":1,"cause":"PRIVATE_OUTPUT"}', '{"version":1,"cause":"query_timeout","command":"PRIVATE_COMMAND"}', '{"version":2,"cause":"query_timeout"}', '{malformed']) {
    const text = JSON.stringify(`mobile-dev-foreground-error:${payload}`);
    const source = `console.error(${text}); process.exit(1)`;
    const invalid = await commandFailure(source);
    const rejected = getDiscoveryCommandDiagnostic(invalid);
    assert.equal(rejected?.cause, "command_failed");
  }
});

test("real deadlines, cancellation, output limits, missing files, and signals stay distinct", async () => {
  const timeout = await commandFailure('setTimeout(() => {}, 10000)', { ...options, timeout: 100 });
  const deadline = getDiscoveryCommandDiagnostic(timeout);
  assert.equal(deadline?.termination, "deadline");
  assert.equal(deadline?.cause, "deadline_exceeded");
  const timeoutOutcome = expectedOutcome(timeout);
  assert.equal(timeoutOutcome, undefined);
  const output = await commandFailure('console.log("x".repeat(10000))', { ...options, maxBuffer: 16 });
  const limit = getDiscoveryCommandDiagnostic(output);
  assert.equal(limit?.termination, "output_limit");
  const outputStage = deviceAppsDiagnostic(output, "foreground", "ios");
  assert.equal(outputStage.failure, "command_failed");
  const signalled = await commandFailure('process.kill(process.pid, "SIGTERM")');
  const signal = getDiscoveryCommandDiagnostic(signalled);
  assert.equal(signal?.termination, "signal");
  assert.equal(signal?.signal, "SIGTERM");
  const controller = new AbortController();
  controller.abort();
  try { await runDiscoveryCommand("ios_simulator_apps", process.execPath, ["-e", ""], { ...options, signal: controller.signal }); }
  catch (error) {
    const cancelled = getDiscoveryCommandDiagnostic(error);
    assert.equal(cancelled?.termination, "cancelled");
    const outcome = expectedOutcome(error);
    assert.equal(outcome, "cancelled");
  }
  try { await runDiscoveryCommand("ios_simulator_apps", "/PRIVATE_MISSING_EXECUTABLE", [], options); }
  catch (error) {
    const missing = getDiscoveryCommandDiagnostic(error);
    assert.equal(missing?.termination, "spawn_error");
    assert.equal(missing?.cause, "missing_executable");
  }
  const timedOut = AbortSignal.timeout(1);
  await new Promise(resolve => setTimeout(resolve, 10));
  try { await runDiscoveryCommand("ios_simulator_apps", process.execPath, ["-e", ""], { ...options, signal: timedOut }); }
  catch (error) {
    const expired = getDiscoveryCommandDiagnostic(error);
    assert.equal(expired?.termination, "deadline");
    const outcome = expectedOutcome(error);
    assert.equal(outcome, undefined);
  }
});

test("known lifecycle output and unknown signals never forward raw command content", () => {
  const cases: { command: DiscoveryCommand; stderr: string; cause: DiscoveryCause }[] = [
    { command: "ios_simulator_apps", stderr: "Unable to spawn process because device is not booted.", cause: "device_not_booted" },
    { command: "android_processes", stderr: "error: device offline PRIVATE_DEVICE", cause: "device_offline" },
    { command: "android_foreground_activity", stderr: "error: device unauthorized PRIVATE_DEVICE", cause: "device_unauthorized" },
    { command: "android_packages", stderr: "error: device 'PRIVATE_DEVICE' not found", cause: "device_not_found" },
  ];
  for (const entry of cases) {
    const original = new Error("Command failed: PRIVATE_COMMAND");
    Object.assign(original, { code: 1, stderr: entry.stderr });
    const annotated = annotateDiscoveryCommand(original, entry.command, 10, options);
    assert.equal(annotated, original);
    const diagnostic = getDiscoveryCommandDiagnostic(annotated);
    assert.equal(diagnostic?.cause, entry.cause);
    const encoded = JSON.stringify(diagnostic);
    const includesPrivate = encoded.includes("PRIVATE");
    assert.equal(includesPrivate, false);
  }
  const original = new Error("PRIVATE");
  Object.assign(original, { signal: "PRIVATE_SIGNAL" });
  annotateDiscoveryCommand(original, "ios_simulator_foreground", 10, options);
  const diagnostic = getDiscoveryCommandDiagnostic(original);
  assert.equal(diagnostic?.signal, "other");
});

test("MCP error episodes distinguish helper causes and Sentry retains safe diagnostics after scrubbing", async t => {
  const envelopes: Envelope[] = [];
  Sentry.init({ dsn: "https://public@example.com/1", environment: "release", defaultIntegrations: false, beforeSend: scrubErrorEvent,
    transport: () => ({ async send(envelope) { envelopes.push(envelope); return { statusCode: 200 }; }, async flush() { return true; } }),
  });
  const server = new McpServer({ name: "command-diagnostic-test", version: "1" });
  let cause = "query_timeout";
  registerDeviceAppsTool(server, async () => {
    const payload = JSON.stringify({ version: 1, cause });
    const text = JSON.stringify(`mobile-dev-foreground-error:${payload}`);
    const source = `console.error(${text}); console.error("PRIVATE_OUTPUT"); process.exit(1)`;
    const error = await commandFailure(source);
    const annotated = annotateDeviceAppsError(error, "foreground", "ios", "physical");
    throw annotated;
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "command-diagnostic-client", version: "1" });
  t.after(async () => { await client.close(); await server.close(); await Sentry.close(); });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const request = { name: "mobile_performance_sources", arguments: { deviceId: "PRIVATE_DEVICE", kind: "physical" } };
  const result = await client.callTool(request);
  assert.deepEqual(result._meta?.[DEVICE_APPS_DIAGNOSTIC_META], { stage: "foreground", failure: "timeout", platform: "ios", kind: "physical" });
  await client.callTool(request);
  cause = "cleanup_timeout";
  await client.callTool(request);
  await Sentry.flush(2000);
  const items = envelopes.flatMap(envelope => envelope[1]);
  const events = items.filter(item => item[0].type === "event");
  assert.equal(events.length, 2);
  for (const item of events) {
    const event = item[1];
    assert.ok(event && typeof event === "object" && "tags" in event && "contexts" in event);
    assert.equal(event.environment, "release");
    assert.equal(event.tags?.discovery_command, "ios_physical_foreground");
    assert.equal(event.tags?.discovery_termination, "exit");
    assert.equal(event.contexts?.device_apps_command?.exit_status, 1);
    assert.equal(event.contexts?.device_apps_command?.deadline_ms, 3000);
    assert.equal(typeof event.contexts?.device_apps_command?.elapsed_ms, "number");
    const cause = String(event.tags?.discovery_cause);
    const grouped = event.fingerprint?.includes(cause);
    assert.ok(grouped);
    assert.equal(event.contexts?.node_system_error, undefined);
  }
  const encoded = JSON.stringify(envelopes);
  const includesPrivate = encoded.includes("PRIVATE");
  assert.equal(includesPrivate, false);
});
