import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { getUiCapability } from "@modelcontextprotocol/ext-apps/server";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { PanelTarget } from "@mobile-dev/shared/panel-target.ts";
import { telemetryHost, type TelemetryHost } from "@mobile-dev/shared/telemetry.ts";
import type { ServerFeature } from "./server-feature.ts";
import type { SharedTransport } from "./shared-transport.ts";
import { captureServerError, recordBrowserPanelSessions } from "./telemetry.ts";

const PAGE = new URL("./browser-panel.html", import.meta.url);
export const BROWSER_SESSION_IDLE_MS = 5 * 60_000;

type BrowserSession = { transport: StreamableHTTPServerTransport; touched: number; requests: number };
type PanelPage = { url(tool: string, target: PanelTarget): string; close(): Promise<void> };

/** Hosts without MCP Apps can show the shared panel on a session-owned loopback page. */
export function browserPanel(template: URL = PAGE): ServerFeature {
  return (server, { connections, onPanelOpen }) => {
    let page: Promise<PanelPage> | undefined;
    onPanelOpen(async ({ tool, target }) => {
      const capabilities = server.server.getClientCapabilities();
      if (connections === undefined || getUiCapability(capabilities)) return;
      const clientInfo = server.server.getClientVersion();
      const host = telemetryHost(clientInfo?.name);
      page ??= startPanelPage(connections, host, template);
      const opened = await page;
      const url = opened.url(tool, target);
      return `This host shows no Mobile Dev panel. Show it beside the chat by opening ${url} in your in-app browser or side panel. If you cannot open pages, give the user the link.`;
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
    reply(response, 404);
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

function reply(response: ServerResponse, status: number, headers: Record<string, string> = {}) {
  response.writeHead(status, { "cache-control": "no-store", ...headers });
  response.end();
}
