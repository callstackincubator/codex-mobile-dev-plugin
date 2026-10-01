import test from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerIosMirrorTools } from "../src/server/ios-mirror-tools.ts";
import { IosMirrorSessions } from "../src/server/ios-mirror.ts";
import type { PhysicalIosDevice } from "../src/shared/ios-devices.ts";
import type { Bezel } from "../src/shared/bezel.ts";

const phone: PhysicalIosDevice = { udid: "00008150-0000111122223333", coreDeviceId: "11111111-1111-4111-8111-111111111111", name: "Phone", model: "iPhone 17 Pro", productType: "iPhone18,1", state: "connected", runtime: "iOS 27.0", platform: "ios", kind: "physical", transportType: "localNetwork", pairingState: "paired" };
const bezel: Bezel = { rect: { x: 27, y: 18, width: 400, height: 872 }, viewport: { width: 454, height: 908 }, clipRadius: 62, image: "data:image/png;base64,AQID", mask: "data:image/png;base64,BAUG" };

test("physical mirroring tools stream compressed frames over an app-only MCP session", async t => {
  let closed = 0;
  const touches: unknown[] = [];
  const sessions = new IosMirrorSessions(async udid => {
    assert.equal(udid, phone.udid);
    return { async read() { return { generation: 1, dropped: 0, frames: [{ data: Buffer.from([1, 2, 3]), timestamp: 0, key: true }] }; },
      async touch(samples, generation) { touches.push({ samples, generation }); }, reset() {}, async close() { closed++; } };
  });
  const server = new McpServer({ name: "mirror-test", version: "1" });
  const close = registerIosMirrorTools(server, "ui://test/app", sessions, async () => [phone], async device => {
    assert.equal(device.productType, phone.productType);
    return bezel;
  });
  const client = new Client({ name: "test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await close(); await client.close(); await server.close(); });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const tools = await client.listTools();
  const openTool = tools.tools.find(tool => tool.name === "mobile_ios_mirror_session");
  assert.deepEqual(openTool?._meta?.ui, { resourceUri: "ui://test/app", visibility: ["app"] });
  const opened = await client.callTool({ name: "mobile_ios_mirror_session", arguments: { udid: phone.udid } });
  assert.equal(opened.isError, undefined);
  assert.deepEqual(opened._meta?.bezel, bezel);
  const id = opened._meta?.sessionId;
  const uri = opened._meta?.frameUri;
  assert.equal(typeof id, "string");
  assert.equal(typeof uri, "string");
  const resource = await client.readResource({ uri: String(uri) });
  const content = resource.contents[0];
  assert.ok("text" in content);
  const batch = JSON.parse(content.text);
  assert.equal(batch.frames[0].data, "AQID");
  assert.equal(batch.frames[0].timestamp, 0);
  const touch = await client.callTool({ name: "mobile_ios_mirror_input", arguments: {
    sessionId: id, generation: 1, messages: [
      { type: "touch1-down", x: 200, y: 400, width: 400, height: 800 },
      { type: "touch1-up", x: 200, y: 400, width: 400, height: 800 },
    ],
  } });
  assert.equal(touch.isError, undefined);
  assert.deepEqual(touches, [{ samples: [
    { phase: 0, x: 200, y: 400, width: 400, height: 800 },
    { phase: 2, x: 200, y: 400, width: 400, height: 800 },
  ], generation: 1 }]);
  const invalid = await client.callTool({ name: "mobile_ios_mirror_input", arguments: {
    sessionId: id, generation: 1, messages: [{ type: "button", button: "home" }],
  } });
  assert.equal(invalid.isError, true);
  assert.equal(touches.length, 1);
  await client.callTool({ name: "mobile_ios_mirror_close", arguments: { sessionId: id } });
  assert.equal(closed, 1);
});

test("an unavailable Apple frame reports its error before starting native capture", async t => {
  let opens = 0;
  const sessions = new IosMirrorSessions(async () => { opens++; throw new Error("Unexpected native open"); });
  const server = new McpServer({ name: "mirror-test", version: "1" });
  const close = registerIosMirrorTools(server, "ui://test/app", sessions, async () => [phone], async () => { throw new Error("Apple device frame unavailable"); });
  const client = new Client({ name: "test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await close(); await client.close(); await server.close(); });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const result = await client.callTool({ name: "mobile_ios_mirror_session", arguments: { udid: phone.udid } });
  assert.equal(result.isError, true);
  assert.deepEqual(result.content, [{ type: "text", text: "Apple device frame unavailable" }]);
  assert.equal(opens, 0);
});

test("a disconnected iPhone cannot open a native capture", async t => {
  let opens = 0;
  const sessions = new IosMirrorSessions(async () => { opens++; throw new Error("Unexpected native open"); });
  const server = new McpServer({ name: "mirror-test", version: "1" });
  const close = registerIosMirrorTools(server, "ui://test/app", sessions, async () => [{ ...phone, state: "disconnected" }]);
  const client = new Client({ name: "test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await close(); await client.close(); await server.close(); });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const result = await client.callTool({ name: "mobile_ios_mirror_session", arguments: { udid: phone.udid } });
  assert.equal(result.isError, true);
  assert.equal(opens, 0);
});
