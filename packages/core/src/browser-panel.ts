import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { getUiCapability } from "@modelcontextprotocol/ext-apps/server";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { ImageContent, TextContent } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { PanelTarget } from "@mobile-dev/shared/panel-target.ts";
import { telemetryHost, type TelemetryHost } from "@mobile-dev/shared/telemetry.ts";
import type { ServerFeature } from "./server-feature.ts";
import type { SharedTransport } from "./shared-transport.ts";
import { captureServerError, recordBrowserPanelContext, recordBrowserPanelSessions } from "./telemetry.ts";

const PAGE = new URL("./browser-panel.html", import.meta.url);
export const BROWSER_SESSION_IDLE_MS = 5 * 60_000;
// Screenshots the user adds to chat travel as base64 images.
export const BROWSER_CONTEXT_MAX_BYTES = 16 * 1024 * 1024;
const NO_CONTEXT = "No Mobile Dev browser panel has shared context. Open Mobile Dev, or ask the user to select a device in the panel.";

type PanelContent = TextContent | ImageContent;
type BrowserSession = { transport: StreamableHTTPServerTransport; touched: number; requests: number; context?: { content: PanelContent[]; updated: number } };
type PanelPage = { url(tool: string, target: PanelTarget): string; context(): PanelContent[]; close(): Promise<void> };

// What a panel would otherwise give an MCP Apps host's model context. Hosts mark
// audience and other annotations; the agent reads only text and images.
const contextSchema = z.object({
  content: z.array(z.union([
    z.object({ type: z.literal("text"), text: z.string() }),
    z.object({ type: z.literal("image"), data: z.string(), mimeType: z.string().regex(/^image\/[\w.+-]+$/) }),
  ])).max(64).default([]),
});

export type BrowserPanelOptions = {
  template?: URL;
  /**
   * Offers the page to every host, also those that render MCP Apps in the chat, for a
   * server whose panel does not render inline (see createPanel's `inline`).
   */
  always?: boolean;
};

/** Hosts without MCP Apps, or every host with `always`, can show the shared panel on a session-owned loopback page. */
export function browserPanel({ template = PAGE, always = false }: BrowserPanelOptions = {}): ServerFeature {
  return (server, { connections, onPanelOpen }) => {
    let page: Promise<PanelPage> | undefined;
    onPanelOpen(async ({ tool, target }) => {
      const capabilities = server.server.getClientCapabilities();
      if (connections === undefined || (always === false && getUiCapability(capabilities))) return;
      const clientInfo = server.server.getClientVersion();
      const host = telemetryHost(clientInfo?.name);
      page ??= startPanelPage(connections, host, template);
      const opened = await page;
      const url = opened.url(tool, target);
      const instructions = `Mobile Dev's panel is a page to show beside the chat, not in it, and it is not open yet. Show it to the user now: open ${url} in your in-app browser or side panel, in the foreground, so the page is visible without another click. Opening a page can leave the browser pane hidden: when your host has a tool that brings its browser or preview pane into view, such as a show_pane tool for its preview pane, load it if needed and call it right after. Reuse a tab that already shows Mobile Dev. Open no other address for it, such as the backend's baseUrl. If you cannot open pages, give the user the link. The page shares the user's devices and what they add to chat through mobile_read_panel_context; read it before device work.`;
      return { url, instructions };
    });
    // A browser has no model context of its own, so the agent asks the server for it.
    server.registerTool("mobile_read_panel_context", {
      title: "Read Mobile Dev panel context",
      description: "Read what a Mobile Dev panel opened in a browser shares with the chat: the active and visible device IDs, and logs, screenshots and screen notes the user added to chat. Call it before device work and when the user refers to something in the panel. Hosts that render the panel in the chat share this directly.",
      inputSchema: {}, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    }, async () => {
      const opened = await page?.catch(() => undefined);
      const content = opened?.context() ?? [];
      return { content: content.length ? content : [{ type: "text", text: NO_CONTEXT }] };
    });
    return async () => {
      const opened = await page?.catch(() => undefined);
      await opened?.close();
    };
  };
}

