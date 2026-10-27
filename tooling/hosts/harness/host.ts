import { AppBridge, PostMessageTransport, type McpUiHostCapabilities, type McpUiHostContext } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** A message or model-context update the panel sent to the chat. */
type ChatEvent = { method: "message" | "modelContext" | "openLink" | "displayMode"; params: unknown };

declare global {
  interface Window {
    /** Forwards the panel's server requests to the real server; Playwright exposes it. */
    mcpRequest(method: "tools/call" | "resources/read", params: unknown): Promise<unknown>;
    harness: {
      open(options: OpenOptions): Promise<void>;
      setContext(context: McpUiHostContext): void;
      teardown(): Promise<void>;
      events: ChatEvent[];
    };
  }
}

type OpenOptions = {
  html: string;
  hostInfo: { name: string; version: string };
  capabilities: McpUiHostCapabilities;
  context: McpUiHostContext;
  /** The tool call that opened the view, sent to it once it initializes. */
  tool?: { arguments: Record<string, unknown>; result: CallToolResult };
};

let bridge: AppBridge | undefined;
let context: McpUiHostContext = {};
const events: ChatEvent[] = [];

/**
 * A minimal MCP Apps host: it renders a server's UI resource in a sandboxed iframe
 * the way chat hosts do, answers the view's requests through the real server and
 * records what the view sends to the chat.
 */
async function open({ html, hostInfo, capabilities, context: initial, tool }: OpenOptions) {
  context = initial;
  const frame = document.createElement("iframe");
  frame.id = "view";
  frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-downloads");
  document.body.replaceChildren(frame);
  bridge = new AppBridge(null, hostInfo, capabilities, { hostContext: initial });
  bridge.oncalltool = params => window.mcpRequest("tools/call", params) as Promise<CallToolResult>;
  bridge.onreadresource = params => window.mcpRequest("resources/read", params) as never;
  bridge.onmessage = async params => { events.push({ method: "message", params }); return {}; };
  bridge.onupdatemodelcontext = async params => { events.push({ method: "modelContext", params }); return {}; };
  bridge.onopenlink = async params => { events.push({ method: "openLink", params }); return {}; };
  bridge.onrequestdisplaymode = async ({ mode }) => {
    events.push({ method: "displayMode", params: { mode } });
    const next = context.availableDisplayModes?.includes(mode) ? mode : context.displayMode ?? "inline";
    setContext({ ...context, displayMode: next });
    return { mode: next };
  };
  const initialized = new Promise<void>(resolve => { bridge!.oninitialized = () => resolve(); });
  await bridge.connect(new PostMessageTransport(frame.contentWindow!, frame.contentWindow!));
  frame.srcdoc = html;
  await initialized;
  if (tool) {
    await bridge.sendToolInput({ arguments: tool.arguments });
    await bridge.sendToolResult(tool.result);
  }
}

function setContext(next: McpUiHostContext) {
  context = next;
  bridge?.setHostContext(next);
}

async function teardown() {
  await bridge?.teardownResource({});
  await bridge?.close();
  bridge = undefined;
}

window.harness = { open, setContext, teardown, events };
