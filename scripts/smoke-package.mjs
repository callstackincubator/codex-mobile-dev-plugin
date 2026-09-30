import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { access, cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const source = resolve(process.argv[2] ?? "release/marketplace/plugins/mobile-dev");
const temporary = await mkdtemp(join(tmpdir(), "mobile-dev-package-test-"));
const plugin = join(temporary, "mobile-dev");
let transport;
try {
  await cp(source, plugin, { recursive: true, verbatimSymlinks: true });
  await access(join(plugin, "dist/baguette/Baguette"));
  await access(join(plugin, "dist/baguette/Baguette_Baguette.bundle/Web"));
  assert.equal(JSON.parse(await readFile(join(plugin, "plugin.json"), "utf8")).name, "mobile-dev");
  transport = new StdioClientTransport({
    command: process.execPath, args: ["dist/server.mjs"], cwd: plugin, stderr: "pipe",
  });
  let diagnostics = "";
  transport.stderr?.on("data", chunk => { diagnostics = (diagnostics + chunk).slice(-5000); });
  const client = new Client({ name: "mobile-dev-package-smoke", version: "1" });
  await client.connect(transport);
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 28);
  for (const name of ["mobile_list_android_devices", "mobile_boot_android_emulator", "mobile_android_stream_session", "mobile_android_screenshot"]) assert.ok(tools.tools.some(tool => tool.name === name));
  await access(join(plugin, "dist/serve-emu/node_modules/serve-emu/src/cli.ts"));
  await access(join(plugin, "dist/serve-emu/node_modules/serve-emu/vendor/scrcpy-server-v4.0"));
  const workspace = tools.tools.find(tool => tool.name === "mobile_open_workspace");
  assert.deepEqual(workspace._meta["openai/ui"].entrypoints, [{ type: "global" }]);
  const workspaceResource = await client.readResource({ uri: workspace._meta.ui.resourceUri });
  assert.ok(workspaceResource.contents[0].text.includes('data-view="workspace" data-layout="split"'));
  for (const name of ["mobile_log_sources", "mobile_logs_session", "mobile_read_logs", "mobile_logs_close"]) {
    assert.ok(tools.tools.some(tool => tool.name === name), `Missing log tool: ${name}`);
  }
  const panel = await client.callTool({ name: "mobile_open_simulator", arguments: {} }, undefined, { timeout: 30000 });
  if (panel.isError || !panel.structuredContent?.connected) {
    throw new Error(`Bundled backend failed: ${JSON.stringify(panel.content)}\n${diagnostics}`);
  }
  assert.equal(panel.structuredContent.managed, true);
  assert.notEqual(new URL(panel.structuredContent.baseUrl).port, "8421");
  const baseUrl = panel.structuredContent.baseUrl;
  const entrypoint = tools.tools.find(tool => tool.name === "mobile_open_simulator");
  const resource = await client.readResource({ uri: entrypoint._meta.ui.resourceUri });
  assert.equal(resource.contents[0].mimeType, "text/html;profile=mcp-app");
  assert.ok(resource.contents[0].text.includes("<canvas"));
  assert.ok(resource.contents[0].text.includes('id="platform"'));
  assert.ok(resource.contents[0].text.includes('id="logs-drawer"'));
  assert.ok(resource.contents[0].text.includes('id="log-attach"'));
  assert.ok(!resource.contents[0].text.includes("<!-- APP_SCRIPT -->"));
  assert.ok(!resource.contents[0].text.includes("<!-- APP_STYLE -->"));
  assert.equal(entrypoint._meta.ui.resourceUri, "ui://mobile-dev/0.1.16/simulator.html");
  assert.ok(resource.contents[0].text.includes('class="workspace-toolbar"'));
  assert.ok(resource.contents[0].text.includes('id="workspace-panels"'));
  assert.ok(resource.contents[0].text.includes('id="tool-logs"'));
  assert.equal(workspace._meta.ui.resourceUri, "ui://mobile-dev/0.1.16/workspace.html");
  assert.ok(workspaceResource.contents[0].text.includes('data-view="workspace" data-layout="split"'));
  const oldWorkspace = await client.readResource({ uri: "ui://mobile-dev/workspace.html" });
  assert.equal(oldWorkspace.contents[0].text, workspaceResource.contents[0].text);
  for (const version of [1, 2, 3, 4, 5, 6]) {
    const uri = `ui://mobile-dev/v${version}/simulator.html`;
    const legacy = await client.readResource({ uri });
    assert.equal(legacy.contents[0].uri, uri);
    assert.equal(legacy.contents[0].text, resource.contents[0].text);
  }
  console.log("Cached side-tab UI addresses v1 through v6 return the current panel.");
  const listed = await client.callTool({ name: "mobile_list_simulators", arguments: {} });
  assert.equal(listed.structuredContent?.baseUrl, baseUrl);
  console.log(`Copied package started its bundled Baguette and returned ${panel.structuredContent.devices.length} simulators.`);
  await client.close();
  const deadline = Date.now() + 5000;
  let stopped = false;
  while (Date.now() < deadline) {
    try { await fetch(`${baseUrl}/simulators.json`, { signal: AbortSignal.timeout(200) }); }
    catch { stopped = true; break; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(stopped, true, "The bundled backend should stop when MCP closes.");
  console.log("MCP shutdown stopped the bundled backend. No simulator was booted or changed.");
} finally {
  await transport?.close();
  await rm(temporary, { recursive: true, force: true });
}
