import { AppBridge, getToolUiResourceUri, PostMessageTransport, type McpUiHostContext } from "@modelcontextprotocol/ext-apps/app-bridge";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { PLUGIN_VERSION } from "@mobile-dev/shared/version.ts";

const dark = matchMedia("(prefers-color-scheme: dark)");
const DISCONNECTED = "Mobile Dev disconnected from its chat session. Ask the agent to open Mobile Dev again.";
const EXPIRED = "Mobile Dev's browser connection expired. Reload this page to reconnect.";

function notice(text: string) {
  const alert = document.createElement("p");
  alert.setAttribute("role", "alert");
  alert.textContent = text;
  document.body.replaceChildren(alert);
}

/** A small MCP Apps host for the same shared panel the chat would otherwise render. */
async function open() {
  const query = new URLSearchParams(location.search);
  const toolName = query.get("tool") ?? "mobile_open_simulator";
  if (toolName !== "mobile_open_simulator" && toolName !== "mobile_open_workspace") {
    throw new Error("This link does not open a Mobile Dev panel.");
  }
  const target: Record<string, string> = {};
  for (const key of ["platform", "kind", "deviceId"]) {
    const value = query.get(key);
    if (value !== null) target[key] = value;
  }
  const client = new Client({ name: "mobile-dev-browser-panel", version: PLUGIN_VERSION });
  const endpoint = new URL("mcp", location.href);
  const transport = new StreamableHTTPClientTransport(endpoint, {
    fetch: (url, options) => fetch(url, { ...options, keepalive: options?.method === "DELETE" }),
  });
  let bridge: AppBridge | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let startup: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let checking = false;
  let contextChanged = () => {};

  function dispose() {
    if (disposed) return;
    disposed = true;
    clearInterval(heartbeat);
    clearTimeout(startup);
    dark.removeEventListener("change", contextChanged);
    removeEventListener("pagehide", hide);
    const teardown = bridge?.teardownResource({}, { timeout: 1000, maxTotalTimeout: 1000 });
    void teardown?.catch(() => {}).finally(() => bridge?.close());
    void transport.terminateSession().catch(() => {}).finally(() => client.close());
  }
  function stopped(message: string) {
    if (disposed) return;
    notice(message);
    dispose();
  }
  function hide(event: PageTransitionEvent) {
    if (event.persisted === false) dispose();
  }
  // A ping keeps hidden tabs alive and notices a stopped server even when the UI
  // has no device to poll. Abandoned sessions expire on the server after five minutes.
  async function check() {
    if (disposed || checking) return;
    checking = true;
    try { await client.ping({ timeout: 5000 }); }
    catch (error) {
      const expired = error instanceof StreamableHTTPError && error.code === 404;
      stopped(expired ? EXPIRED : DISCONNECTED);
    } finally { checking = false; }
  }
  client.onerror = error => {
    if (error instanceof TypeError) stopped(DISCONNECTED);
    if (error instanceof StreamableHTTPError && error.code === 404) stopped(EXPIRED);
  };
  addEventListener("pagehide", hide);

  try {
    await client.connect(transport);
    heartbeat = setInterval(() => { void check(); }, 30_000);
    const { tools } = await client.listTools();
    const tool = tools.find(candidate => candidate.name === toolName);
    const uri = tool && getToolUiResourceUri(tool);
    if (tool === undefined || uri === undefined) throw new Error(`Mobile Dev has no panel for ${toolName}.`);
    const resource = await client.readResource({ uri });
    const [content] = resource.contents;
    if (content === undefined || ("text" in content) === false) throw new Error("Mobile Dev's panel could not load.");

    const frame = document.createElement("iframe");
    frame.title = "Mobile Dev";
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-downloads");
    frame.allow = "clipboard-write";
    document.body.replaceChildren(frame);
    const context = (): McpUiHostContext => ({
      theme: dark.matches ? "dark" : "light", displayMode: "inline", availableDisplayModes: ["inline"],
      platform: "desktop", locale: navigator.language, toolInfo: { tool },
    });
    const host = document.documentElement.dataset.telemetryHost ?? "other";
    // Advertise only capabilities this browser can fulfill. Chat messages need a
    // host-owned bridge; model context goes to the server, where the agent reads it.
    const hostContext = context();
    const capabilities = { serverTools: {}, serverResources: {}, openLinks: {}, updateModelContext: { text: {}, image: {} } };
    bridge = new AppBridge(client, { name: host, version: PLUGIN_VERSION }, capabilities, { hostContext });
    bridge.onupdatemodelcontext = async ({ content }) => {
      const sessionId = transport.sessionId;
      if (sessionId === undefined) throw new Error("Mobile Dev's browser connection is not ready.");
      const response = await fetch(new URL("context", location.href), {
        method: "PUT", headers: { "content-type": "application/json", "mcp-session-id": sessionId },
        body: JSON.stringify({ content: content ?? [] }),
      });
      if (response.status === 404) stopped(EXPIRED);
      if (response.ok === false) throw new Error(`Mobile Dev could not share this with the chat (${response.status}).`);
      return {};
    };
    bridge.onopenlink = async ({ url }) => {
      const destination = new URL(url, location.href);
      if (destination.protocol !== "https:" && destination.protocol !== "http:") {
        throw new Error("Only web links can open from Mobile Dev.");
      }
      window.open(destination.href, "_blank", "noopener");
      return {};
    };
    bridge.onrequestdisplaymode = async () => ({ mode: "inline" });
    contextChanged = () => {
      const updated = context();
      bridge?.setHostContext(updated);
    };
    dark.addEventListener("change", contextChanged);
    const initialized = new Promise<void>((resolve, reject) => {
      startup = setTimeout(() => {
        const error = new Error("Mobile Dev's panel did not finish opening. Reload this page to try again.");
        reject(error);
      }, 15_000);
      bridge!.oninitialized = () => { clearTimeout(startup); resolve(); };
    });
    const frameWindow = frame.contentWindow!;
    const frameTransport = new PostMessageTransport(frameWindow, frameWindow);
    await bridge.connect(frameTransport);
    frame.srcdoc = content.text;
    await initialized;
    await bridge.sendToolInput({ arguments: target });
    const result = await client.callTool({ name: toolName, arguments: target });
    await bridge.sendToolResult(result as CallToolResult);
  } catch (error) {
    if (disposed === false) {
      dispose();
      throw error;
    }
  }
}

open().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  notice(`Mobile Dev could not open: ${message}`);
});
