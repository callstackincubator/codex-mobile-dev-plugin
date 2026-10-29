import type { TestContext } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolRequest, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { agentDeviceTools, readAgentDeviceCatalog } from "@mobile-dev/core/agent-device-tools.ts";
import type { AgentDeviceBackend } from "@mobile-dev/core/agent-device-runtime.ts";
import { installTracePropagation, instrumentMcpServer } from "@mobile-dev/core/telemetry.ts";
import { connectClient } from "./mcp.ts";

// The pinned runtime's own tool list, as its MCP server reports it.
const catalogClient = new Client({ name: "agent-device-schema-test", version: "1" });
export const runtimeUrl = new URL("../runtimes/agent-device/node_modules/agent-device/bin/agent-device.mjs", import.meta.url);
const runtimeTransport = new StdioClientTransport({
  command: process.execPath, args: [runtimeUrl.pathname, "mcp"], stderr: "pipe",
  env: { AGENT_DEVICE_NO_UPDATE_NOTIFIER: "1" },
});
await catalogClient.connect(runtimeTransport);
export const upstreamCatalog = await catalogClient.listTools();
await catalogClient.close();

export const agentDeviceCatalogFile = new URL("../runtimes/agent-device/tools.json", import.meta.url);
export const agentDeviceGuideFile = new URL("../skills/agent-device/references/workflow.md", import.meta.url);

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
  const closedDevices: string[] = [];
  const cleanup = agentDeviceTools(readAgentDeviceCatalog(agentDeviceCatalogFile), runtime).register(server, { async closeDevice(deviceId) { closedDevices.push(deviceId); } });
  const client = await connectClient(t, server, { name: "agent-device-tools-client", prepare: installTracePropagation });
  return { client, calls, result, cleanup, closedDevices, counts: () => ({ connections, closed }) };
}
