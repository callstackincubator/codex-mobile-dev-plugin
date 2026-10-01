import test from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerIosMirrorTools } from "../src/server/ios-mirror-tools.ts";
import { IosMirrorSessions } from "../src/server/ios-mirror.ts";
import type { PhysicalIosDevice } from "../src/shared/ios-devices.ts";
import type { Bezel } from "../src/shared/bezel.ts";

const screenshotBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

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

test("physical iOS screenshots copy and return the same displayed PNG, including clipboard failures", async t => {
  const copied: Buffer[] = [];
  let clipboardFails = false;
  const sessions = new IosMirrorSessions(async () => ({
    async read() { return { generation: 1, dropped: 0, frames: [] }; },
    async touch() {}, reset() {}, async close() {},
  }));
  const server = new McpServer({ name: "screenshot-test", version: "1" });
  const close = registerIosMirrorTools(server, "ui://test/app", sessions, async () => [phone], async () => bezel, async bytes => {
    copied.push(bytes);
    if (clipboardFails) throw new Error("Clipboard unavailable");
  });
  const client = new Client({ name: "test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await close(); await client.close(); await server.close(); });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const tools = await client.listTools();
  const tool = tools.tools.find(tool => tool.name === "mobile_ios_mirror_capture_screenshot");
  assert.deepEqual(tool?._meta?.ui, { resourceUri: "ui://test/app", visibility: ["app"] });
  const id = await sessions.open(phone.udid);
  const image = screenshotBytes.toString("base64");
  const request = { name: "mobile_ios_mirror_capture_screenshot", arguments: { sessionId: id, image } };
  const result = await client.callTool(request);
  assert.equal(result.isError, undefined);
  assert.deepEqual(copied[0], screenshotBytes);
  assert.deepEqual(result.content, [{ type: "image", mimeType: "image/png", data: image }]);
  assert.deepEqual(result.structuredContent, { udid: phone.udid, copied: true });
  clipboardFails = true;
  const failedCopy = await client.callTool(request);
  assert.equal(failedCopy.isError, undefined);
  assert.deepEqual(failedCopy.content, result.content);
  assert.deepEqual(failedCopy.structuredContent, { udid: phone.udid, copied: false, clipboardError: "Clipboard unavailable" });
  await sessions.closeSession(id);
  const closed = await client.callTool(request);
  assert.equal(closed.isError, true);
  assert.equal(copied.length, 2);
});

test("physical iOS screenshots reject invalid and oversized PNGs before copying", async t => {
  let copies = 0;
  const sessions = new IosMirrorSessions(async () => ({
    async read() { return { generation: 1, dropped: 0, frames: [] }; },
    async touch() {}, reset() {}, async close() {},
  }));
  const server = new McpServer({ name: "screenshot-test", version: "1" });
  const close = registerIosMirrorTools(server, "ui://test/app", sessions, async () => [phone], async () => bezel, async () => { copies++; });
  const client = new Client({ name: "test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await close(); await client.close(); await server.close(); });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const id = await sessions.open(phone.udid);
  const oversized = Buffer.alloc(16 * 1024 * 1024 + 1);
  screenshotBytes.copy(oversized);
  const oversizedImage = oversized.toString("base64");
  for (const image of ["", "not a PNG!", "AQID", oversizedImage]) {
    const result = await client.callTool({ name: "mobile_ios_mirror_capture_screenshot", arguments: { sessionId: id, image } });
    assert.equal(result.isError, true);
  }
  assert.equal(copies, 0);
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
