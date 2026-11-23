import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { panelSelection } from "../server/panel-selection.ts";

test("Codex reads the latest panel selection in the calling chat", async t => {
  const identity = { name: "panel-selection-test", version: "1" };
  const server = new McpServer(identity);
  panelSelection(server, { onPanelOpen() {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client(identity);
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const catalog = await client.listTools();
  const setter = catalog.tools.find(tool => tool.name === "mobile_set_panel_selection");
  assert.deepEqual(setter?._meta?.ui, { visibility: ["app"] });

  function set(threadId: string, value: Record<string, unknown>) {
    return client.callTool({ name: "mobile_set_panel_selection", arguments: value, _meta: { threadId } });
  }
  function read(threadId?: string) {
    return client.callTool({ name: "mobile_read_panel_context", arguments: {}, _meta: { threadId } });
  }
  const iphone = { platform: "ios", kind: "simulator", deviceId: "ios-device", name: "iPhone", state: "Booted", runtime: "iOS 26" };
  const pixel = { platform: "android", kind: "physical", deviceId: "127.0.0.1:5555", name: "Pixel", state: "Booted", runtime: "Android 16", transportType: "localNetwork" };
  const ios = { devices: [iphone], activeDeviceId: iphone.deviceId };
  const both = { devices: [iphone, pixel], activeDeviceId: pixel.deviceId };
  await set("one", { panelId: "first", ...ios });
  await set("one", { panelId: "second", ...both });
  await set("two", { panelId: "second", devices: [] });

  const latest = await read("one");
  assert.deepEqual(latest.structuredContent, both);
  const separate = await read("two");
  assert.deepEqual(separate.structuredContent, { devices: [] });
  const invalid = await set("one", { panelId: "second", devices: [], activeDeviceId: pixel.deviceId });
  assert.equal(invalid.isError, true);
  const preserved = await read("one");
  assert.deepEqual(preserved.structuredContent, both);
  const unidentified = await read();
  assert.equal(unidentified.isError, true);

  await set("one", { panelId: "first", ...ios });
  const changed = await read("one");
  assert.deepEqual(changed.structuredContent, ios);
  await set("one", { panelId: "first" });
  const remaining = await read("one");
  assert.deepEqual(remaining.structuredContent, both);
  await set("one", { panelId: "second" });
  const closed = await read("one");
  assert.deepEqual(closed.structuredContent, { devices: [] });
  assert.deepEqual(closed.content, [{ type: "text", text: "No Mobile Dev panel has reported a selection in this chat." }]);
});
