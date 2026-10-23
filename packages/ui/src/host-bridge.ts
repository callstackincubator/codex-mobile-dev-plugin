import type { App } from "@modelcontextprotocol/ext-apps";

/**
 * The host operations shared views use. Codex passes its MCP Apps `App`; another
 * host implements the same subset over its own connection to the server. Hosts
 * without a chat leave `message` and `updateModelContext` out of their
 * capabilities, and the views hide the actions that need them.
 */
export type HostBridge = Pick<App,
  | "callServerTool"
  | "readServerResource"
  | "getHostCapabilities"
  | "getHostContext"
  | "sendMessage"
  | "updateModelContext"
  | "requestDisplayMode">;
