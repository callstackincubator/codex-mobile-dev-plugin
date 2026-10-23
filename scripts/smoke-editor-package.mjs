import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const host = process.argv[2];
if (host !== "cursor" && host !== "vscode") throw new Error("Pass cursor or vscode.");
const { version } = JSON.parse(await readFile("package.json", "utf8"));
const archive = resolve(process.argv[3] ?? `release/mobile-dev-${version}-${host}-darwin-arm64.zip`);
const temporary = await mkdtemp(join(tmpdir(), `mobile-dev-${host}-`));
try {
  const directory = join(temporary, "bundle with spaces");
  await mkdir(directory);
  execFileSync("unzip", ["-q", archive, "-d", directory]);
  const config = JSON.parse(execFileSync(process.execPath, [join(directory, "configure.mjs")], { cwd: temporary, encoding: "utf8" }));
  const entry = config[host === "cursor" ? "mcpServers" : "servers"]["mobile-dev"];
  assert.equal(entry.command, process.execPath);
  assert.equal(entry.env.MOBILE_DEV_HOST, host);
  assert.equal(entry.args[0], join(directory, "dist/server.mjs"));
  if (host === "cursor") {
    const manifest = JSON.parse(await readFile(join(directory, ".cursor-plugin/plugin.json"), "utf8"));
    assert.equal(manifest.version, version);
    const pluginConfig = JSON.parse(await readFile(join(directory, "mcp.json"), "utf8"));
    assert.equal(pluginConfig.mcpServers["mobile-dev"].env.MOBILE_DEV_HOST, host);
    assert.equal(pluginConfig.mcpServers["mobile-dev"].args[0].replaceAll("${CURSOR_PLUGIN_ROOT}", directory), entry.args[0]);
  }
  for (const path of ["dist/app.html", "dist/baguette/Baguette", "dist/ios-mirror/darwin-arm64.node", "dist/serve-emu/src/cli.mjs"]) await access(join(directory, path));
  const home = join(temporary, "home");
  await mkdir(home);
  for (const environment of ["development", "release"]) {
    const client = new Client({ name: `${host}-package-smoke`, version: "1" });
    const transport = new StdioClientTransport({
      command: entry.command, args: entry.args, cwd: temporary, stderr: "pipe",
      env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: home, ...entry.env, MOBILE_DEV_TELEMETRY: "off", MOBILE_DEV_ENVIRONMENT: environment },
    });
    let diagnostics = "";
    transport.stderr?.on("data", chunk => { diagnostics = (diagnostics + chunk).slice(-4000); });
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      assert.ok(!tools.some(tool => tool.name === "mobile_choose_devices"));
      const workspace = tools.find(tool => tool.name === "mobile_open_workspace");
      assert.ok(workspace);
      const resource = await client.readResource({ uri: workspace._meta.ui.resourceUri });
      const html = resource.contents[0].text;
      assert.ok(html.includes(`data-host="${host}"`));
      assert.ok(html.includes(`name="mobile-dev-environment" content="${environment}"`));
      assert.ok(html.includes('name="mobile-dev-telemetry" content="off"'));
      const check = await client.callTool({ name: "mobile_check_plugin_update", arguments: {} });
      assert.equal(check.structuredContent.update.status, "disabled");
      const install = await client.callTool({ name: "mobile_install_plugin_update", arguments: {} });
      assert.equal(install.isError, true);
      console.log(`${host}/${environment}: relocated startup, UI resource, telemetry opt-out and updater isolation passed.`);
    } catch (error) { if (diagnostics) console.error(diagnostics); throw error; }
    finally { await client.close(); await transport.close(); }
  }
} finally { await rm(temporary, { recursive: true, force: true }); }
