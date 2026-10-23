import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { listIosDevices, registerIosDeviceTools } from "../packages/core/src/ios-devices.ts";
import { physicalIosDeviceSchema, physicalConnectionLabel } from "../packages/shared/src/ios-devices.ts";

const coreDeviceId = "11111111-1111-4111-8111-111111111111";
const udid = "00008110-000A0B1C2D3E4000";

function device(transportType = "wired", connectionState = "connected") {
  return {
    identifier: coreDeviceId,
    properties: {
      hardware: { udid, marketingName: "iPhone 17 Pro", productType: "iPhone18,1", reality: "physical", platform: "iOS" },
      state: { name: "Test iPhone" }, software: { osVersionNumber: { components: [27, 0, 0, 0, 0], originalComponentsCount: 2, stringValue: "27.0" } },
      connection: { state: connectionState, transportType, pairingState: "paired" },
    },
  };
}

function response(devices: unknown[], jsonVersion = 5) {
  const payload = { info: { jsonVersion, outcome: "success" }, result: { devices } };
  return { stdout: JSON.stringify(payload) };
}

function unavailableDevice() {
  const source = device("wired", "unavailable");
  source.identifier = "22222222-2222-4222-8222-222222222222";
  source.properties.hardware.udid = "00008110-000A0B1C2D3E4001";
  Reflect.deleteProperty(source.properties.connection, "transportType");
  return source;
}

test("discovery preserves identity and reports USB, Wi-Fi, and disconnected state", async () => {
  for (const [transport, state] of [["wired", "connected"], ["localNetwork", "connected"], ["none", "disconnected"]]) {
    const source = device(transport, state);
    const payload = response([source]);
    const devices = await listIosDevices(undefined, async () => payload);
    assert.deepEqual(devices, [{ udid, coreDeviceId, name: "Test iPhone", model: "iPhone 17 Pro", productType: "iPhone18,1", state,
      runtime: "iOS 27.0", platform: "ios", kind: "physical", transportType: transport, pairingState: "paired" }]);
  }
});

test("an unavailable remembered iPhone without a transport does not block connected devices", async () => {
  const connected = device();
  const unavailable = unavailableDevice();
  const payload = response([connected, unavailable]);
  const devices = await listIosDevices(undefined, async () => payload);
  assert.equal(devices.length, 2);
  assert.equal(devices[0].udid, udid);
  assert.equal(devices[0].transportType, "wired");
  const remembered = devices[1];
  assert.equal(remembered.udid, unavailable.properties.hardware.udid);
  assert.equal(remembered.state, "unavailable");
  assert.equal(remembered.pairingState, "paired");
  assert.equal(remembered.transportType, undefined);
  const encoded = JSON.stringify(remembered);
  const serialized = JSON.parse(encoded);
  const transportReported = Object.hasOwn(serialized, "transportType");
  assert.equal(transportReported, false);
  const parsed = physicalIosDeviceSchema.safeParse(serialized);
  assert.equal(parsed.success, true);
});

test("transport labels distinguish an unreported transport from USB and Wi-Fi", () => {
  const missing = physicalConnectionLabel(undefined);
  const wired = physicalConnectionLabel("wired");
  const wireless = physicalConnectionLabel("localNetwork");
  assert.equal(missing, "Transport not reported");
  assert.equal(wired, "USB");
  assert.equal(wireless, "Wi-Fi");
});

test("discovery uses bounded devicectl JSON output and requests only physical iOS devices", async () => {
  const devices = await listIosDevices(undefined, async (file, args, options) => {
    assert.equal(file, "/usr/bin/xcrun");
    assert.deepEqual(args, ["devicectl", "list", "devices", "--quiet", "--timeout", "10", "--omit-deprecated-fields-in-json",
      "--filter", "properties.hardware.reality = 'physical' AND properties.hardware.platform = 'iOS'", "--json-output", "-"]);
    assert.equal(options.encoding, "utf8");
    assert.equal(options.timeout, 15000);
    assert.equal(options.maxBuffer, 4 * 1024 * 1024);
    return response([]);
  });
  assert.deepEqual(devices, []);
});

