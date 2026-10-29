import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/** What the shared server offers the features a host adds to it. */
export type ServerServices = {
  /** Closes every log, collector and stream session the device holds, before it shuts down. */
  closeDevice(deviceId: string): Promise<void>;
};

/** A host's addition to the shared server, such as Codex's self-updater. Returns its cleanup, if any. */
export type ServerFeature = (server: McpServer, services: ServerServices) => void | (() => void | Promise<void>);
