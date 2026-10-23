import "./instrument.ts";
import { runStdioServer } from "./stdio-server.ts";

// The shared server with no host features, as Claude Desktop and other MCP hosts run it.
await runStdioServer();
