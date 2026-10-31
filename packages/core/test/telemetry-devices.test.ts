import test from "node:test";
import assert from "node:assert/strict";
import * as Sentry from "@sentry/node";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OpenAIFormResult } from "@openai/mcp-extensions/server";
import { scrubErrorEvent, scrubMetric, scrubSpan } from "@mobile-dev/shared/telemetry.ts";
import { ExpectedOperationError } from "@mobile-dev/shared/error-reporting.ts";
import type { PhysicalIosDevice } from "@mobile-dev/shared/ios-devices.ts";
import { installTracePropagation, instrumentMcpServer } from "../src/telemetry.ts";
import { registerDeviceAppsTool } from "../src/device-apps/tools.ts";
import { registerDeviceChoiceTools } from "../src/device-choice-tools.ts";
import { listIosDevices, registerIosDeviceTools } from "../src/ios-devices.ts";
import { createPhysicalIosBezelReader } from "../src/physical-ios-bezel.ts";
import { registerIosMirrorTools } from "../src/ios-mirror-tools.ts";
import { IosMirrorSessions } from "../src/ios-mirror.ts";
import { agentDeviceClient } from "@mobile-dev/test-support/agent-device-fixtures.ts";
import { assertFragment, captureSentry } from "@mobile-dev/test-support/sentry.ts";
import { connectClient } from "@mobile-dev/test-support/mcp.ts";

test("agent-device tools continue traces and report failures without native tool payloads", async t => {
  const sentry = captureSentry(t, { tracesSampler: context => context.inheritOrSampleWith(1), beforeSend: scrubErrorEvent, beforeSendSpan: scrubSpan });
  let observedTrace: string | undefined;
  let calls = 0;
  const { client } = await agentDeviceClient(t, async () => {
    calls++;
    const span = Sentry.getActiveSpan();
    observedTrace = span?.spanContext().traceId;
    if (calls === 2) throw new Error("PRIVATE_NATIVE_ERROR with PRIVATE_NATIVE_ARGUMENT");
    if (calls > 2) return { isError: true, content: [], structuredContent: { code: "DEVICE_NOT_FOUND", message: "PRIVATE_STOPPED_DEVICE" } };
    return { isError: true, content: [{ type: "text", text: "PRIVATE_NATIVE_RESULT" }] };
  });
  const traceId = "1234567890abcdef1234567890abcdef";
  await client.callTool({ name: "device_type", arguments: { session: "PRIVATE_SESSION", text: "PRIVATE_NATIVE_ARGUMENT" }, _meta: {
    "sentry-trace": `${traceId}-1234567890abcdef-1`,
  } });
  assert.equal(observedTrace, traceId);
  await client.callTool({ name: "device_type", arguments: { session: "PRIVATE_SESSION", text: "PRIVATE_NATIVE_ARGUMENT" } });
  const encoded = await sentry.text();
  assertFragment(encoded, "PRIVATE_", false);
  assertFragment(encoded, traceId);
  assertFragment(encoded, "Agent Device command failed.");
  assertFragment(encoded, "Agent Device tool transport failed.");
  const errors = await sentry.events();
  await client.callTool({ name: "device_type", arguments: { session: "PRIVATE_SESSION", text: "PRIVATE_NATIVE_ARGUMENT" } });
  const afterErrors = await sentry.events();
  assert.equal(afterErrors.length, errors.length, "Expected unavailable devices must not produce Sentry issues");
});

