import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import type { DeviceSessions } from "./device-sessions.ts";
import type { ServeEmu } from "./serve-emu.ts";
import type { Simctl } from "./simctl.ts";
import type { DriverFactory } from "./app-control/tools.ts";
import type { ShowRecording } from "./recording-tools.ts";
import type { SimulatorForeground } from "./device-apps/foreground.ts";

/** How a page opens: cards inline in the chat, device views fullscreen where the host can. */
export type PageDisplay = "inline" | "fullscreen";
export type ReadPage = (uri: URL) => Promise<ReadResourceResult>;

/** What the shared server offers the features a host adds to it. */
export type ServerServices = {
  /** Closes every log, collector and stream session the device holds, before it shuts down. */
  closeDevice(deviceId: string): Promise<void>;
  /** The sessions closeDevice closes; a feature adds its own. */
  deviceSessions: DeviceSessions;
  android: ServeEmu;
  simulators: Simctl;
  drivers: DriverFactory;
  /** Reads the shared page as `view`, configured for this server. */
  servePage(view: string, display: PageDisplay): ReadPage;
  showRecording: ShowRecording;
  /** Runs `listener` once the client has initialized and its capabilities are known. */
  onInitialized(listener: () => void): void;
};

/** A host's addition to the shared server, such as Mobile Dev's panel or Codex's self-updater. */
export type ServerFeature = {
  /** Replaces the server's instructions; the first feature that has them wins. */
  instructions?: string;
  /** Finds the foreground app on a simulator for the app and storage tools. */
  simulatorForeground?: SimulatorForeground;
  /** Serves the workspace, so cards can open recordings in it. */
  workspace?: boolean;
  /** Registers the feature's tools and resources and returns its cleanup, if any. */
  register(server: McpServer, services: ServerServices): void | (() => void | Promise<void>);
};
