import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { listIosDevices, registerIosDeviceTools } from "../src/server/ios-devices.ts";

const coreDeviceId = "11111111-1111-4111-8111-111111111111";
const udid = "00008110-000A0B1C2D3E4000";

function device(transportType = "wired", connectionState = "connected") {
  return {
    identifier: coreDeviceId,
    properties: {
      hardware: { udid, marketingName: "iPhone 17 Pro", reality: "physical", platform: "iOS" },
      state: { name: "Test iPhone" }, software: { osVersionNumber: { components: [27, 0, 0, 0, 0], originalComponentsCount: 2, stringValue: "27.0" } },
      connection: { state: connectionState, transportType, pairingState: "paired" },
    },
  };
}

function response(devices: unknown[], jsonVersion = 5) {
  const payload = { info: { jsonVersion, outcome: "success" }, result: { devices } };
  return { stdout: JSON.stringify(payload) };
}

test("discovery preserves identity and reports USB, Wi-Fi, and disconnected state", async () => {
  for (const [transport, state] of [["wired", "connected"], ["localNetwork", "connected"], ["none", "disconnected"]]) {
    const source = device(transport, state);
    const payload = response([source]);
    const devices = await listIosDevices(async () => payload);
    assert.deepEqual(devices, [{ udid, coreDeviceId, name: "Test iPhone", model: "iPhone 17 Pro", state,
      runtime: "iOS 27.0", platform: "ios", kind: "physical", transportType: transport, pairingState: "paired" }]);
  }
});

test("discovery uses bounded devicectl JSON output and requests only physical iOS devices", async () => {
  const devices = await listIosDevices(async (file, args, options) => {
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
  const failed = listIosDevices(async () => { throw failure; });
  await assert.rejects(failed, failure);
  const old = response([], 3);
  const unsupported = listIosDevices(async () => old);
  await assert.rejects(unsupported, /requires Xcode 27/);
  const missingName = device();
  Reflect.deleteProperty(missingName.properties.state, "name");
  const malformed = response([missingName]);
  const invalid = listIosDevices(async () => malformed);
  await assert.rejects(invalid, /unsupported device discovery JSON/);
  const invalidJson = listIosDevices(async () => ({ stdout: "not JSON" }));
  await assert.rejects(invalidJson, SyntaxError);
});

test("physical discovery is a read-only MCP tool and reports failure instead of an empty list", async t => {
  const server = new McpServer({ name: "ios-discovery-test", version: "1" });
  const source = device("localNetwork");
  const payload = response([source]);
  const devices = await listIosDevices(async () => payload);
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
