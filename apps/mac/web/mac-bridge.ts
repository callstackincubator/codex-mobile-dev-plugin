import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { HostBridge } from "@mobile-dev/ui/host-bridge.ts";
import { PLUGIN_VERSION } from "@mobile-dev/shared/version.ts";
import { MAC_TELEMETRY_URI, type MacTelemetryMetadata } from "../shared/telemetry.ts";

type ShellMessage =
  | { type: "ready" }
  | { type: "layout"; layout: string }
  | { type: "error"; message: string };

type WebKitHandlers = { mcp: { postMessage(message: string): void }; shell: { postMessage(message: ShellMessage): void } };
declare global {
  interface Window {
    webkit?: { messageHandlers: WebKitHandlers };
    /** Swift delivers each line the server writes to stdout here. */
    __mobileDevReceive?: (message: JSONRPCMessage) => void;
  }
}

/** Posts to the native window. Outside the app (tests, a browser) it is a no-op. */
export function postToShell(message: ShellMessage) {
  window.webkit?.messageHandlers.shell.postMessage(message);
}

/** MCP JSON-RPC over the app's server process: Swift pipes outgoing messages to stdin and calls `__mobileDevReceive` per stdout line. */
class WebKitRelayTransport implements Transport {
  onmessage?: (message: JSONRPCMessage) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;

  async start() {
    if (window.webkit === undefined) throw new Error("Mobile Dev's server connection is only available inside the Mac app.");
    window.__mobileDevReceive = message => this.onmessage?.(message);
  }
  async send(message: JSONRPCMessage) { window.webkit!.messageHandlers.mcp.postMessage(JSON.stringify(message)); }
  async close() {
    window.__mobileDevReceive = undefined;
    this.onclose?.();
  }
}

const dark = window.matchMedia("(prefers-color-scheme: dark)");

/**
 * The Mac app's host. It calls the server directly and has no chat, so it offers
 * no message or model-context capability; views hide the actions that need one.
 */
export class MacHostBridge implements HostBridge {
  private readonly client = new Client({ name: "mobile-dev-mac", version: PLUGIN_VERSION });

  connect() { return this.client.connect(new WebKitRelayTransport()); }
  close() { return this.client.close(); }

  /** Reads the server's telemetry environment, opt-out and anonymous identity once connected. */
  async readTelemetryMetadata(): Promise<MacTelemetryMetadata> {
    const { contents } = await this.client.readResource({ uri: MAC_TELEMETRY_URI });
    const content = contents[0];
    if (content === undefined || !("text" in content)) throw new Error("The server returned no telemetry metadata. Rebuild the app with npm run build:mac.");
    return JSON.parse(content.text) as MacTelemetryMetadata;
  }

  callServerTool: HostBridge["callServerTool"] = async (params, options) =>
    await this.client.callTool(params, undefined, options) as CallToolResult;
  readServerResource: HostBridge["readServerResource"] = (params, options) => this.client.readResource(params, options);
  getHostCapabilities: HostBridge["getHostCapabilities"] = () => ({ serverTools: {}, serverResources: {} });
  getHostContext: HostBridge["getHostContext"] = () => ({ theme: dark.matches ? "dark" : "light", availableDisplayModes: ["inline"] });
  sendMessage: HostBridge["sendMessage"] = () => Promise.reject(new Error("The Mac app has no chat to send to."));
  updateModelContext: HostBridge["updateModelContext"] = () => Promise.reject(new Error("The Mac app has no chat context."));
  requestDisplayMode: HostBridge["requestDisplayMode"] = async () => ({ mode: "inline" });
}
