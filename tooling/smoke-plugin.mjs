import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { releaseVersion } from "./host-runtime.mjs";
import { codexOnlyPaths, pluginHost, pluginHosts } from "./plugin-hosts.mjs";

// Checks a plugin host's packages from a copy in a path with spaces:
//   node tooling/smoke-plugin.mjs <claude|cursor> [plugin folder]
const name = process.argv[2];
const host = pluginHost(name);
const version = await releaseVersion();
const temporary = await mkdtemp(join(tmpdir(), `mobile-dev-${name}-`));
const home = join(temporary, "home");
await mkdir(home);

async function withServer(label, command, args, env, capabilities, check) {
  const client = new Client({ name: `${name}-${label}-smoke`, version: "1" }, { capabilities });
  const transport = new StdioClientTransport({
    command, args, cwd: temporary, stderr: "pipe",
    env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: home, MOBILE_DEV_TELEMETRY: "off", ...env },
  });
  let diagnostics = "";
  transport.stderr?.on("data", chunk => { diagnostics = (diagnostics + chunk).slice(-5000); });
  try {
    await client.connect(transport);
    // Behavior follows client capabilities, not the host's name.
    assert.match(client.getInstructions(), /in chat when it is unsupported/);
    const { tools } = await client.listTools();
    for (const tool of ["mobile_show_devices", "mobile_open_workspace", "mobile_open_simulator", "mobile_list_simulators", "mobile_list_android_devices"]) {
      assert.ok(tools.some(candidate => candidate.name === tool), tool);
    }
    const workspace = tools.find(tool => tool.name === "mobile_open_workspace");
    const resource = await client.readResource({ uri: workspace._meta.ui.resourceUri });
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

try {
  // Copy the plugin to a path with spaces, as a host's install cache would.
  const plugin = join(temporary, "plugin with spaces");
  await cp(resolve(process.argv[3] ?? `release/${name}-plugin/mobile-dev`), plugin, { recursive: true, verbatimSymlinks: true });
  const manifest = JSON.parse(await readFile(join(plugin, host.manifest, "plugin.json"), "utf8"));
  assert.equal(manifest.name, "mobile-dev");
  assert.equal(manifest.version, version);
  assert.equal(manifest.license, "MIT");
  await access(join(plugin, manifest.logo ?? manifest.icon));
  const server = manifest.mcpServers["mobile-dev"];
  // The server runs with Node from PATH, or through the host's launcher that finds it.
  const launcher = server.command !== "node";
  assert.deepEqual(server.args, [...launcher ? [`\${${host.root}}/scripts/launch-node.sh`] : [], `\${${host.root}}/dist/server.mjs`]);
  if (launcher) assert.equal(server.command, "/bin/sh");
  for (const path of ["LICENSE", "README.md", "PRIVACY.md", "skills/mobile-dev/SKILL.md", "skills/mobile-dev-setup/SKILL.md", "dist/app.html", "dist/baguette/Baguette", "dist/ios-mirror/darwin-arm64.node"]) {
    await access(join(plugin, path));
  }
  const otherManifests = Object.entries(pluginHosts).filter(([other]) => other !== name).map(([, other]) => other.manifest);
  for (const path of [...codexOnlyPaths, ...otherManifests]) await assert.rejects(access(join(plugin, path)), path);
  const args = server.args.map(arg => arg.replaceAll(`\${${host.root}}`, plugin));
  // A launcher finds Node on the user's PATH; put this Node there.
  const PATH = `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`;
  if (launcher) {
    // Its SessionStart check stays silent when Node is usable.
    const hooks = JSON.parse(await readFile(join(plugin, "hooks/hooks.json"), "utf8"));
    const [check] = hooks.hooks.SessionStart[0].hooks;
    assert.equal(execFileSync("/bin/sh", ["-c", check.command], { env: { PATH, HOME: home, [host.root]: plugin }, encoding: "utf8" }), "");
  }
  for (const environment of ["development", "release"]) {
    // Without forms or MCP Apps, device choices fall back to chat.
    const env = { MOBILE_DEV_ENVIRONMENT: environment, [host.root]: plugin, ...launcher ? { PATH } : {} };
    await withServer("plugin", launcher ? server.command : process.execPath, args, env, {}, async client => {
      const choice = await client.callTool({ name: "mobile_show_devices", arguments: { message: "Which device?", selectionMode: "single" } });
      assert.equal(choice.isError, true);
      assert.match(choice.content[0].text, /ask the user in chat/);
    });
    console.log(`${environment}: ${host.label} plugin manifest, payload, startup from the plugin root, chat fallback and no Codex updater passed.`);
  }
} finally { await rm(temporary, { recursive: true, force: true }); }
