import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const metadata = JSON.parse(await readFile("package.json", "utf8"));
const archive = resolve(process.argv[2] ?? `release/mobile-dev-${metadata.version}-claude-desktop-darwin-arm64.mcpb`);
const temporary = await mkdtemp(join(tmpdir(), "mobile-dev-claude-"));
try {
  const directory = join(temporary, "bundle with spaces");
  await mkdir(directory);
  execFileSync("unzip", ["-q", archive, "-d", directory]);
  const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
  assert.equal(manifest.manifest_version, "0.3");
  assert.equal(manifest.version, metadata.version);
  assert.equal(manifest.server.type, "node");
  assert.equal(manifest.server.mcp_config.command, "node");
  assert.equal(manifest.server.mcp_config.env.MOBILE_DEV_HOST, "claude-desktop");
  assert.equal(manifest.compatibility.runtimes.node, metadata.engines.node);
  for (const path of [manifest.server.entry_point, "dist/app.html", "dist/baguette/Baguette", "dist/ios-mirror/darwin-arm64.node", "dist/agent-device-server.mjs", "dist/serve-emu/src/cli.mjs"]) {
    await access(join(directory, path));
  }
  const args = manifest.server.mcp_config.args.map(arg => arg.replaceAll("${__dirname}", directory));
  // No Codex installation, no PATH Node lookup, and no dependency on package cwd.
  const home = join(temporary, "home");
  await mkdir(home);
  for (const [host, environment] of [["claude-desktop", "development"], ["claude-desktop", "release"], ["codex", "development"]]) {
    const claude = host === "claude-desktop";
    const client = new Client({ name: "claude-package-smoke", version: "1" });
    const transport = new StdioClientTransport({
      command: process.execPath, args, cwd: temporary, stderr: "pipe",
      env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: home,
        ...manifest.server.mcp_config.env, MOBILE_DEV_HOST: host, MOBILE_DEV_TELEMETRY: "off", MOBILE_DEV_ENVIRONMENT: environment },
    });
    let diagnostics = "";
    transport.stderr?.on("data", chunk => { diagnostics = (diagnostics + chunk).slice(-5000); });
    try {
      await client.connect(transport);
      const instructions = client.getInstructions();
      if (claude) {
        assert.match(instructions, /ask the user in chat/);
        assert.doesNotMatch(instructions, /mobile_choose_devices|Mobile Dev skill/);
      } else assert.match(instructions, /mobile_choose_devices/);
      const { tools } = await client.listTools();
      assert.equal(tools.some(tool => tool.name === "mobile_choose_devices"), !claude);
      for (const name of ["mobile_open_workspace", "mobile_open_simulator", "mobile_list_simulators", "mobile_list_android_devices"]) {
        assert.ok(tools.some(tool => tool.name === name), name);
      }
      const workspace = tools.find(tool => tool.name === "mobile_open_workspace");
      const resource = await client.readResource({ uri: workspace._meta.ui.resourceUri });
      const html = resource.contents[0].text;
      assert.equal(html.includes('data-host="claude-desktop"'), claude);
      assert.deepEqual(resource.contents[0]._meta.ui.permissions, { clipboardWrite: {} });
      assert.match(html, /data-view="workspace"/);
      assert.ok(html.includes(`name="mobile-dev-environment" content="${environment}"`));
      assert.match(html, /name="mobile-dev-telemetry" content="off"/);
      assert.match(html, /ui.workspace.display_mode_changed/);
      const check = await client.callTool({ name: "mobile_check_plugin_update", arguments: {} });
      assert.notEqual(check.isError, true);
      assert.equal(check.structuredContent.update.status, "disabled");
      const install = await client.callTool({ name: "mobile_install_plugin_update", arguments: {} });
      assert.equal(install.isError, true);
      assert.match(install.content[0].text, /do not install public plugin updates/);
      console.log(`${host}/${environment}: relocated MCP startup, tools, UI resource and disabled updater passed.`);
    } catch (error) {
      if (diagnostics) console.error(diagnostics);
      throw error;
    } finally { await client.close(); await transport.close(); }
  }
} finally { await rm(temporary, { recursive: true, force: true }); }
