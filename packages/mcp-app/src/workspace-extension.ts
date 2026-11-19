import type { App } from "@modelcontextprotocol/ext-apps";
import type { SimulatorDevice } from "@mobile-dev/shared/protocol.ts";
import type { ReactNode } from "react";

/** Chrome one host adds to the shared workspace, such as Codex's update banner. */
export type WorkspaceExtension = {
  banner?: ReactNode;
  setAvailable(available: boolean): void;
  onSelectionChange?(devices: SimulatorDevice[], active?: SimulatorDevice): void;
  resume?(): void;
  dispose(): void | Promise<void>;
};

export type WorkspaceOptions = {
  extension?: (app: App) => WorkspaceExtension;
  /** Show Expand / Back to chat. Hosts with their own fullscreen controls (Codex) turn it off; advertised display modes cannot tell. */
  displayModeControl?: boolean;
};
