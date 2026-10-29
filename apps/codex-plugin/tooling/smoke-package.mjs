import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createLaunchHome } from "./mcp-launch-fixture.mjs";
import { pluginHost, pluginRelease } from "../../../tooling/plugin-hosts.mjs";
import { tempPlugin, withServer } from "../../../tooling/lib/mcp-smoke.mjs";
import { assertPluginFolder } from "../../../tooling/lib/package-payload.mjs";

// Checks the Codex package from a copy, through its actual MCP launch configuration
// with a system-only PATH:
//   npm run test:package [-- <plugin folder>]
const host = pluginHost("codex");
const { temporary, plugin, remove } = await tempPlugin(process.argv[2] ?? pluginRelease(host).plugin, { prefix: "mobile-dev-package-test-" });

function uiIdentity(text) {
  const user = text.match(/name="mobile-dev-user-id" content="(anon_[a-f0-9]{32})"/);
  const session = text.match(/name="mobile-dev-session-id" content="(run_[a-f0-9]{32})"/);
  assert.ok(user);
  assert.ok(session);
  return { userId: user[1], sessionId: session[1] };
}

function withoutSession(text) {
  return text.replace(/name="mobile-dev-session-id" content="run_[a-f0-9]{32}"/, 'name="mobile-dev-session-id" content="[session]"');
}

/** Codex's launch configuration: its launcher runs Codex's bundled Node with the forwarded environment. */
async function codexLaunch() {
  const mcp = JSON.parse(await readFile(join(plugin, ".mcp.json"), "utf8"));
  assert.deepEqual(Object.keys(mcp.mcpServers), ["mobile-dev"]);
  const config = mcp.mcpServers["mobile-dev"];
  assert.equal(config.command, "/bin/sh");
  assert.deepEqual(config.args, ["./scripts/launch-mcp.sh", "./dist/server.mjs"]);
  assert.equal(config.cwd, ".");
  for (const name of ["HOME", "TRACE_SIFT_HOME", "TRACE_SIFT_COMMAND", "MOBILE_DEV_TELEMETRY"]) assert.ok(config.env_vars.includes(name), name);
  // Supply the Codex runtime cache layout with no Node on MCP PATH.
  const home = await createLaunchHome(temporary, process.execPath);
  return { command: config.command, args: config.args, cwd: resolve(plugin, config.cwd), env: { ...process.env, HOME: home, PATH: "/usr/bin:/bin:/usr/sbin:/sbin" } };
}

