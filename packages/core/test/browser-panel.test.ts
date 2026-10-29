import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListRootsRequestSchema, ListRootsResultSchema, type ClientCapabilities } from "@modelcontextprotocol/sdk/types.js";
import { EXTENSION_ID, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { Baguette } from "../src/baguette.ts";
import { BROWSER_CONTEXT_MAX_BYTES, BROWSER_SESSION_IDLE_MS, browserPanel, startPanelPage } from "../src/browser-panel.ts";
import { SharedTransport } from "../src/shared-transport.ts";
import { createTestPlugin, fakeBaguette, fakeSimulatorInput } from "../../test-support/fixtures.ts";

/** A server whose tools report which client the server believes it serves. */
async function sharedServer(capabilities: ClientCapabilities = {}) {
  const server = new McpServer({ name: "shared-test", version: "1" });
  let started!: () => void;
  const waiting = new Promise<void>(resolve => { started = resolve; });
  let aborted!: () => void;
  const cancelled = new Promise<void>(resolve => { aborted = resolve; });
  server.registerTool("client", { inputSchema: {} }, async () => ({ content: [{ type: "text", text: server.server.getClientVersion()?.name ?? "" }] }));
  server.registerTool("wait", { inputSchema: {} }, (_input, extra) => new Promise(resolve => {
    extra.signal.addEventListener("abort", () => { aborted(); resolve({ content: [] }); });
    started();
  }));
  server.registerTool("roots", { inputSchema: {} }, async (_input, extra) => {
    const roots = await extra.sendRequest({ method: "roots/list" }, ListRootsResultSchema, { timeout: 1000 });
    const text = JSON.stringify(roots);
    return { content: [{ type: "text", text }] };
  });
  const [hostSide, serverSide] = InMemoryTransport.createLinkedPair();
  const shared = new SharedTransport(serverSide);
  await server.connect(shared);
  const host = new Client({ name: "chat-host", version: "1" }, { capabilities });
  await host.connect(hostSide);
  return { server, shared, host, waiting, cancelled };
}

async function connect(shared: SharedTransport, name = "panel") {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await shared.attach(serverSide);
  const client = new Client({ name, version: "1" });
  await client.connect(clientSide);
  return { client, serverSide };
}

test("another connection shares the host's server without replacing its client", async t => {
  const { server, shared, host } = await sharedServer();
  t.after(() => server.close());
  const panel = await connect(shared);
  // Both clients number their requests from the same start, so their IDs collide.
  const [fromHost, fromPanel] = await Promise.all([
    host.callTool({ name: "client", arguments: {} }),
    panel.client.callTool({ name: "client", arguments: {} }),
  ]);
  assert.deepEqual(fromHost.content, [{ type: "text", text: "chat-host" }]);
  assert.deepEqual(fromPanel.content, [{ type: "text", text: "chat-host" }]);
  assert.equal(panel.client.getServerVersion()?.name, "shared-test");
  assert.equal(server.server.getClientVersion()?.name, "chat-host");
});

test("closing a connection cancels the requests it left unanswered", async t => {
  const { server, shared, host, waiting, cancelled } = await sharedServer();
  t.after(() => server.close());
  const panel = await connect(shared);
  void panel.client.callTool({ name: "wait", arguments: {} }).catch(() => undefined);
  await waiting;
  await panel.serverSide.close();
  await cancelled;
  // The host's session is unaffected.
  assert.deepEqual((await host.callTool({ name: "client", arguments: {} })).content, [{ type: "text", text: "chat-host" }]);
});

test("a connection joining before the host initializes is refused", async t => {
  const server = new McpServer({ name: "shared-test", version: "1" });
  const [, serverSide] = InMemoryTransport.createLinkedPair();
  const shared = new SharedTransport(serverSide);
  await server.connect(shared);
  t.after(() => server.close());
  await assert.rejects(connect(shared), /has not connected/);
});

function send(url: URL, headers: Record<string, string>, method = "GET") {
  return new Promise<number>((resolve, reject) => {
    request(url, { method, headers }, response => { response.resume(); resolve(response.statusCode ?? 0); }).on("error", reject).end();
  });
}

test("the panel page reaches the shared session only from its own origin and path", async t => {
  const { server, shared } = await sharedServer();
  const directory = await mkdtemp(join(tmpdir(), "browser-panel-"));
  const page = join(directory, "browser-panel.html");
  await writeFile(page, "<!doctype html><html lang=\"en\"><body></body></html>");
  const panelPage = await startPanelPage(shared, "claude", pathToFileURL(page));
  t.after(async () => { await panelPage.close(); await server.close(); await rm(directory, { recursive: true, force: true }); });

  const url = new URL(panelPage.url("mobile_open_simulator", { platform: "ios" }));
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.searchParams.get("tool"), "mobile_open_simulator");
  assert.equal(url.searchParams.get("platform"), "ios");
  const html = await fetch(url);
  assert.equal(html.status, 200);
  assert.equal(html.headers.get("cache-control"), "no-store");
  assert.match(await html.text(), /<html data-telemetry-host="claude" lang="en">/);

  assert.equal(await send(new URL("/", url), {}), 404);
  assert.equal(await send(new URL("/other/", url), {}), 404);
  assert.equal(await send(url, { host: `attacker.example:${url.port}` }), 403);
  assert.equal(await send(url, { origin: "https://attacker.example" }), 403);
  assert.equal(await send(new URL("mcp", url), {}), 405);
  assert.equal(await send(new URL("mcp", url), { "mcp-session-id": "missing" }, "POST"), 404);

  const panel = new Client({ name: "browser-panel", version: "1" });
  const transport = new StreamableHTTPClientTransport(new URL("mcp", url));
  await panel.connect(transport);
  assert.deepEqual((await panel.callTool({ name: "client", arguments: {} })).content, [{ type: "text", text: "chat-host" }]);
  await transport.terminateSession();
  await panel.close();
});