test("native device picker measures preparation and outcomes without private form content", async t => {
  const sentry = captureSentry(t, { beforeSend: scrubErrorEvent, beforeSendMetric: scrubMetric });
  const server = new McpServer({ name: "picker-telemetry", version: "1" });
  let answer: OpenAIFormResult = { action: "accept", content: { device: "device-1" } };
  registerDeviceChoiceTools(server, { async elicitInput() { return answer; } }, {
    async simulators() { throw new Error("PRIVATE unrelated discovery"); },
    async physicalIos() { throw new Error("PRIVATE unrelated discovery"); },
    async android() { return { connected: true, managed: false, baseUrl: "", devices: [
      { udid: "PRIVATE_SERIAL", name: "PRIVATE_DEVICE_NAME", runtime: "Android", state: "Booted", platform: "android", kind: "physical" },
    ] }; },
  }, "openai");
  const client = await connectClient(t, server, { name: "picker-host", capabilities: { extensions: { "openai/elicitation": { form: {} } } } });
  const arguments_ = { selectionMode: "single", message: "PRIVATE_QUESTION", context: "PRIVATE_OPERATION", devices: [
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
  const encoded = await sentry.text();
  assertFragment(encoded, "device_picker.prepare");
  assertFragment(encoded, "device_picker.result");
  assertFragment(encoded, "device_picker.selected");
  assertFragment(encoded, "PRIVATE", false);
  assertFragment(encoded, "device-1", false);
  assertFragment(encoded, "selection_mode");
  assertFragment(encoded, "openai");
  assertFragment(encoded, "millisecond");
  const errors = await sentry.events();
  assert.equal(errors.length, 0, "Expected stale/invalid device responses do not produce issues.");
});

test("physical iOS discovery accepts an unreported transport and reports malformed responses once without device values", async t => {
  const sentry = captureSentry(t, { beforeSend: scrubErrorEvent, beforeSendMetric: scrubMetric });
  const source = {
    identifier: "11111111-1111-4111-8111-111111111111",
    properties: {
      hardware: { udid: "PRIVATE_DEVICE", marketingName: "iPhone", productType: "iPhone18,1", reality: "physical", platform: "iOS" },
      state: { name: "PRIVATE_DEVICE_NAME" }, software: { osVersionNumber: { stringValue: "27.0.1" } },
      connection: { state: "unavailable", pairingState: "paired" },
    },
  };
  const payload = { info: { jsonVersion: 5, outcome: "success" }, result: { devices: [source] } };
  const server = new McpServer({ name: "ios-discovery-telemetry", version: "1" });
  instrumentMcpServer(server);
  registerIosDeviceTools(server, async () => {
    const stdout = JSON.stringify(payload);
    const run = async () => ({ stdout });
    return listIosDevices(undefined, run);
  });
  const client = await connectClient(t, server, { prepare: installTracePropagation });
  const request = { name: "mobile_list_ios_devices", arguments: {} };
  const unavailable = await client.callTool(request);
  assert.equal(unavailable.isError, undefined);
  const beforeEvents = await sentry.events();
  assert.equal(beforeEvents.length, 0);

  Reflect.deleteProperty(source.properties.state, "name");
  const malformed = await client.callTool(request);
  assert.equal(malformed.isError, true);
  const repeated = await client.callTool(request);
  assert.equal(repeated.isError, true);
  const afterEvents = await sentry.events();
  assert.equal(afterEvents.length, 1);
  const encoded = await sentry.text();
  assertFragment(encoded, "ios.devices.discovery");
  assertFragment(encoded, "server.error.repeated");
  assertFragment(encoded, "PRIVATE", false);
  assertFragment(encoded, source.identifier, false);

  source.properties.state.name = "PRIVATE_DEVICE_NAME";
  await client.callTool(request);
  Reflect.deleteProperty(source.properties.state, "name");
  await client.callTool(request);
  const recoveredEvents = await sentry.events();
  assert.equal(recoveredEvents.length, 2);
});

test("discovery reports the first failure per episode and counts repeated and expected outcomes", async t => {
  const sentry = captureSentry(t, { beforeSend: scrubErrorEvent, beforeSendMetric: scrubMetric });
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
  const client = await connectClient(t, server, { prepare: installTracePropagation });
  const request = { name: "mobile_performance_sources", arguments: { platform: "android", deviceId: "PRIVATE_DEVICE" } };
  for (const next of ["timeout", "timeout", "different", "ready", "timeout", "offline"]) {
    outcome = next;
    await client.callTool(request);
  }
  const events = await sentry.events();
  assert.equal(events.length, 3);
  const encoded = await sentry.text();
  assertFragment(encoded, "server.error.repeated");
  assertFragment(encoded, "server.error.outcome");
  assertFragment(encoded, "device_unavailable");
  assertFragment(encoded, "PRIVATE_DEVICE", false);
  const capturedEvents = JSON.stringify(events);
  assertFragment(capturedEvents, "Device offline", false);
});

test("physical iOS frames accept profiles without represented models, report a failed render once across reconnects, and count a missing model as expected", async t => {
  const sentry = captureSentry(t, { beforeSend: scrubErrorEvent, beforeSendMetric: scrubMetric });
  const phone: PhysicalIosDevice = {
    udid: "00008150-0000111122223333", coreDeviceId: "11111111-1111-4111-8111-111111111111", name: "PRIVATE_DEVICE_NAME", model: "iPhone 17 Pro",
    productType: "iPhone18,1", state: "connected", runtime: "iOS 27.0", platform: "ios", kind: "physical", transportType: "wired", pairingState: "paired",
  };
  const unknownPhone: PhysicalIosDevice = { ...phone, udid: "00008150-0000444455556666", productType: "iPhone99,1" };
  const renders: string[] = [];
  const readBezel = createPhysicalIosBezelReader(async (file, args) => {
    const output = (value: unknown) => ({ stdout: Buffer.from(JSON.stringify(value)) });
    if (file === "/usr/bin/xcrun") return output({ devicetypes: [{ name: "iPhone 17 Pro", modelIdentifier: "iPhone18,1", bundlePath: "/PRIVATE_XCODE/iPhone 17 Pro.simdevicetype" }] });
    // Older profiles omit representedModelIdentifiers.
    if (file === "/usr/bin/plutil") return output({});
    renders.push(args[1]);
    throw new Error("Device frame layout failed");
  }, async () => ({ executable: "Baguette", env: {} }));
  const sessions = new IosMirrorSessions(async () => ({
    async read() { return { generation: 1, sequence: 1, dropped: 0, frames: [] }; }, async touch() {}, async reset() {}, async close() {},
  }));
  const server = new McpServer({ name: "bezel-reporting-test", version: "1" });
  instrumentMcpServer(server);
  const close = registerIosMirrorTools(server, "ui://test/app", sessions, async () => [phone, unknownPhone], readBezel);
  t.after(() => close());
  const client = await connectClient(t, server, { prepare: installTracePropagation });
  for (let reconnect = 0; reconnect < 3; reconnect++) {
    const opened = await client.callTool({ name: "mobile_ios_mirror_session", arguments: { udid: phone.udid } });
    assert.equal(opened.isError, undefined);
    assert.equal(opened._meta?.bezel, undefined);
  }
  assert.deepEqual(renders, ["layout"]);
  const unframed = await client.callTool({ name: "mobile_ios_mirror_session", arguments: { udid: unknownPhone.udid } });
  assert.equal(unframed.isError, undefined);
  assert.equal(unframed._meta?.bezel, undefined);
  const events = await sentry.events();
  assert.equal(events.length, 1);
  const encoded = await sentry.text();
  assertFragment(encoded, "ios-mirror.bezel");
  assertFragment(encoded, '"outcome":{"value":"unsupported_platform"');
  assertFragment(encoded, "Xcode has no Apple device frame", false);
  assertFragment(encoded, "Device frame layout failed");
  assertFragment(encoded, "representedModelIdentifiers", false);
  assertFragment(encoded, "PRIVATE", false);
});
