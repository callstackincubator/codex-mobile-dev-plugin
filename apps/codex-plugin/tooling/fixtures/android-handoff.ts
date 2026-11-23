import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { Baguette } from "@mobile-dev/core/baguette.ts";
import { createPanel } from "@mobile-dev/core/panel-tools.ts";
import { ServeEmu } from "@mobile-dev/core/serve-emu.ts";
import type { Status } from "@mobile-dev/shared/protocol.ts";
import { createTestPlugin } from "@mobile-dev/test-support/fixtures.ts";

const [serial] = process.argv.slice(2);
class ConnectedAndroid extends ServeEmu {
  override async list(): Promise<Status> {
    return { connected: true, managed: false, baseUrl: "", devices: [
      { platform: "android", kind: "emulator", state: "Booted", runtime: "Android", udid: "emulator-5554", name: "Pixel 8" },
      { platform: "android", kind: "physical", state: "Booted", runtime: "Android", udid: serial, name: "ADC Pixel 9", model: "ADC Pixel 9", transportType: "localNetwork" },
    ] };
  }
}
class EmptySimulatorBackend extends Baguette {
  override async start(): Promise<Status> {
    return { connected: true, managed: false, baseUrl: "", devices: [] };
  }
}

const baguette = new EmptySimulatorBackend();
const panel = createPanel({ baguette });
const android = new ConnectedAndroid();
const plugin = await createTestPlugin("<html></html>", { panel, android });
const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
await plugin.server.connect(serverSide);
const client = new Client({ name: "handoff-test", version: "1" });
await client.connect(clientSide);

// The CLI transcript captures every call, including those denied before dispatch.
const mobileToolNames = new Set(["mobile_list_android_devices", "mobile_open_simulator"]);
const listed = await client.listTools();
const tools = listed.tools.filter(tool => mobileToolNames.has(tool.name));
const shell: Tool = {
  name: "exec_command", description: "Run a macOS shell command and return its output.",
  inputSchema: { type: "object", properties: { cmd: { type: "string" } }, required: ["cmd"] },
};
tools.push(shell);
const instructions = client.getInstructions();
const server = new Server({ name: "mobile-dev", version: "1" }, { instructions, capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  if (mobileToolNames.has(params.name)) return client.callTool(params);
  if (params.name !== shell.name) throw new Error(`Unknown tool: ${params.name}`);
  const command = params.arguments?.cmd;
  let text = "";
  if (command === "command -v scrcpy" || command === "which scrcpy") text = "/opt/homebrew/bin/scrcpy";
  if (command === "scrcpy --version") text = "scrcpy 4.0";
  return { content: [{ type: "text", text }] };
});
const transport = new StdioServerTransport();
await server.connect(transport);
process.stdin.once("end", async () => {
  await client.close();
  await plugin.close();
  await server.close();
});
