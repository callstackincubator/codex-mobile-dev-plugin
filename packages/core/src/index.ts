import "./instrument.ts";
import { runStdioServer } from "./stdio-server.ts";
import { createPanel } from "./panel-tools.ts";

// The shared server with Mobile Dev's panel and no host features, as Cursor and other MCP hosts run it.
await runStdioServer({ panel: createPanel() });