test("opening the panel links the browser page only for hosts without MCP Apps", async t => {
  const directory = await mkdtemp(join(tmpdir(), "browser-panel-"));
  const page = join(directory, "browser-panel.html");
  await writeFile(page, "<html></html>");
  t.after(() => rm(directory, { recursive: true, force: true }));
  const template = pathToFileURL(page);
  const panelFeature = browserPanel(template);
  const fake = await fakeBaguette();
  t.after(() => fake.close());
  for (const ui of [false, true]) {
    const [hostSide, serverSide] = InMemoryTransport.createLinkedPair();
    const shared = new SharedTransport(serverSide);
    const plugin = await createTestPlugin("<html></html>", { baguette: new Baguette(fake.url), simulatorInput: fakeSimulatorInput(), features: [panelFeature], connections: shared });
    const capabilities = ui ? { extensions: { [EXTENSION_ID]: { mimeTypes: [RESOURCE_MIME_TYPE] } } } : {};
    const host = new Client({ name: "claude-code", version: "1" }, { capabilities });
    await plugin.server.connect(shared);
    await host.connect(hostSide);
    for (const name of ["mobile_open_simulator", "mobile_open_workspace"]) {
      const result = await host.callTool({ name, arguments: { platform: "android" } });
      const texts = (result.content as Array<{ text: string }>).map(item => item.text);
      if (ui) { assert.equal(texts.length, 1); continue; }
      assert.equal(texts.length, 2);
      const link = new URL(texts[1].match(/http:\/\/127\.0\.0\.1:\d+\/[\w-]+\/\?\S+/)![0]);
      assert.equal(link.searchParams.get("tool"), name);
      assert.equal(link.searchParams.get("platform"), "android");
    }
    await host.close();
    await plugin.close();
  }
});

test("abandoned browser sessions expire while active tabs keep their own session", async t => {
  const { server, shared, host } = await sharedServer();
  const directory = await mkdtemp(join(tmpdir(), "browser-panel-"));
  const file = join(directory, "browser-panel.html");
  await writeFile(file, "<html></html>");
  const template = pathToFileURL(file);
  t.mock.timers.enable({ apis: ["Date", "setInterval"] });
  const page = await startPanelPage(shared, "other", template);
  const address = page.url("mobile_open_simulator", {});
  const endpoint = new URL("mcp", address);
  const abandoned = new Client({ name: "abandoned", version: "1" });
  const active = new Client({ name: "active", version: "1" });
  const abandonedTransport = new StreamableHTTPClientTransport(endpoint);
  const activeTransport = new StreamableHTTPClientTransport(endpoint);
  t.after(async () => {
    await abandoned.close();
    await active.close();
    await page.close();
    await server.close();
    await rm(directory, { recursive: true, force: true });
  });
  await abandoned.connect(abandonedTransport);
  await active.connect(activeTransport);
  const abandonedId = abandonedTransport.sessionId!;
  t.mock.timers.tick(BROWSER_SESSION_IDLE_MS - 60_000);
  await active.ping();
  t.mock.timers.tick(90_000);
  const expired = await send(endpoint, { "mcp-session-id": abandonedId }, "POST");
  assert.equal(expired, 404);
  await active.ping();
  await host.ping();
  await activeTransport.terminateSession();
});

