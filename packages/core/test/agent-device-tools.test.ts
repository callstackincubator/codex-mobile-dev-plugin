import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolRequest, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { TestContext } from "node:test";
import { compactAgentDeviceTool } from "../src/agent-device-catalog.ts";
import { agentDeviceTools } from "../src/agent-device-tools.ts";
import type { AgentDeviceBackend } from "../src/agent-device-adapter.ts";
import { upstreamCatalog } from "../../test-support/agent-device-fixtures.ts";

const catalog = upstreamCatalog.tools.map(compactAgentDeviceTool);

async function serve(t: TestContext, connect?: () => Promise<AgentDeviceBackend>) {
  const calls: CallToolRequest["params"][] = [];
  let connections = 0;
  let closed = 0;
  const result: CallToolResult = { content: [{ type: "text", text: "Done" }], structuredContent: { accepted: true } };
  const backend: AgentDeviceBackend = {
    async listTools() { throw new Error("The catalog is static."); },
    async callTool(params) { calls.push(params); return result; },
  };
  const runtime = {
    async connect() { connections++; return connect ? connect() : backend; },
    async close() { closed++; },
  };
  const server = new McpServer({ name: "agent-device-tools-test", version: "1" });
  const cleanup = agentDeviceTools(catalog, runtime)(server);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "agent-device-tools-client", version: "1" });
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, calls, cleanup, counts: () => ({ connections, closed }) };
}

test("agent-device commands are device_ tools with their compact schemas, except those Mobile Dev covers", async t => {
  const { client, counts } = await serve(t);
  const { tools } = await client.listTools();
  const names = tools.map(tool => tool.name);
  for (const name of ["device_open", "device_snapshot", "device_press", "device_fill", "device_batch", "device_devices"]) assert.ok(names.includes(name), name);
  for (const name of ["device_logs", "device_perf", "device_install-from-source", "device_viewport", "logs", "open"]) assert.equal(names.includes(name), false, name);
  const press = tools.find(tool => tool.name === "device_press");
  assert.deepEqual(press?.inputSchema.required?.toSorted(), ["session", "target"]);
  assert.equal(press?.description, catalog.find(tool => tool.name === "press")?.description);
  assert.equal(counts().connections, 0, "Listing tools does not start the runtime");
});

test("a call starts the runtime and forwards the command under its own name", async t => {
  const { client, calls, cleanup, counts } = await serve(t);
  const target = { kind: "ref", ref: "@e12" };
  const result = await client.callTool({ name: "device_press", arguments: { session: "checkout", target, settle: true } });
  assert.deepEqual(result.structuredContent, { accepted: true });
  assert.deepEqual(calls.map(call => [call.name, call.arguments]), [["press", { session: "checkout", target, settle: true }]]);
  await client.callTool({ name: "device_snapshot", arguments: { session: "checkout", interactiveOnly: true } });
  assert.equal(counts().connections, 2, "Each call asks the runtime, which reuses its process");
  await cleanup?.();
  assert.equal(counts().closed, 1);
});

test("invalid inputs and batch steps fail before reaching the runtime", async t => {
  const { client, calls, counts } = await serve(t);
  const missingTarget = await client.callTool({ name: "device_press", arguments: { session: "checkout" } });
  assert.equal(missingTarget.isError, true);
  const hidden = await client.callTool({ name: "device_snapshot", arguments: { session: "checkout", stateDir: "/tmp" } });
  assert.equal(hidden.isError, true);
  const step = await client.callTool({ name: "device_batch", arguments: { session: "checkout", steps: [{ command: "press", input: {} }] } });
  assert.equal(step.isError, true);
  assert.match((step.content as { text: string }[])[0].text, /Batch step 1: Invalid press arguments/);
  const omitted = await client.callTool({ name: "device_batch", arguments: { session: "checkout", steps: [{ command: "logs", input: {} }] } });
  assert.match((omitted.content as { text: string }[])[0].text, /Unknown Agent Device command: logs/);
  const save = await client.callTool({ name: "device_session", arguments: { action: "save-script" } });
  assert.match((save.content as { text: string }[])[0].text, /requires a named session/);
  assert.deepEqual(calls, []);
  assert.equal(counts().connections, 0);
});

test("a runtime that cannot start returns an error result", async t => {
  const { client } = await serve(t, async () => { throw new Error("spawn node ENOENT"); });
  const result = await client.callTool({ name: "device_devices", arguments: { platform: "ios" } });
  assert.equal(result.isError, true);
  assert.match((result.content as { text: string }[])[0].text, /Agent Device could not start/);
});
