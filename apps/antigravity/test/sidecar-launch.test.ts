import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
  const stopPanel = browserPanel({
    always: true,
    template,
    onPage: async url => {
      await writeFile(statePath, JSON.stringify({ pid: process.pid, url, updatedAt: Date.now() }) + "\n");
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

  // Wait briefly for the async DELETE of tab1 to settle on the server.
  await new Promise(r => setTimeout(r, 100));

  const afterReplace = await hostClient.callTool({ name: "mobile_read_panel_context", arguments: {} });
  const replaceText = JSON.stringify(afterReplace.content);
  assert.doesNotMatch(replaceText, /First tab context/, "Superseded sidecar session must be closed.");
  assert.doesNotMatch(replaceText, /tab 1 of 2/, "Only one active sidecar tab should remain.");
  assert.match(replaceText, /Second tab context/);

  const beaconRes = await fetch(`${baseUrl}/api/close-session?token=${token}`, {
    method: "POST",
    body: JSON.stringify({ sessionId: tab2.transport.sessionId }),
  });
  assert.equal(beaconRes.status, 204);
  await new Promise(r => setTimeout(r, 100));

  const afterClose = await hostClient.callTool({ name: "mobile_read_panel_context", arguments: {} });
  assert.match(JSON.stringify(afterClose.content), /No Mobile Dev browser panel/);
});
