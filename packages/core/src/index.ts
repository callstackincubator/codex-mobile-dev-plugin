import "./instrument.ts";
import { runStdioServer } from "./stdio-server.ts";
import { browserPanel } from "./browser-panel.ts";

// The shared server, as Claude Desktop and other MCP hosts run it. Hosts that render
// no MCP Apps panel can show it in a browser beside the chat instead.
await runStdioServer([browserPanel]);
