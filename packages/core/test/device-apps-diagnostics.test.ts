import test from "node:test";
import assert from "node:assert/strict";
import * as Sentry from "@sentry/node";
import type { Envelope } from "@sentry/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { annotateDeviceAppsError, getDeviceAppsDiagnostic, DEVICE_APPS_DIAGNOSTIC_META } from "@mobile-dev/shared/device-apps-diagnostics.ts";
import { readDeviceApps } from "../src/device-apps/sources.ts";
import { registerDeviceAppsTool } from "../src/device-apps/tools.ts";
import { registerCpuTools } from "../src/cpu/tools.ts";
import { DeviceResolver } from "../src/devices.ts";
import { CpuSessions } from "../src/cpu/sessions.ts";
import { attachedBaguette } from "@mobile-dev/test-support/fixtures.ts";
import { SimulatorUnavailableError } from "../src/simulator-unavailable.ts";
import { scrubErrorEvent } from "@mobile-dev/shared/telemetry.ts";

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
  const baguette = attachedBaguette("http://127.0.0.1:1");
  registerCpuTools(server, cpu, new DeviceResolver({ simulators: baguette, android: async () => [], ios: async () => [] }),
    { apps: async () => { throw new Error("should not discover"); } });
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
