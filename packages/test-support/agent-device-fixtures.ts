import type { TestContext } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolRequest, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { agentDeviceTools, readAgentDeviceCatalog } from "../core/src/agent-device-tools.ts";
import type { AgentDeviceBackend } from "../core/src/agent-device-runtime.ts";
import { installTracePropagation, instrumentMcpServer } from "../core/src/telemetry.ts";

// The pinned runtime's own tool list, as its MCP server reports it.
const catalogClient = new Client({ name: "agent-device-schema-test", version: "1" });
const runtimeUrl = new URL("../runtimes/agent-device/node_modules/agent-device/bin/agent-device.mjs", import.meta.url);
const runtimeTransport = new StdioClientTransport({
  command: process.execPath, args: [runtimeUrl.pathname, "mcp"], stderr: "pipe",
  env: { AGENT_DEVICE_NO_UPDATE_NOTIFIER: "1" },
});
await catalogClient.connect(runtimeTransport);
export const upstreamCatalog = await catalogClient.listTools();
await catalogClient.close();

/** The catalog Mobile Dev ships. */
export const agentDeviceCatalogFile = new URL("../runtimes/agent-device/tools.json", import.meta.url);

/**
 * A client of an instrumented server with the `device_*` tools, over a fake runtime that
 * records each command and answers with `handler`, or with an accepted result.
 */
export async function agentDeviceClient(t: TestContext, handler?: AgentDeviceBackend["callTool"], connect?: () => Promise<AgentDeviceBackend>) {
  const calls: CallToolRequest["params"][] = [];
  const result: CallToolResult = { content: [{ type: "text", text: "Done" }], structuredContent: { accepted: true } };
  const backend: AgentDeviceBackend = {
    async callTool(params, options) {
      calls.push(params);
      return handler ? handler(params, options) : result;
    },
  };
  let connections = 0;
  let closed = 0;
  const runtime = {
    async connect() { connections++; return connect ? connect() : backend; },
    async close() { closed++; },
  };
  const server = new McpServer({ name: "agent-device-tools-test", version: "1" });
  instrumentMcpServer(server);
  const cleanup = agentDeviceTools(readAgentDeviceCatalog(agentDeviceCatalogFile), runtime)(server);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  installTracePropagation(serverTransport);
  const client = new Client({ name: "agent-device-tools-client", version: "1" });
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, calls, result, cleanup, counts: () => ({ connections, closed }) };
}
