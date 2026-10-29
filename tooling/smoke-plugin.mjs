import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { releaseArchive, releaseVersion } from "./host-runtime.mjs";
import { pluginHost, pluginRelease } from "./plugin-hosts.mjs";
import { tempPlugin, withServer } from "./lib/mcp-smoke.mjs";
import { assertPluginFolder, assertRuntimePayload } from "./lib/package-payload.mjs";

// Checks a plugin host's packages from a copy in a path with spaces:
//   node tooling/smoke-plugin.mjs <claude|cursor> [plugin folder]
const name = process.argv[2];
const host = pluginHost(name);
const metadata = JSON.parse(await readFile("package.json", "utf8"));
const version = await releaseVersion();
// Copy the plugin to a path with spaces, as a host's install cache would.
const { temporary, plugin, remove } = await tempPlugin(process.argv[3] ?? pluginRelease(host).plugin, { prefix: `mobile-dev-${name}-`, folder: "plugin with spaces" });
const home = join(temporary, "home");
await mkdir(home);
// Hosts without the panel run their own server with cards.
const panels = host.panel;
const panelTools = ["mobile_open_workspace", "mobile_open_simulator", "mobile_list_simulators", "mobile_list_android_devices", "mobile_stream_session", "mobile_open_performance_recording"];
// Every host's agent controls apps with agent-device's commands.
const expectedTools = [...panels ? panelTools : ["mobile_render_performance_recording", "mobile_logs_session"], "device_open", "device_snapshot"];

async function smokeServer(label, command, args, env, capabilities, check) {
  await withServer({
    command, args, cwd: temporary, name: `${name}-${label}-smoke`, capabilities,
    env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: home, MOBILE_DEV_TELEMETRY: "off", ...env },
  }, async client => {
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
    await check(client, resource);
  });
}

async function smokeDesktopBundle() {
  const archive = resolve(releaseArchive(host, version, { desktop: true }));
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
  await access(join(directory, manifest.server.entry_point));
  await assertRuntimePayload(join(directory, "dist"), { panel: panels });
  // No Codex installation, no PATH Node lookup, and no dependency on package cwd.
  const args = manifest.server.mcp_config.args.map(arg => arg.replaceAll("${__dirname}", directory));
  for (const [environment, forms] of [["development", false], ["release", false], ["development", true]]) {
    const capabilities = forms ? { extensions: { "openai/elicitation": { form: {} } } } : {};
    await smokeServer("desktop", process.execPath, args, { MOBILE_DEV_ENVIRONMENT: environment }, capabilities, async (client, resource) => {
      assert.doesNotMatch(resource.contents[0].text, /data-host=/);
      assert.deepEqual(resource.contents[0]._meta.ui.permissions, { clipboardWrite: {} });
      assert.match(resource.contents[0].text, panels ? /data-view="workspace"/ : /data-view="recording"/);
      assert.match(resource.contents[0].text, /ui.workspace.display_mode_changed/);
    });
    console.log(`${environment}${forms ? "/forms" : ""}: ${host.label} Desktop bundle payload, startup, tools and UI resource passed.`);
  }
}

try {
  if (host.desktopBundle) await smokeDesktopBundle();
  const manifest = JSON.parse(await readFile(join(plugin, host.manifest, "plugin.json"), "utf8"));
  assert.equal(manifest.name, "mobile-dev");
  assert.equal(manifest.version, version);
  assert.equal(manifest.license, "MIT");
  await access(join(plugin, manifest.logo ?? manifest.icon));
  const server = manifest.mcpServers["mobile-dev"];
  // The server runs with Node from PATH, or through the host's launcher, which also
  // finds Node where version managers install it.
  const launcher = server.command !== "node";
  if (launcher) assert.equal(server.command, "/bin/sh");
  assert.deepEqual(server.args, [...launcher ? [`\${${host.root}}/scripts/launch-node.sh`] : [], `\${${host.root}}/dist/server.mjs`]);
  await assertPluginFolder(plugin, host);
  const args = server.args.map(arg => arg.replaceAll(`\${${host.root}}`, plugin));
  // The launcher finds Node on the user's PATH; put this Node there.
  const PATH = `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`;
  if (launcher) {
    // Its session check stays silent when Node is usable.
    const hooks = JSON.parse(await readFile(join(plugin, "hooks/hooks.json"), "utf8"));
    const [check] = hooks.hooks.SessionStart[0].hooks;
    assert.equal(execFileSync("/bin/sh", ["-c", check.command], { env: { PATH, HOME: home, [host.root]: plugin }, encoding: "utf8" }), "");
  }
  for (const environment of ["development", "release"]) {
    const env = { MOBILE_DEV_ENVIRONMENT: environment, [host.root]: plugin, ...launcher ? { PATH } : {} };
    await smokeServer("plugin", launcher ? server.command : process.execPath, args, env, { elicitation: {} }, async client => {
      // agent-device's runtime starts from the plugin's own copy on the first command.
      const devices = await client.callTool({ name: "device_devices", arguments: { platform: "ios" } });
      assert.doesNotMatch(devices.content[0].text, /Agent Device could not/);
    });
    console.log(`${environment}: ${host.label} plugin manifest, payload, startup from the plugin root and device chooser passed.`);
  }
} finally { await remove(); }