test("a long browser request keeps its session alive until completion or cancellation", async t => {
  const { server, shared, waiting, cancelled } = await sharedServer();
  const directory = await mkdtemp(join(tmpdir(), "browser-panel-"));
  const file = join(directory, "browser-panel.html");
  await writeFile(file, "<html></html>");
  const template = pathToFileURL(file);
  t.mock.timers.enable({ apis: ["Date", "setInterval"] });
  const page = await startPanelPage(shared, "other", template);
  const address = page.url("mobile_open_simulator", {});
  const endpoint = new URL("mcp", address);
  const client = new Client({ name: "active", version: "1" });
  const transport = new StreamableHTTPClientTransport(endpoint);
  const controller = new AbortController();
  t.after(async () => {
    controller.abort();
    await client.close();
    await page.close();
    await server.close();
    await rm(directory, { recursive: true, force: true });
  });
  await client.connect(transport);
  const pending = client.callTool({ name: "wait", arguments: {} }, undefined, { signal: controller.signal });
  const settled = pending.catch(() => undefined);
  await waiting;
  t.mock.timers.tick(BROWSER_SESSION_IDLE_MS + 60_000);
  await client.ping();
  controller.abort();
  await cancelled;
  await settled;
  await client.ping();
  await transport.terminateSession();
});

test("a browser tool call can answer an associated server request over HTTP", async t => {
  const { server, shared, host } = await sharedServer({ roots: {} });
  const directory = await mkdtemp(join(tmpdir(), "browser-panel-"));
  const file = join(directory, "browser-panel.html");
  await writeFile(file, "<html></html>");
  const template = pathToFileURL(file);
  const page = await startPanelPage(shared, "other", template);
  const address = page.url("mobile_open_simulator", {});
  const endpoint = new URL("mcp", address);
  const client = new Client({ name: "browser-roots", version: "1" }, { capabilities: { roots: {} } });
  const transport = new StreamableHTTPClientTransport(endpoint);
  let hostRequests = 0;
  host.setRequestHandler(ListRootsRequestSchema, async () => { hostRequests++; return { roots: [] }; });
  client.setRequestHandler(ListRootsRequestSchema, async () => ({ roots: [{ uri: "file:///browser-root" }] }));
  t.after(async () => {
    await client.close();
    await page.close();
    await server.close();
    await rm(directory, { recursive: true, force: true });
  });
  await client.connect(transport);
  const result = await client.callTool({ name: "roots", arguments: {} });
  assert.equal(result.isError, undefined);
  assert.deepEqual(result.content, [{ type: "text", text: '{"roots":[{"uri":"file:///browser-root"}]}' }]);
  assert.equal(hostRequests, 0);
  await transport.terminateSession();
});

function putContext(endpoint: URL, sessionId: string | undefined, body: string, headers: Record<string, string> = {}) {
  return fetch(endpoint, {
    method: "PUT", body,
    headers: { "content-type": "application/json", ...(sessionId ? { "mcp-session-id": sessionId } : {}), ...headers },
  });
}