try {
  // The payload every host's package ships, plus Codex's skill display metadata.
  await assertPluginFolder(plugin, host);
  await access(join(plugin, "skills/agent-device/agents/openai.yaml"));
  console.log("The relocated runtime's native helpers load their bundled libraries, and its dependency sources ship beside them.");
  const telemetryConfig = JSON.parse(await readFile(join(plugin, "dist/telemetry-environment.json"), "utf8"));
  const launch = await codexLaunch();
  const launcher = launch.args[0];
  const nodeVersion = spawnSync(launch.command, [launcher, "--version"], { cwd: launch.cwd, env: launch.env, encoding: "utf8" });
  assert.equal(nodeVersion.error, undefined);
  assert.equal(nodeVersion.status, 0, nodeVersion.stderr);
  assert.equal(nodeVersion.stdout.trim(), process.version);
  // The launcher's Node loads the physical iOS capture addon.
  const mirrorProbe = "const mirror = require(process.argv[1]); if (typeof mirror.openDevice !== 'function') process.exit(1);";
  const mirror = spawnSync(launch.command, [launcher, "-e", mirrorProbe, join(plugin, "dist/ios-mirror/darwin-arm64.node")], { cwd: launch.cwd, env: launch.env, encoding: "utf8" });
  assert.equal(mirror.error, undefined);
  assert.equal(mirror.status, 0, mirror.stderr);
  const manifest = JSON.parse(await readFile(join(plugin, ".codex-plugin/plugin.json"), "utf8"));
  assert.equal(manifest.name, "mobile-dev");

  const baseUrl = await withServer({ ...launch, name: "mobile-dev-package-smoke" }, async client => {
    const tools = await client.listTools();
    const tool = name => tools.tools.find(candidate => candidate.name === name);
    // Codex's own server and panel: the updater tools and the banner that calls them.
    assert.ok(tool("mobile_check_plugin_update"), "The Codex server must include its updater.");
    const recordingCard = tool("mobile_render_performance_recording");
    assert.ok(recordingCard);
    assert.deepEqual(recordingCard._meta.ui.visibility, ["app", "model"]);
    const recordingUri = recordingCard._meta.ui.resourceUri;
    assert.equal(recordingUri, `ui://mobile-dev/${manifest.version}/recording.html`);
    const recordingResource = await client.readResource({ uri: recordingUri });
    const recordingHtml = recordingResource.contents[0].text;
    assert.match(recordingHtml, /data-view="recording"/);
    const comparisonCard = tool("mobile_compare_performance_recordings");
    assert.ok(comparisonCard);
    const comparisonUri = comparisonCard._meta.ui.resourceUri;
    assert.equal(comparisonUri, `ui://mobile-dev/${manifest.version}/comparison.html`);
    const comparisonResource = await client.readResource({ uri: comparisonUri });
    assert.match(comparisonResource.contents[0].text, /data-view="comparison"/);
    for (const name of ["mobile_display_fps_session", "mobile_read_display_fps", "mobile_display_fps_close", "mobile_read_performance_frames"]) assert.ok(tool(name), name);
    for (const name of ["mobile_list_ios_devices", "mobile_list_android_devices", "mobile_boot_android_emulator", "mobile_android_stream_session", "mobile_ios_mirror_session", "mobile_ios_mirror_reset", "mobile_ios_mirror_close"]) assert.ok(tool(name), name);
    for (const name of ["device_open", "device_snapshot", "device_press", "device_screenshot"]) assert.ok(tool(name), name);
    assert.deepEqual(tool("mobile_ios_mirror_session")._meta.ui.visibility, ["app"]);
    const workspace = tool("mobile_open_workspace");
    assert.deepEqual(workspace._meta["openai/ui"].entrypoints, [{ type: "global" }]);
    const workspaceResource = await client.readResource({ uri: workspace._meta.ui.resourceUri });
    assert.ok(workspaceResource.contents[0].text.includes('data-view="workspace" data-layout="split"'));
    for (const name of ["mobile_log_sources", "mobile_logs_session", "mobile_read_logs", "mobile_logs_keep_alive", "mobile_logs_close", "mobile_performance_sources", "mobile_cpu_session", "mobile_read_cpu", "mobile_cpu_close"]) {
      assert.ok(tool(name), `Missing developer tool: ${name}`);
    }
    const panel = await client.callTool({ name: "mobile_open_simulator", arguments: {} }, undefined, { timeout: 30000 });
    if (panel.isError || !panel.structuredContent?.connected) throw new Error(`Bundled backend failed: ${JSON.stringify(panel.content)}`);
    assert.equal(panel.structuredContent.managed, true);
    assert.notEqual(new URL(panel.structuredContent.baseUrl).port, "8421");
    const baseUrl = panel.structuredContent.baseUrl;
    const entrypoint = tool("mobile_open_simulator");
    for (const opener of [entrypoint, workspace]) {
      assert.deepEqual(Object.keys(opener._meta["openai/ui"]), ["entrypoints"]);
      assert.equal(opener.icons?.[0].mimeType, "image/svg+xml");
      assert.match(opener.icons[0].src, /^data:image\/svg\+xml;base64,/);
    }
    const resource = await client.readResource({ uri: entrypoint._meta.ui.resourceUri });
    const html = resource.contents[0].text;
    assert.equal(resource.contents[0].mimeType, "text/html;profile=mcp-app");
    assert.ok(html.includes('id="root"'));
    // React creates these controls from the bundled script after the app mounts.
    for (const control of ["canvas", "logs-drawer", "log-chat", "tool-select", "tool-performance", "tool-tracesift", "performance-drawer", "performance-app", "platform-select", "simulator-panels"]) {
      assert.ok(html.includes(control), `Missing bundled UI control: ${control}`);
    }
    assert.ok(!html.includes("<!-- APP_SCRIPT -->"));
    assert.ok(!html.includes("<!-- APP_STYLE -->"));
    assert.equal(entrypoint._meta.ui.resourceUri, `ui://mobile-dev/${manifest.version}/simulator.html`);
    const telemetryEnvironment = process.env.MOBILE_DEV_ENVIRONMENT ?? telemetryConfig.environment;
    assert.ok(html.includes(`name="mobile-dev-environment" content="${telemetryEnvironment}"`));
    for (const part of ["workspace-toolbar", "workspace-panels", "tool-logs"]) assert.ok(html.includes(part), part);
    assert.ok(html.includes("plugin store"), "The Codex panel must include its update banner.");
    assert.ok(html.includes("Memory usage"), "The packaged Performance view must include the live memory track.");
    assert.equal(workspace._meta.ui.resourceUri, `ui://mobile-dev/${manifest.version}/workspace.html`);
    assert.deepEqual(resource.contents[0]._meta.ui.csp.connectDomains, ["https://o4512180958068736.ingest.de.sentry.io"]);
    assert.deepEqual(resource.contents[0]._meta.ui.csp.resourceDomains, []);
    // A second process keeps the installation identity and starts its own session.
    await withServer({ ...launch, name: "mobile-dev-package-runtime" }, async runtime => {
      const runtimeResource = await runtime.readResource({ uri: entrypoint._meta.ui.resourceUri });
      if (process.env.MOBILE_DEV_TELEMETRY === "off") {
        assert.deepEqual(runtimeResource.contents[0], resource.contents[0]);
        assert.match(html, /mobile-dev-telemetry" content="off"/);
        return;
      }
      const initialIdentity = uiIdentity(html);
      const runtimeIdentity = uiIdentity(runtimeResource.contents[0].text);
      assert.equal(runtimeIdentity.userId, initialIdentity.userId);
      assert.notEqual(runtimeIdentity.sessionId, initialIdentity.sessionId);
      assert.deepEqual(uiIdentity(recordingHtml), initialIdentity);
      assert.deepEqual(uiIdentity(workspaceResource.contents[0].text), initialIdentity);
      const runtimeHtml = withoutSession(runtimeResource.contents[0].text);
      assert.deepEqual({ ...runtimeResource.contents[0], text: runtimeHtml }, { ...resource.contents[0], text: withoutSession(html) });
    });
    console.log("Manifest-launched discovery/runtime processes work without Node on PATH and preserve telemetry identity, environment, and UI addresses.");
    const oldWorkspace = await client.readResource({ uri: "ui://mobile-dev/workspace.html" });
    assert.equal(oldWorkspace.contents[0].text, workspaceResource.contents[0].text);
    for (const release of ["v1", "v2", "v3", "v4", "v5", "v6", "0.1.100"]) {
      const uri = `ui://mobile-dev/${release}/simulator.html`;
      const legacy = await client.readResource({ uri });
      assert.equal(legacy.contents[0].uri, uri);
      assert.equal(legacy.contents[0].text, html);
    }
    console.log("Cached side-tab UI addresses from earlier releases return the current panel.");
    const listed = await client.callTool({ name: "mobile_list_simulators", arguments: {} });
    assert.equal(listed.structuredContent?.baseUrl, baseUrl);
    console.log(`Copied package started its bundled Baguette and returned ${panel.structuredContent.devices.length} simulators.`);
    // agent-device's runtime starts from the package's own copy on the first command.
    const devices = await client.callTool({ name: "device_devices", arguments: { platform: "ios" } }, undefined, { timeout: 60000 });
    assert.doesNotMatch(devices.content[0].text, /Agent Device could not/);
    console.log("Copied package started its bundled agent-device runtime.");
    return baseUrl;
  });
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
  await remove();
}
