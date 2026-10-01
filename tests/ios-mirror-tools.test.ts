import test from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerIosMirrorTools } from "../src/server/ios-mirror-tools.ts";
import { IosMirrorSessions } from "../src/server/ios-mirror.ts";
import type { PhysicalIosDevice } from "../src/shared/ios-devices.ts";

const phone: PhysicalIosDevice = { udid: "00008150-0000111122223333", coreDeviceId: "11111111-1111-4111-8111-111111111111", name: "Phone", model: "iPhone 17 Pro", state: "connected", runtime: "iOS 27.0", platform: "ios", kind: "physical", transportType: "localNetwork", pairingState: "paired" };

test("physical mirroring tools stream compressed frames over an app-only MCP session", async t => {
  let closed = 0;
  const sessions = new IosMirrorSessions(async udid => {
    assert.equal(udid, phone.udid);
    return { async read() { return { generation: 1, dropped: 0, frames: [{ data: Buffer.from([1, 2, 3]), timestamp: 0, key: true }] }; }, reset() {}, async close() { closed++; } };
  });
  const server = new McpServer({ name: "mirror-test", version: "1" });
  const close = registerIosMirrorTools(server, "ui://test/app", sessions, async () => [phone]);
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
  await client.callTool({ name: "mobile_ios_mirror_close", arguments: { sessionId: id } });
  assert.equal(closed, 1);
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
