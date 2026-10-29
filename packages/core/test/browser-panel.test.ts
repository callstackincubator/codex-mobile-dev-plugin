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
import { EXTENSION_ID, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { Baguette } from "../src/baguette.ts";
import { browserPanel, startPanelPage } from "../src/browser-panel.ts";
import { SharedTransport } from "../src/shared-transport.ts";
import { createTestPlugin, fakeBaguette, fakeSimulatorInput } from "../../test-support/fixtures.ts";

/** A server whose tools report which client the server believes it serves. */
async function sharedServer() {
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
  const [hostSide, serverSide] = InMemoryTransport.createLinkedPair();
  const shared = new SharedTransport(serverSide);
  await server.connect(shared);
  const host = new Client({ name: "chat-host", version: "1" });
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
  const fake = await fakeBaguette();
  t.after(() => fake.close());
  for (const ui of [false, true]) {
    const [hostSide, serverSide] = InMemoryTransport.createLinkedPair();
    const shared = new SharedTransport(serverSide);
    const plugin = await createTestPlugin("<html></html>", { baguette: new Baguette(fake.url), simulatorInput: fakeSimulatorInput(), features: [browserPanel], connections: shared });
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
