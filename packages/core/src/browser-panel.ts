import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { getUiCapability } from "@modelcontextprotocol/ext-apps/server";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { PanelTarget } from "@mobile-dev/shared/panel-target.ts";
import { telemetryHost } from "@mobile-dev/shared/telemetry.ts";
import type { ServerFeature } from "./server-feature.ts";
import type { SharedTransport } from "./shared-transport.ts";
import { captureServerError } from "./telemetry.ts";

const PAGE = new URL("./browser-panel.html", import.meta.url);

/**
 * Shows the panel as a local web page in hosts that render no MCP Apps panel but
 * can open a browser beside the chat. The page is a small MCP Apps host: it loads
 * the same panel and reaches this server over HTTP, joining the host's session, so
 * the panel and the agent share devices, streams and logs.
 *
 * The page server starts when such a host first opens the panel. It listens on
 * loopback only, behind a random path, and accepts only its own Host and Origin.
 */
export const browserPanel: ServerFeature = (server, { connections, onPanelOpen }) => {
  let page: Promise<PanelPage> | undefined;
  onPanelOpen(async ({ tool, target }) => {
    if (!connections || getUiCapability(server.server.getClientCapabilities())) return;
    const host = telemetryHost(server.server.getClientVersion()?.name);
    const url = (await (page ??= startPanelPage(connections, host))).url(tool, target);
    return `This host shows no Mobile Dev panel. Show it beside the chat by opening ${url} in your in-app browser or side panel. If you cannot open pages, give the user the link.`;
  });
  return async () => { await (await page?.catch(() => undefined))?.close(); };
};

type PanelPage = { url(tool: string, target: PanelTarget): string; close(): Promise<void> };

export async function startPanelPage(connections: SharedTransport, host: string, page: URL = PAGE): Promise<PanelPage> {
  const base = `/${randomBytes(24).toString("base64url")}/`;
  const sessions = new Map<string, StreamableHTTPServerTransport>();
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

  async function handle(request: IncomingMessage, response: ServerResponse) {
    // Other sites in the user's browser and rebound DNS names cannot reach the page or its session.
    const origin = request.headers.origin;
    if (!hosts.includes(request.headers.host ?? "") || origin !== undefined && !origins.includes(origin)) return reply(response, 403);
    const path = new URL(request.url ?? "/", origins[0]).pathname;
    if (path === base && request.method === "GET") {
      const html = (await readFile(page, "utf8")).replace("<html", `<html data-telemetry-host="${host}"`);
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" });
      response.end(html);
      return;
    }
    if (path === `${base}mcp`) return mcp(request, response);
    reply(response, 404);
  }

  async function mcp(request: IncomingMessage, response: ServerResponse) {
    // The panel needs no server-initiated stream, and an idle one would hold one of
    // the few connections a browser opens to an origin.
    if (request.method === "GET") return reply(response, 405, { allow: "POST, DELETE" });
    const sessionId = request.headers["mcp-session-id"];
    if (sessionId !== undefined) {
      const session = typeof sessionId === "string" ? sessions.get(sessionId) : undefined;
      if (!session) return reply(response, 404);
      return session.handleRequest(request, response);
    }
    const session: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID, enableJsonResponse: true,
      onsessioninitialized: id => { sessions.set(id, session); },
    });
    session.onclose = () => { if (session.sessionId) sessions.delete(session.sessionId); };
    await connections.attach(session);
    await session.handleRequest(request, response);
    // Only an initialize request starts a session.
    if (session.sessionId === undefined) await session.close();
  }

  return {
    url(tool, target) {
      const query = new URLSearchParams({ tool });
      for (const [key, value] of Object.entries(target)) if (typeof value === "string") query.set(key, value);
      return `${origins[0]}${base}?${query}`;
    },
    async close() {
      await Promise.allSettled([...sessions.values()].map(session => session.close()));
      http.closeAllConnections();
      await new Promise<void>(resolve => http.close(() => resolve()));
    },
  };
}

function reply(response: ServerResponse, status: number, headers: Record<string, string> = {}) {
  response.writeHead(status, headers).end();
}
