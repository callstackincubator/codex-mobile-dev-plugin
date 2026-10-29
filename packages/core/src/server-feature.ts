import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/** A host's addition to the shared server, such as Codex's self-updater. Returns its cleanup, if any. */
export type ServerFeature = (server: McpServer) => void | (() => void | Promise<void>);
