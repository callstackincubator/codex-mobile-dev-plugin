import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { access, cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const source = resolve(process.argv[2] ?? "release/marketplace/plugins/mobile-dev");
const temporary = await mkdtemp(join(tmpdir(), "mobile-dev-package-test-"));
const plugin = join(temporary, "mobile-dev");
let transport;
let runtimeTransport;
try {
  await cp(source, plugin, { recursive: true, verbatimSymlinks: true });
  await access(join(plugin, "dist/baguette/Baguette"));
  await access(join(plugin, "dist/baguette/Baguette_Baguette.bundle/Web"));
  const require = createRequire(import.meta.url);
  const mirrorPath = join(plugin, "dist/ios-mirror/darwin-arm64.node");
  const mirror = require(mirrorPath);
  assert.equal(typeof mirror.openDevice, "function");
  await access(join(plugin, "dist/ios-mirror/third-party-licenses.txt"));
  const iosLogsPath = join(plugin, "dist/ios-logs/mobile-dev-ios-logs");
  const iosLogsReleasePath = join(plugin, "dist/ios-logs/release.json");
  const iosLogsReleaseText = await readFile(iosLogsReleasePath, "utf8");
  const iosLogsRelease = JSON.parse(iosLogsReleaseText);
  const iosLogsLicensePath = join(plugin, "dist/ios-logs/third-party-licenses.txt");
  await access(iosLogsLicensePath);
  for (const dependency of iosLogsRelease.sources) {
    const archivePath = join(plugin, `dist/ios-logs/sources/${dependency.name}-${dependency.version}.tar.bz2`);
    await access(archivePath);
  }
  const unavailablePhone = spawnSync(iosLogsPath, ["--device", "00000000-0000000000000000", "usb"], { encoding: "utf8", timeout: 5000 });
  assert.equal(unavailablePhone.error, undefined);
  assert.equal(unavailablePhone.status, 1);
  assert.match(unavailablePhone.stderr, /unavailable to libimobiledevice/);
  console.log("The relocated physical iOS log reader loads its bundled libraries and dependency sources.");
  assert.equal(JSON.parse(await readFile(join(plugin, "plugin.json"), "utf8")).name, "mobile-dev");
  transport = new StdioClientTransport({
    command: process.execPath, args: ["dist/server.mjs"], cwd: plugin, stderr: "pipe",
  });
  let diagnostics = "";
  transport.stderr?.on("data", chunk => { diagnostics = (diagnostics + chunk).slice(-5000); });
  const client = new Client({ name: "mobile-dev-package-smoke", version: "1" });
  await client.connect(transport);
  const tools = await client.listTools();
  await access(join(plugin, "dist/ios-fps/mobile-dev-ios-fps"));
  await access(join(plugin, "dist/ios-fps/third-party-licenses.txt"));
  for (const abi of ["arm64-v8a", "armeabi-v7a", "x86", "x86_64"]) await access(join(plugin, `dist/android-fps/${abi}/mobile-dev-fps`));
  for (const name of ["mobile_display_fps_session", "mobile_read_display_fps", "mobile_display_fps_close"]) assert.ok(tools.tools.some(tool => tool.name === name));
  for (const name of ["mobile_list_ios_devices", "mobile_list_android_devices", "mobile_boot_android_emulator", "mobile_android_stream_session", "mobile_android_screenshot", "mobile_ios_mirror_session", "mobile_ios_mirror_reset", "mobile_ios_mirror_close"]) assert.ok(tools.tools.some(tool => tool.name === name));
  const physicalMirror = tools.tools.find(tool => tool.name === "mobile_ios_mirror_session");
  assert.deepEqual(physicalMirror._meta.ui.visibility, ["app"]);
  await access(join(plugin, "dist/serve-emu/node_modules/serve-emu/src/cli.ts"));
  await access(join(plugin, "dist/serve-emu/node_modules/serve-emu/vendor/scrcpy-server-v4.0"));
  const scrcpyClientPath = join(plugin, "dist/serve-emu/node_modules/serve-emu/src/scrcpy.ts");
  const scrcpyClient = await readFile(scrcpyClientPath);
  const scrcpyClientHash = createHash("sha256");
  scrcpyClientHash.update(scrcpyClient);
  const scrcpyClientSHA256 = scrcpyClientHash.digest("hex");
  assert.equal(scrcpyClientSHA256, "5ca62e5fdf3f71144178bbd4251b82c4d7e944301399477a9b8595a68d58098f");
  const androidReleasePath = join(plugin, "dist/serve-emu/release.json");
  const androidReleaseText = await readFile(androidReleasePath, "utf8");
  const androidRelease = JSON.parse(androidReleaseText);
  assert.equal(androidRelease.scrcpyClientSHA256, scrcpyClientSHA256);
  const patchToolPath = join(plugin, "dist/serve-emu/node_modules/patch-package");
  const patchToolAccess = access(patchToolPath);
  await assert.rejects(patchToolAccess, { code: "ENOENT" });
  for (const abi of ["arm64-v8a", "armeabi-v7a", "x86", "x86_64"]) await access(join(plugin, `dist/android-cpu/${abi}/mobile-dev-cpu`));
  const cpuLicense = await readFile(join(plugin, "dist/android-cpu/LICENSE"), "utf8");
  assert.ok(cpuLicense.includes("Copyright (c) 2022 BAM"));
  const workspace = tools.tools.find(tool => tool.name === "mobile_open_workspace");
  assert.deepEqual(workspace._meta["openai/ui"].entrypoints, [{ type: "global" }]);
  const workspaceResource = await client.readResource({ uri: workspace._meta.ui.resourceUri });
  assert.ok(workspaceResource.contents[0].text.includes('data-view="workspace" data-layout="split"'));
  for (const name of ["mobile_log_sources", "mobile_logs_session", "mobile_read_logs", "mobile_logs_keep_alive", "mobile_logs_close", "mobile_performance_sources", "mobile_cpu_session", "mobile_read_cpu", "mobile_cpu_close"]) {
    assert.ok(tools.tools.some(tool => tool.name === name), `Missing developer tool: ${name}`);
  }
  const panel = await client.callTool({ name: "mobile_open_simulator", arguments: {} }, undefined, { timeout: 30000 });
  if (panel.isError || !panel.structuredContent?.connected) {
    throw new Error(`Bundled backend failed: ${JSON.stringify(panel.content)}\n${diagnostics}`);
  }
  assert.equal(panel.structuredContent.managed, true);
  assert.notEqual(new URL(panel.structuredContent.baseUrl).port, "8421");
  const baseUrl = panel.structuredContent.baseUrl;
  const entrypoint = tools.tools.find(tool => tool.name === "mobile_open_simulator");
  for (const tool of [entrypoint, workspace]) {
    assert.deepEqual(Object.keys(tool._meta["openai/ui"]), ["entrypoints"]);
    assert.equal(tool.icons?.[0].mimeType, "image/svg+xml");
    assert.match(tool.icons[0].src, /^data:image\/svg\+xml;base64,/);
  }
  const resource = await client.readResource({ uri: entrypoint._meta.ui.resourceUri });
  assert.equal(resource.contents[0].mimeType, "text/html;profile=mcp-app");
  assert.ok(resource.contents[0].text.includes('id="root"'));
  // React creates these controls from the bundled script after the app mounts.
  for (const control of ["canvas", "logs-drawer", "log-chat", "tool-select", "tool-performance", "performance-drawer", "performance-app", "platform-select", "simulator-panels"]) {
    assert.ok(resource.contents[0].text.includes(control), `Missing bundled UI control: ${control}`);
  }
  assert.ok(!resource.contents[0].text.includes("<!-- APP_SCRIPT -->"));
  assert.ok(!resource.contents[0].text.includes("<!-- APP_STYLE -->"));
  assert.equal(entrypoint._meta.ui.resourceUri, "ui://mobile-dev/0.1.77/simulator.html");
  assert.ok(resource.contents[0].text.includes('workspace-toolbar'));
  assert.ok(resource.contents[0].text.includes('workspace-panels'));
  assert.ok(resource.contents[0].text.includes('tool-logs'));
  assert.ok(resource.contents[0].text.includes('Memory usage'), 'The packaged Performance view must include the live memory track.');
  assert.equal(workspace._meta.ui.resourceUri, "ui://mobile-dev/0.1.77/workspace.html");
  assert.deepEqual(resource.contents[0]._meta.ui.csp.connectDomains, ["https://o4512180958068736.ingest.de.sentry.io"]);
  assert.deepEqual(resource.contents[0]._meta.ui.csp.resourceDomains, []);
  runtimeTransport = new StdioClientTransport({ command: process.execPath, args: ["dist/server.mjs"], cwd: plugin, stderr: "pipe" });
  const runtime = new Client({ name: "mobile-dev-package-runtime", version: "1" });
  await runtime.connect(runtimeTransport);
  const runtimeResource = await runtime.readResource({ uri: entrypoint._meta.ui.resourceUri });
  assert.deepEqual(runtimeResource.contents[0], resource.contents[0]);
  await runtime.close();
  console.log("Discovery/runtime processes agree on UI addresses, HTML, and Sentry-only browser connections.");
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
  await runtimeTransport?.close();
  await transport?.close();
  await rm(temporary, { recursive: true, force: true });
}