test("discovery exposes command failures and rejects unsupported or malformed output", async () => {
  const failure = new Error("xcrun: unable to find utility devicectl");
  const failed = listIosDevices(undefined, async () => { throw failure; });
  await assert.rejects(failed, failure);
  const old = response([], 3);
  const unsupported = listIosDevices(undefined, async () => old);
  await assert.rejects(unsupported, /requires Xcode 27/);
  const missingName = device();
  Reflect.deleteProperty(missingName.properties.state, "name");
  const malformed = response([missingName]);
  const invalid = listIosDevices(undefined, async () => malformed);
  await assert.rejects(invalid, error => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /unsupported device discovery JSON/);
    assert.match(error.message, /result\.devices\[0\]\.properties\.state\.name/);
    assert.doesNotMatch(error.message, /requires Xcode/);
    return true;
  });
  const invalidTransport = device();
  Reflect.set(invalidTransport.properties.connection, "transportType", 42);
  const invalidTransportPayload = response([invalidTransport]);
  const rejectedTransport = listIosDevices(undefined, async () => invalidTransportPayload);
  await assert.rejects(rejectedTransport, /properties\.connection\.transportType/);
  const invalidJson = listIosDevices(undefined, async () => ({ stdout: "PRIVATE_DEVICE_OUTPUT" }));
  await assert.rejects(invalidJson, { name: "SyntaxError", message: "devicectl returned invalid device discovery JSON." });
});

test("discovery cancels its pending command and rejects an already cancelled request", { timeout: 2000 }, async t => {
  const controller = new AbortController();
  t.after(() => controller.abort());
  let spawned!: () => void;
  const ready = new Promise<void>(resolve => { spawned = resolve; });
  let closed = Promise.resolve();
  const request = listIosDevices(controller.signal, async (_file, _args, options) => {
    assert.equal(options.signal, controller.signal);
    return await new Promise<{ stdout: string }>((resolve, reject) => {
      const child = execFile(process.execPath, ["-e", "setInterval(() => {}, 1000)"], options, (error, stdout) => {
        if (error) reject(error);
        else resolve({ stdout });
      });
      child.once("spawn", spawned);
      closed = new Promise<void>(resolve => { child.once("close", resolve); });
    });
  });
  await ready;
  controller.abort();
  await assert.rejects(request, { name: "AbortError" });
  await closed;

  let commands = 0;
  const cancelled = listIosDevices(controller.signal, async () => {
    commands++;
    return response([]);
  });
  await assert.rejects(cancelled, { name: "AbortError" });
  assert.equal(commands, 0);
});

test("physical discovery is a read-only MCP tool and reports failure instead of an empty list", async t => {
  const server = new McpServer({ name: "ios-discovery-test", version: "1" });
  const source = device("localNetwork");
  const unavailable = unavailableDevice();
  const payload = response([source, unavailable]);
  const devices = await listIosDevices(undefined, async () => payload);
  let fail = false;
  registerIosDeviceTools(server, async () => {
    if (fail) throw new Error("Discovery unavailable");
    return devices;
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "ios-discovery-client", version: "1" });
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const tools = await client.listTools();
  const tool = tools.tools.find(tool => tool.name === "mobile_list_ios_devices");
  assert.equal(tool?.annotations?.readOnlyHint, true);
  assert.equal(tool?.annotations?.destructiveHint, false);
  const result = await client.callTool({ name: "mobile_list_ios_devices", arguments: {} });
  assert.deepEqual(result.structuredContent, { physicalDevices: devices });
  fail = true;
  const failed = await client.callTool({ name: "mobile_list_ios_devices", arguments: {} });
  assert.equal(failed.isError, true);
  assert.equal(failed.structuredContent, undefined);
  assert.deepEqual(failed.content, [{ type: "text", text: "Discovery unavailable" }]);
});
