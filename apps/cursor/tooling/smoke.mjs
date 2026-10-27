import assert from "node:assert/strict";
import { access, cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { releaseVersion } from "../../../tooling/host-runtime.mjs";

const version = await releaseVersion();
const temporary = await mkdtemp(join(tmpdir(), "mobile-dev-cursor-"));
try {
  // Copy the plugin to a path with spaces, as ~/.cursor/plugins/local or an install cache would.
  const plugin = join(temporary, "plugin with spaces");
  await cp(resolve(process.argv[2] ?? "release/cursor-plugin/mobile-dev"), plugin, { recursive: true, verbatimSymlinks: true });
  const manifest = JSON.parse(await readFile(join(plugin, ".cursor-plugin/plugin.json"), "utf8"));
  assert.equal(manifest.name, "mobile-dev");
  assert.equal(manifest.version, version);
  assert.equal(manifest.license, "MIT");
  await access(join(plugin, manifest.logo));
  const server = manifest.mcpServers["mobile-dev"];
  assert.equal(server.command, "node");
  assert.deepEqual(server.args, ["${CURSOR_PLUGIN_ROOT}/dist/server.mjs"]);
  for (const path of ["LICENSE", "README.md", "PRIVACY.md", "skills/mobile-dev/SKILL.md", "skills/mobile-dev-setup/SKILL.md", "dist/app.html", "dist/baguette/Baguette", "dist/ios-mirror/darwin-arm64.node"]) {
    await access(join(plugin, path));
  }
  // Another host's files would load its launcher or manifest.
  for (const path of [".mcp.json", "mcp.json", ".codex-plugin", ".claude-plugin", "scripts/launch-mcp.sh"]) {
    await assert.rejects(access(join(plugin, path)), path);
  }
  const home = join(temporary, "home");
  await mkdir(home);
  // Behavior follows client capabilities, not the host's name: without forms or
  // MCP Apps, device choices fall back to chat.
  for (const environment of ["development", "release"]) {
    const client = new Client({ name: "cursor-plugin-smoke", version: "1" }, { capabilities: {} });
    const transport = new StdioClientTransport({
      command: process.execPath, args: server.args.map(arg => arg.replaceAll("${CURSOR_PLUGIN_ROOT}", plugin)),
      cwd: temporary, stderr: "pipe",
      env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: home,
        MOBILE_DEV_TELEMETRY: "off", MOBILE_DEV_ENVIRONMENT: environment },
    });
    let diagnostics = "";
    transport.stderr?.on("data", chunk => { diagnostics = (diagnostics + chunk).slice(-5000); });
    try {
      await client.connect(transport);
      assert.match(client.getInstructions(), /in chat when it is unsupported/);
      const { tools } = await client.listTools();
      for (const name of ["mobile_show_devices", "mobile_open_workspace", "mobile_open_simulator", "mobile_list_simulators", "mobile_list_android_devices"]) {
        assert.ok(tools.some(tool => tool.name === name), name);
      }
      const workspace = tools.find(tool => tool.name === "mobile_open_workspace");
      const resource = await client.readResource({ uri: workspace._meta.ui.resourceUri });
      const html = resource.contents[0].text;
      assert.ok(html.includes(`name="mobile-dev-environment" content="${environment}"`));
      assert.match(html, /name="mobile-dev-telemetry" content="off"/);
      const choice = await client.callTool({ name: "mobile_show_devices", arguments: { message: "Which device?", selectionMode: "single" } });
      assert.equal(choice.isError, true);
      assert.match(choice.content[0].text, /ask the user in chat/);
      // The Codex updater belongs to Codex's server; this plugin runs the shared one.
      assert.equal(tools.some(tool => tool.name.includes("plugin_update")), false);
      console.log(`${environment}: Cursor plugin manifest, payload, MCP startup from the plugin root, chat fallback and no Codex updater passed.`);
    } catch (error) {
      if (diagnostics) console.error(diagnostics);
      throw error;
    } finally { await client.close(); await transport.close(); }
  }
} finally { await rm(temporary, { recursive: true, force: true }); }
