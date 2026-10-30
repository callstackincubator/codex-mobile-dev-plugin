import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PanelTarget } from "@mobile-dev/shared/panel-target.ts";
import type { SharedTransport } from "./shared-transport.ts";

/**
 * Adds to the result of a tool that opens the panel, such as a way to show it in a
 * host that renders no MCP Apps panel. Returns text for the model, or nothing.
 */
export type PanelOpener = (open: { tool: string; target: PanelTarget }) => Promise<string | undefined>;

/** What the shared server offers a feature beyond the MCP server itself. */
export type ServerFeatureContext = {
  /** The server's transport, which other connections can join; absent until a host connects it. */
  connections?: SharedTransport;
  onPanelOpen(opener: PanelOpener): void;
};

/** A host's addition to the shared server, such as Codex's self-updater. Returns its cleanup, if any. */
export type ServerFeature = (server: McpServer, context: ServerFeatureContext) => void | (() => void | Promise<void>);
