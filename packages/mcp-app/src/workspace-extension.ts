import type { App } from "@modelcontextprotocol/ext-apps";
import type { ReactNode } from "react";

/**
 * Chrome one host adds to the shared MCP Apps workspace, such as Codex's update
 * banner. The host's page entry creates it once the panel's `App` exists.
 */
export type WorkspaceExtension = {
  banner?: ReactNode;
  /** Whether the host can call the server's tools. */
  setAvailable(available: boolean): void;
  dispose(): void;
};

export type WorkspaceOptions = {
  extension?: (app: App) => WorkspaceExtension;
  /**
   * Whether the workspace shows Expand / Back to chat. Hosts with their own
   * fullscreen and sidebar controls, such as Codex, turn it off; the host's
   * advertised display modes alone cannot tell.
   */
  displayModeControl?: boolean;
};
