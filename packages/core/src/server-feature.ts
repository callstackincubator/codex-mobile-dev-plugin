import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * A host's addition to the shared server, such as Codex's self-updater or the Mac
 * app's page. Each host's server entry passes its own; the shared server knows none.
 * Returns its cleanup, if it has any.
 */
export type ServerFeature = (server: McpServer) => void | (() => void | Promise<void>);
