import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { browserPanel } from "../../../packages/core/src/browser-panel.ts";
import { SharedTransport } from "../../../packages/core/src/shared-transport.ts";
import type { PanelOpen } from "../../../packages/core/src/server-feature.ts";

test("sidecar proxy replaces superseded sessions and closes sessions on beacon", async t => {
  const fakeHome = await mkdtemp(join(tmpdir(), "mobile-dev-sidecar-test-"));
  t.after(() => rm(fakeHome, { recursive: true, force: true }));
  const cacheDir = join(fakeHome, "Library", "Caches", "mobile-dev");
  await mkdir(cacheDir, { recursive: true });
  const statePath = join(cacheDir, "antigravity-panel.json");

  const server = new McpServer({ name: "mobile-dev-test", version: "1.0.0" });
  const [hostSide, serverSide] = InMemoryTransport.createLinkedPair();
  const connections = new SharedTransport(serverSide);
  const openers: PanelOpen[] = [];
  const template = new URL("../../../packages/mcp-app/src/browser-panel.html", import.meta.url);
  let writeQueue: Promise<void> = Promise.resolve();
  const stopPanel = browserPanel({
    always: true,
    template,
    onPage: url => {
      const run = async () => {
        const tmpPath = `${statePath}.${process.pid}.tmp`;
        await writeFile(tmpPath, JSON.stringify({ pid: process.pid, url, updatedAt: Date.now() }) + "\n");
        await rename(tmpPath, statePath);
      };
      writeQueue = writeQueue.then(run, run);
      return writeQueue;
    },
  })(server, {
    connections,
    onPanelOpen: opener => { openers.push(opener); },
  });
  t.after(async () => {
    await stopPanel?.();
    await server.close();
  });

  server.registerTool("mobile_open_simulator", { inputSchema: {} }, async () => {
    for (const open of openers) await open({ tool: "mobile_open_simulator", target: { platform: "android" } });
    return { content: [{ type: "text", text: "opened" }] };
  });
  server.registerTool("slow_ping", { inputSchema: {} }, async () => {
    await new Promise(r => setTimeout(r, 250));
    return { content: [{ type: "text", text: "pong" }] };
  });

  await server.connect(connections);
  const hostClient = new Client({ name: "antigravity-test", version: "1.0.0" });
  await hostClient.connect(hostSide);
  t.after(() => hostClient.close());
  await hostClient.callTool({ name: "mobile_open_simulator", arguments: {} });

  const token = "test-sidecar-secret";
  const sidecar = spawn(process.execPath, [resolve("apps/antigravity/sidecars/launch.mjs")], {
    env: {
      ...process.env,
      HOME: fakeHome,
      ANTIGRAVITY_SIDECAR_WEB_PORT: "0",
      ANTIGRAVITY_SIDECAR_UI_TOKEN: token,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => { sidecar.kill("SIGTERM"); });

  const port = await new Promise<number>((resolvePort, reject) => {
    let stderr = "";
    sidecar.stderr.on("data", chunk => {
      stderr += chunk.toString();
      const match = stderr.match(/Listening on http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) resolvePort(Number(match[1]));
    });
    sidecar.once("exit", code => reject(new Error(`Sidecar exited early: ${code}\n${stderr}`)));
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const headRes = await fetch(`${baseUrl}/?token=${token}`, { method: "HEAD" });
  assert.equal(headRes.status, 200);

  const statusRes = await fetch(`${baseUrl}/api/status`, { headers: { "x-sidecar-token": token } });
  assert.equal(statusRes.status, 200);
  const statusJson = await statusRes.json() as { status: string; tool: string; target: Record<string, string> };
  assert.equal(statusJson.status, "ok");
  assert.equal(statusJson.tool, "mobile_open_simulator");
  assert.deepEqual(statusJson.target, { platform: "android" });

  const openBrowserSession = async (note: string) => {
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { "x-sidecar-token": token } },
    });
    const client = new Client({ name: "browser-tab", version: "1.0.0" });
    await client.connect(transport);
    const putRes = await fetch(`${baseUrl}/context`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "mcp-session-id": transport.sessionId!,
        "x-sidecar-token": token,
      },
      body: JSON.stringify({ content: [{ type: "text", text: note }] }),
    });
    assert.equal(putRes.status, 204);
    return { client, transport };
  };

  const tab1 = await openBrowserSession("First tab context");
  t.after(() => tab1.client.close());
  const tab2 = await openBrowserSession("Second tab context");
  t.after(() => tab2.client.close());

  await new Promise(r => setTimeout(r, 100));

  const bothTabs = await hostClient.callTool({ name: "mobile_read_panel_context", arguments: {} });
  const bothText = JSON.stringify(bothTabs.content);
  assert.match(bothText, /First tab context/, "Concurrent sidecar tabs must stay open.");
  assert.match(bothText, /Second tab context/, "Second concurrent sidecar tab must also remain active.");

  const closeTab1 = await fetch(`${baseUrl}/api/close-session?token=${token}`, {
    method: "POST",
    body: JSON.stringify({ sessionId: tab1.transport.sessionId }),
  });
  assert.equal(closeTab1.status, 204);
  const closeTab2 = await fetch(`${baseUrl}/api/close-session?token=${token}`, {
    method: "POST",
    body: JSON.stringify({ sessionId: tab2.transport.sessionId }),
  });
  assert.equal(closeTab2.status, 204);
  await new Promise(r => setTimeout(r, 100));

  const afterClose = await hostClient.callTool({ name: "mobile_read_panel_context", arguments: {} });
  assert.match(JSON.stringify(afterClose.content), /No Mobile Dev browser panel/);

  // Aborting an in-flight proxied request must not poison deadUrls or remove state file.
  const tab3 = await openBrowserSession("Third tab context");
  t.after(() => tab3.client.close());
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 30);
  await assert.rejects(
    fetch(`${baseUrl}/mcp`, {
      method: "POST",
      signal: ac.signal,
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-session-id": tab3.transport.sessionId!,
        "x-sidecar-token": token,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 99,
        method: "tools/call",
        params: { name: "slow_ping", arguments: {} },
      }),
    }),
  );
  await new Promise(r => setTimeout(r, 50));

  const rootAfterAbort = await fetch(`${baseUrl}/?token=${token}`);
  assert.equal(rootAfterAbort.status, 200);
  const rootHtml = await rootAfterAbort.text();
  assert.match(rootHtml, /Mobile Dev/);
  assert.doesNotMatch(rootHtml, /Starting Mobile Dev backend/);

  const statusAfterAbort = await fetch(`${baseUrl}/api/status`, { headers: { "x-sidecar-token": token } });
  const statusAfterJson = await statusAfterAbort.json() as { status: string };
  assert.equal(statusAfterJson.status, "ok");

  // GET / without ?token= succeeds and injects sidecar token meta, while POST /mcp without token stays 403.
  const tokenlessRoot = await fetch(`${baseUrl}/`);
  assert.equal(tokenlessRoot.status, 200);
  const tokenlessHtml = await tokenlessRoot.text();
  assert.match(tokenlessHtml, new RegExp(`<meta name="mobile-dev-sidecar-token" content="${token}">`));

  const tokenlessPost = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(tokenlessPost.status, 403);
});
