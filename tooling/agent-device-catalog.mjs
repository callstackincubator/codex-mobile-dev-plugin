import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { compactAgentDeviceTool } from "../packages/core/src/agent-device-catalog.ts";

/**
 * Lists a staged agent-device runtime's MCP tools with Mobile Dev's compact schemas.
 * Claude's server registers its commands from this catalog, so the runtime starts only
 * when a command runs. Output schemas stay out; the tools return agent-device's results.
 */
export async function agentDeviceCatalog(runtime) {
  const root = resolve(runtime);
  const stateDir = await mkdtemp(join(tmpdir(), "mobile-dev-agent-device-catalog-"));
  const env = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? stateDir, AGENT_DEVICE_CONFIG: join(root, "config.json"), AGENT_DEVICE_STATE_DIR: stateDir, AGENT_DEVICE_NO_UPDATE_NOTIFIER: "1" };
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(root, "node_modules/agent-device/bin/agent-device.mjs"), "mcp"], cwd: stateDir, env, stderr: "inherit" });
  const client = new Client({ name: "mobile-dev-build", version: "1" });
  try {
    await client.connect(transport);
    const tools = [];
    let cursor;
    do {
      const page = await client.listTools({ cursor });
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor !== undefined);
    return tools.map(compactAgentDeviceTool).map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations }));
  } finally {
    await client.close();
    await rm(stateDir, { recursive: true, force: true });
  }
}
