import "./instrument.ts";
import { runStdioServer } from "./stdio-server.ts";
import { createPanel } from "./panel-tools.ts";
import { agentDeviceTools, readAgentDeviceCatalog } from "./agent-device-tools.ts";

// The shared server with Mobile Dev's panel and agent-device's commands, as Cursor and other MCP hosts run it.
await runStdioServer({ panel: createPanel(), features: [agentDeviceTools(readAgentDeviceCatalog())] });
