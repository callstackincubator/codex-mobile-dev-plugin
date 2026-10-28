import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { releaseVersion } from "./host-runtime.mjs";
import { codexOnlyPaths, pluginHost, pluginHosts } from "./plugin-hosts.mjs";

// Checks a plugin host's packages from a copy in a path with spaces:
//   node tooling/smoke-plugin.mjs <claude|cursor> [plugin folder]
const name = process.argv[2];
const host = pluginHost(name);
const metadata = JSON.parse(await readFile("package.json", "utf8"));
const version = await releaseVersion();
const temporary = await mkdtemp(join(tmpdir(), `mobile-dev-${name}-`));
const home = join(temporary, "home");
await mkdir(home);
// Hosts without the panel run their own server with cards and agent-device's commands.
const panels = host.panels !== false;
const panelTools = ["mobile_open_workspace", "mobile_open_simulator", "mobile_list_simulators", "mobile_list_android_devices", "mobile_stream_session", "mobile_open_performance_recording"];
const expectedTools = panels ? panelTools : ["mobile_render_performance_recording", "mobile_logs_session", "device_open", "device_snapshot"];
const panelFiles = ["dist/baguette/Baguette", "dist/ios-mirror/darwin-arm64.node", "dist/serve-emu/src/cli.mjs"];

async function withServer(label, args, env, capabilities, check) {
  const client = new Client({ name: `${name}-${label}-smoke`, version: "1" }, { capabilities });
  const transport = new StdioClientTransport({
    command: process.execPath, args, cwd: temporary, stderr: "pipe",
    env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: home, MOBILE_DEV_TELEMETRY: "off", ...env },
  });
  let diagnostics = "";
  transport.stderr?.on("data", chunk => { diagnostics = (diagnostics + chunk).slice(-5000); });
  try {
    await client.connect(transport);
    // Behavior follows client capabilities, not the host's name.
    assert.match(client.getInstructions(), panels ? /mobile_open_simulator/ : /the host's own simulator view/);
    const { tools } = await client.listTools();
    for (const tool of expectedTools) assert.ok(tools.some(candidate => candidate.name === tool), tool);
    // The panel's device form is listed for hosts that render forms; elsewhere the agent asks in chat.
    const forms = capabilities.extensions?.["openai/elicitation"] !== undefined || capabilities.elicitation !== undefined;
    assert.equal(tools.some(tool => tool.name === "mobile_choose_devices"), panels && forms);
    if (panels === false) for (const tool of panelTools) assert.equal(tools.some(candidate => candidate.name === tool), false, tool);
    const view = tools.find(tool => tool.name === (panels ? "mobile_open_workspace" : "mobile_render_performance_recording"));
    const resource = await client.readResource({ uri: view._meta.ui.resourceUri });
    const html = resource.contents[0].text;
    assert.ok(html.includes(`name="mobile-dev-environment" content="${env.MOBILE_DEV_ENVIRONMENT}"`));
    assert.match(html, /name="mobile-dev-telemetry" content="off"/);
    assert.doesNotMatch(html, /plugin store/, "The shared panel has no Codex update banner.");
    // The Codex updater belongs to Codex's server; these packages run the shared one.
    assert.equal(tools.some(tool => tool.name.includes("plugin_")), false);
    await check(client, resource);
  } catch (error) {
    if (diagnostics) console.error(diagnostics);
    throw error;
  } finally { await client.close(); await transport.close(); }
}

