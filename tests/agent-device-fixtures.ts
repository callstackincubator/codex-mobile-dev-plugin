import type { TestContext } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolRequest, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createAgentDeviceAdapter, type AgentDeviceBackend } from "../src/server/agent-device-adapter.ts";
import { installTracePropagation } from "../src/server/telemetry.ts";

const catalogClient = new Client({ name: "agent-device-schema-test", version: "1" });
const runtimeUrl = new URL("../runtimes/agent-device/node_modules/agent-device/bin/agent-device.mjs", import.meta.url);
const runtimeTransport = new StdioClientTransport({
  command: process.execPath, args: [runtimeUrl.pathname, "mcp"], stderr: "pipe",
  env: { AGENT_DEVICE_NO_UPDATE_NOTIFIER: "1" },
});
await catalogClient.connect(runtimeTransport);
export const upstreamCatalog = await catalogClient.listTools();
await catalogClient.close();

export async function adapterClient(t: TestContext, handler?: AgentDeviceBackend["callTool"]) {
  const calls: CallToolRequest["params"][] = [];
  const result: CallToolResult = { content: [{ type: "text", text: "Done" }], structuredContent: { accepted: true } };
  const backend: AgentDeviceBackend = {
    async listTools() { return upstreamCatalog; },
    async callTool(params, options) {
      calls.push(params);
      if (handler !== undefined) return handler(params, options);
      return result;
    },
  };
  const server = await createAgentDeviceAdapter(backend);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  installTracePropagation(serverTransport);
  const client = new Client({ name: "adapter-test", version: "1" });
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, calls, result };
}