test("a browser tab's model context reaches the agent and leaves with the tab", async t => {
  const directory = await mkdtemp(join(tmpdir(), "browser-panel-"));
  const page = join(directory, "browser-panel.html");
  await writeFile(page, "<html></html>");
  const fake = await fakeBaguette();
  const [hostSide, serverSide] = InMemoryTransport.createLinkedPair();
  const shared = new SharedTransport(serverSide);
  const plugin = await createTestPlugin("<html></html>", { baguette: new Baguette(fake.url), simulatorInput: fakeSimulatorInput(), features: [browserPanel(pathToFileURL(page))], connections: shared });
  const host = new Client({ name: "claude-code", version: "1" });
  await plugin.server.connect(shared);
  await host.connect(hostSide);
  t.after(async () => { await host.close(); await plugin.close(); await fake.close(); await rm(directory, { recursive: true, force: true }); });

  const read = async () => (await host.callTool({ name: "mobile_read_panel_context", arguments: {} })).content as Array<{ type: string; text?: string; data?: string }>;
  assert.match((await read())[0].text!, /No Mobile Dev browser panel/);
  const opened = await host.callTool({ name: "mobile_open_simulator", arguments: {} });
  const texts = (opened.content as Array<{ text: string }>).map(item => item.text);
  assert.match(texts[1], /in the foreground/);
  assert.match(texts[1], /mobile_read_panel_context/);
  const link = new URL(texts[1].match(/http:\/\/127\.0\.0\.1:\d+\/[\w-]+\/\?\S+/)![0]);
  const endpoint = new URL("context", link);

  const tabs = [new StreamableHTTPClientTransport(new URL("mcp", link)), new StreamableHTTPClientTransport(new URL("mcp", link))];
  const clients = tabs.map((_, index) => new Client({ name: `tab-${index}`, version: "1" }));
  for (const [index, client] of clients.entries()) await client.connect(tabs[index]);
  const [first, second] = tabs.map(tab => tab.sessionId!);

  assert.equal((await putContext(endpoint, undefined, "{}")).status, 404);
  assert.equal((await putContext(endpoint, "missing", "{}")).status, 404);
  assert.equal((await putContext(endpoint, first, "{}", { "content-type": "text/plain" })).status, 415);
  assert.equal((await putContext(endpoint, first, "not json")).status, 400);
  assert.equal((await putContext(endpoint, first, JSON.stringify({ content: [{ type: "image", data: "x", mimeType: "text/html" }] }))).status, 400);
  assert.equal((await fetch(endpoint, { method: "PUT", body: "{}", headers: { "content-type": "application/json", "mcp-session-id": first, origin: "https://attacker.example" } })).status, 403);
  assert.equal((await fetch(endpoint, { headers: { "mcp-session-id": first } })).status, 405);

  const device = "Active iOS simulator: iPhone 17. Device ID: 11111111-1111-1111-1111-111111111111.";
  const stored = await putContext(endpoint, first, JSON.stringify({ content: [{ type: "text", text: device, annotations: { audience: ["assistant"] } }] }));
  assert.equal(stored.status, 204);
  assert.deepEqual(await read(), [{ type: "text", text: "Mobile Dev browser panel." }, { type: "text", text: device }]);

  await new Promise(resolve => setTimeout(resolve, 5));
  const screenshot = { type: "image", data: "aGVsbG8=", mimeType: "image/png" };
  assert.equal((await putContext(endpoint, second, JSON.stringify({ content: [screenshot] }))).status, 204);
  const both = await read();
  assert.equal(both.length, 4);
  assert.match(both[0].text!, /tab 1 of 2/);
  assert.equal(both[1].data, screenshot.data);
  assert.equal(both[3].text, device);

  // Closing a tab removes what it shared; an empty update clears without closing.
  await tabs[1].terminateSession();
  assert.deepEqual((await read()).map(item => item.text), ["Mobile Dev browser panel.", device]);
  assert.equal((await putContext(endpoint, first, JSON.stringify({ content: [] }))).status, 204);
  assert.match((await read())[0].text!, /No Mobile Dev browser panel/);
  await tabs[0].terminateSession();
  for (const client of clients) await client.close();
});

test("an oversized browser context update is refused without storing it", async t => {
  const { server, shared } = await sharedServer();
  const directory = await mkdtemp(join(tmpdir(), "browser-panel-"));
  const file = join(directory, "browser-panel.html");
  await writeFile(file, "<html></html>");
  const page = await startPanelPage(shared, "claude", pathToFileURL(file));
  const address = page.url("mobile_open_simulator", {});
  const client = new Client({ name: "large", version: "1" });
  const transport = new StreamableHTTPClientTransport(new URL("mcp", address));
  t.after(async () => { await client.close(); await page.close(); await server.close(); await rm(directory, { recursive: true, force: true }); });
  await client.connect(transport);
  const text = "x".repeat(BROWSER_CONTEXT_MAX_BYTES);
  const response = await putContext(new URL("context", address), transport.sessionId, JSON.stringify({ content: [{ type: "text", text }] }));
  assert.equal(response.status, 413);
  assert.deepEqual(page.context(), []);
  await transport.terminateSession();
});