async function smokeDesktopBundle() {
  const archive = resolve(`release/mobile-dev-${version}-${name}-desktop-darwin-arm64.mcpb`);
  const directory = join(temporary, "bundle with spaces");
  await mkdir(directory);
  execFileSync("unzip", ["-q", archive, "-d", directory]);
  const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
  assert.equal(manifest.manifest_version, "0.3");
  assert.equal(manifest.version, version);
  assert.equal(manifest.server.type, "node");
  assert.equal(manifest.server.mcp_config.command, "node");
  assert.equal(manifest.server.mcp_config.env, undefined);
  assert.equal(manifest.compatibility.runtimes.node, metadata.engines.node);
  for (const path of [manifest.server.entry_point, "dist/app.html", ...panels ? panelFiles : ["dist/agent-device/tools.json"]]) {
    await access(join(directory, path));
  }
  if (panels === false) for (const path of panelFiles) await assert.rejects(access(join(directory, path)), path);
  // No Codex installation, no PATH Node lookup, and no dependency on package cwd.
  const args = manifest.server.mcp_config.args.map(arg => arg.replaceAll("${__dirname}", directory));
  for (const [environment, forms] of [["development", false], ["release", false], ["development", true]]) {
    const capabilities = forms ? { extensions: { "openai/elicitation": { form: {} } } } : {};
    await withServer("desktop", args, { MOBILE_DEV_ENVIRONMENT: environment }, capabilities, async (client, resource) => {
      assert.doesNotMatch(resource.contents[0].text, /data-host=/);
      assert.deepEqual(resource.contents[0]._meta.ui.permissions, { clipboardWrite: {} });
      assert.match(resource.contents[0].text, panels ? /data-view="workspace"/ : /data-view="recording"/);
      assert.match(resource.contents[0].text, /ui.workspace.display_mode_changed/);
    });
    console.log(`${environment}${forms ? "/forms" : ""}: ${host.label} Desktop bundle startup, tools, UI resource and no Codex updater passed.`);
  }
}

try {
  if (host.desktopBundle) await smokeDesktopBundle();
  // Copy the plugin to a path with spaces, as a host's install cache would.
  const plugin = join(temporary, "plugin with spaces");
  await cp(resolve(process.argv[3] ?? `release/${name}-plugin/mobile-dev`), plugin, { recursive: true, verbatimSymlinks: true });
  const manifest = JSON.parse(await readFile(join(plugin, host.manifest, "plugin.json"), "utf8"));
  assert.equal(manifest.name, "mobile-dev");
  assert.equal(manifest.version, version);
  assert.equal(manifest.license, "MIT");
  await access(join(plugin, manifest.logo ?? manifest.icon));
  const server = manifest.mcpServers["mobile-dev"];
  assert.equal(server.command, "node");
  assert.deepEqual(server.args, [`\${${host.root}}/dist/server.mjs`]);
  const skills = host.skills ?? ["mobile-dev", "mobile-dev-setup"];
  for (const path of ["LICENSE", "README.md", "PRIVACY.md", "dist/app.html", ...skills.map(skill => `skills/${skill.split("/").at(-1)}/SKILL.md`), ...panels ? panelFiles : []]) {
    await access(join(plugin, path));
  }
  if (panels === false) for (const path of panelFiles) await assert.rejects(access(join(plugin, path)), path);
  const otherManifests = Object.entries(pluginHosts).filter(([other]) => other !== name).map(([, other]) => other.manifest);
  for (const path of [...codexOnlyPaths, ...otherManifests]) await assert.rejects(access(join(plugin, path)), path);
  const args = server.args.map(arg => arg.replaceAll(`\${${host.root}}`, plugin));
  for (const environment of ["development", "release"]) {
    await withServer("plugin", args, { MOBILE_DEV_ENVIRONMENT: environment, [host.root]: plugin }, { elicitation: {} }, async client => {
      // agent-device's runtime starts from the plugin's own copy on the first command.
      if (panels === false) {
        const devices = await client.callTool({ name: "device_devices", arguments: { platform: "ios" } });
        assert.doesNotMatch(devices.content[0].text, /Agent Device could not/);
      }
    });
    console.log(`${environment}: ${host.label} plugin manifest, payload, startup from the plugin root, device chooser and no Codex updater passed.`);
  }
} finally { await rm(temporary, { recursive: true, force: true }); }
