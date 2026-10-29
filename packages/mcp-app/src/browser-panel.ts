import { AppBridge, getToolUiResourceUri, PostMessageTransport, type McpUiHostContext } from "@modelcontextprotocol/ext-apps/app-bridge";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { PLUGIN_VERSION } from "@mobile-dev/shared/version.ts";

/**
 * The page a browser beside the chat opens when its host renders no MCP Apps
 * panel. It is a minimal MCP Apps host: it shows the panel of the tool that opened
 * it in a sandboxed frame, as chat hosts do, and answers the panel's requests
 * through the server that served this page, which shares the chat host's session.
 */
const query = new URLSearchParams(location.search);
const toolName = query.get("tool") ?? "mobile_open_simulator";
const target = Object.fromEntries(["platform", "kind", "deviceId"].flatMap(key => {
  const value = query.get(key);
  return value === null ? [] : [[key, value]];
}));
const dark = matchMedia("(prefers-color-scheme: dark)");
const STOPPED = "Mobile Dev stopped with its chat session. Ask the agent to open Mobile Dev again.";

function notice(text: string) {
  const alert = document.createElement("p");
  alert.setAttribute("role", "alert");
  alert.textContent = text;
  document.body.replaceChildren(alert);
}

async function open() {
  const client = new Client({ name: "mobile-dev-browser-panel", version: PLUGIN_VERSION });
  const transport = new StreamableHTTPClientTransport(new URL("mcp", location.href));
  // The server listens only while its chat host runs it, so a request that cannot
  // reach it means the session ended; the panel cannot recover on this page.
  client.onerror = error => { if (error instanceof TypeError) notice(STOPPED); };
  await client.connect(transport);
  const { tools } = await client.listTools();
  const tool = tools.find(candidate => candidate.name === toolName);
  const uri = tool && getToolUiResourceUri(tool);
  if (!tool || !uri) throw new Error(`Mobile Dev has no panel for ${toolName}.`);
  const [content] = (await client.readResource({ uri })).contents;
  if (!content || !("text" in content)) throw new Error("Mobile Dev's panel could not load.");

  const frame = document.createElement("iframe");
  frame.title = "Mobile Dev";
  frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-downloads");
  frame.allow = "clipboard-write";
  document.body.replaceChildren(frame);
  // The frame fills the page, so the panel gets no container dimensions and fills it too.
  const context = (): McpUiHostContext => ({
    theme: dark.matches ? "dark" : "light", displayMode: "inline", availableDisplayModes: ["inline"],
    platform: "desktop", locale: navigator.language, toolInfo: { tool },
  });
  // The server names the chat host, so the panel's telemetry is attributed to it.
  const host = document.documentElement.dataset.telemetryHost ?? "other";
  // The panel can call the server's tools and read its resources. There is no chat
  // for messages or model context, so the panel hides the actions that need one.
  const bridge = new AppBridge(client, { name: host, version: PLUGIN_VERSION }, { serverTools: {}, serverResources: {}, openLinks: {} }, { hostContext: context() });
  bridge.onopenlink = async ({ url }) => {
    window.open(url, "_blank", "noopener");
    return {};
  };
  bridge.onrequestdisplaymode = async () => ({ mode: "inline" });
  dark.addEventListener("change", () => bridge.setHostContext(context()));
  const initialized = new Promise<void>(resolve => { bridge.oninitialized = () => resolve(); });
  await bridge.connect(new PostMessageTransport(frame.contentWindow!, frame.contentWindow!));
  frame.srcdoc = content.text;
  await initialized;
  // Open the panel the way a chat host does, with the opening tool's input and result.
  await bridge.sendToolInput({ arguments: target });
  await bridge.sendToolResult(await client.callTool({ name: toolName, arguments: target }) as CallToolResult);

  addEventListener("pagehide", event => {
    if (event.persisted) return;
    void bridge.teardownResource({}).catch(() => {});
    void transport.terminateSession().catch(() => {});
  });
}

open().catch(error => {
  console.error(error);
  notice(error instanceof TypeError ? STOPPED : `Mobile Dev could not open: ${error instanceof Error ? error.message : String(error)}`);
});
