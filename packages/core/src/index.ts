import "./instrument.ts";
import { runStdioServer } from "./stdio-server.ts";
import { createPanel } from "./panel-tools.ts";
import { agentDeviceTools, readAgentDeviceCatalog } from "./agent-device-tools.ts";
import { browserPanel } from "./browser-panel.ts";

// The shared server with Mobile Dev's panel and agent-device's commands, as Cursor and other
// MCP hosts run it. Hosts that render no MCP Apps panel can show it in a browser beside the chat.
await runStdioServer({ panel: createPanel(), features: [agentDeviceTools(readAgentDeviceCatalog()), browserPanel()] });