export async function startPanelPage(connections: SharedTransport, host: TelemetryHost, page: URL = PAGE): Promise<PanelPage> {
  const template = await readFile(page, "utf8");
  const html = template.replace("<html", `<html data-telemetry-host="${host}"`);
  const entropy = randomBytes(24);
  const token = entropy.toString("base64url");
  const base = `/${token}/`;
  const sessions = new Map<string, BrowserSession>();
  let closing = false;
  const http = createServer((request, response) => {
    handle(request, response).catch(error => {
      captureServerError(error, "browser_panel.request");
      if (response.headersSent) response.destroy();
      else reply(response, 500);
    });
  });
  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(0, "127.0.0.1", () => { http.off("error", reject); resolve(); });
  });
  const { port } = http.address() as AddressInfo;
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  const origins = hosts.map(host => `http://${host}`);
  const expiry = setInterval(() => {
    const cutoff = Date.now() - BROWSER_SESSION_IDLE_MS;
    for (const session of sessions.values()) {
      if (session.requests > 0 || session.touched > cutoff) continue;
      void session.transport.close().catch(error => captureServerError(error, "browser_panel.close"));
    }
  }, 30_000);
  expiry.unref();

  async function handle(request: IncomingMessage, response: ServerResponse) {
    if (closing) return reply(response, 503);
    // Reject cross-origin browser requests and DNS rebinding, even with a valid path.
    const origin = request.headers.origin;
    if (hosts.includes(request.headers.host ?? "") === false) return reply(response, 403);
    if (origin !== undefined && origins.includes(origin) === false) return reply(response, 403);
    const path = new URL(request.url ?? "/", origins[0]).pathname;
    if (path === base && request.method === "GET") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff", "content-security-policy": "frame-ancestors 'none'; base-uri 'none'",
      });
      response.end(html);
      return;
    }
    if (path === `${base}mcp`) return mcp(request, response);
    if (path === `${base}context`) return context(request, response);
    reply(response, 404);
  }

  // The page replaces its tab's context, as ui/update-model-context does in a chat host.
  async function context(request: IncomingMessage, response: ServerResponse) {
    if (request.method !== "PUT") return reply(response, 405, { allow: "PUT" });
    const sessionId = request.headers["mcp-session-id"];
    const session = typeof sessionId === "string" ? sessions.get(sessionId) : undefined;
    if (session === undefined) return reply(response, 404);
    if (request.headers["content-type"]?.startsWith("application/json") !== true) return reply(response, 415);
    const body = await readBody(request, BROWSER_CONTEXT_MAX_BYTES);
    if (body === undefined) {
      recordBrowserPanelContext("too_large");
      return reply(response, 413, { connection: "close" });
    }
    let parsed;
    try { parsed = contextSchema.safeParse(JSON.parse(body.toString("utf8"))); }
    catch { parsed = undefined; }
    if (parsed?.success !== true) {
      recordBrowserPanelContext("invalid");
      return reply(response, 400);
    }
    session.context = { content: parsed.data.content, updated: Date.now() };
    session.touched = Date.now();
    recordBrowserPanelContext("stored", body.byteLength);
    reply(response, 204);
  }

  async function mcp(request: IncomingMessage, response: ServerResponse) {
    // No idle SSE connection: streams and panel requests share the browser's connection budget.
    if (request.method === "GET") return reply(response, 405, { allow: "POST, DELETE" });
    const sessionId = request.headers["mcp-session-id"];
    if (sessionId !== undefined) {
      const session = typeof sessionId === "string" ? sessions.get(sessionId) : undefined;
      if (session === undefined) return reply(response, 404);
      session.requests++;
      try { await session.transport.handleRequest(request, response); }
      finally { session.requests--; session.touched = Date.now(); }
      return;
    }
    const transport = new StreamableHTTPServerTransport({
      // Per-request SSE supports associated server requests and releases completed streams.
      sessionIdGenerator: randomUUID,
      onsessioninitialized: id => {
        sessions.set(id, { transport, touched: Date.now(), requests: 0 });
        recordBrowserPanelSessions(sessions.size);
      },
    });
    transport.onclose = () => {
      if (transport.sessionId === undefined) return;
      if (sessions.delete(transport.sessionId)) recordBrowserPanelSessions(sessions.size);
    };
    await connections.attach(transport);
    try { await transport.handleRequest(request, response); }
    finally {
      // Invalid or non-initialize requests must not leave a transport attached.
      if (transport.sessionId === undefined) await transport.close();
    }
  }

  return {
    url(tool, target) {
      const query = new URLSearchParams({ tool });
      const entries = Object.entries(target);
      for (const [key, value] of entries) {
        if (typeof value === "string") query.set(key, value);
      }
      return `${origins[0]}${base}?${query}`;
    },
    context() {
      // The most recently updated tab comes first; each open tab keeps its own.
      const shared = Array.from(sessions.values()).flatMap(session => session.context ? [session.context] : []);
      shared.sort((a, b) => b.updated - a.updated);
      return shared.flatMap((context, index) => {
        if (context.content.length === 0) return [];
        const heading: PanelContent = { type: "text", text: shared.length > 1 ? `Mobile Dev browser tab ${index + 1} of ${shared.length}, most recent first.` : "Mobile Dev browser panel." };
        return [heading, ...context.content];
      });
    },
    async close() {
      closing = true;
      clearInterval(expiry);
      const stopped = new Promise<void>(resolve => http.close(() => resolve()));
      const connectionsClosing = Array.from(sessions.values(), session => session.transport.close());
      await Promise.allSettled(connectionsClosing);
      http.closeAllConnections();
      await stopped;
    },
  };
}

async function readBody(request: IncomingMessage, limit: number): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.byteLength;
    if (size > limit) return undefined;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function reply(response: ServerResponse, status: number, headers: Record<string, string> = {}) {
  response.writeHead(status, { "cache-control": "no-store", ...headers });
  response.end();
}
