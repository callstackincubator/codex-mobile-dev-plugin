import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { access, cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { createLaunchHome } from "./mcp-launch-fixture.mjs";

const source = resolve(process.argv[2] ?? "release/marketplace/plugins/mobile-dev");
const temporary = await mkdtemp(join(tmpdir(), "mobile-dev-agent-device-package-test-"));
const plugin = join(temporary, "mobile-dev");
let transport;
let client;
let stateDir;
try {
  await cp(source, plugin, { recursive: true, verbatimSymlinks: true });
  const manifest = JSON.parse(await readFile(join(plugin, ".mcp.json"), "utf8"));
  const config = manifest.mcpServers["agent-device"];
  assert.ok(config, "Agent Device is disabled in this package; this smoke test requires its MCP entry to be enabled.");
  assert.deepEqual(config.args, ["./scripts/launch-mcp.sh", "./dist/agent-device-server.mjs"]);
  const metadata = JSON.parse(await readFile(join(plugin, "dist/agent-device/release.json"), "utf8"));
  assert.equal(metadata.version, "0.20.9");
  assert.match(metadata.integrity, /^sha512-/);
  await access(join(plugin, "dist/agent-device/node_modules/agent-device/LICENSE"));
  await access(join(plugin, "dist/agent-device/node_modules/agent-device/dist/apple/runner/AgentDeviceRunner/AgentDeviceRunner.xcodeproj/project.pbxproj"));
  const workflow = await readFile(join(plugin, "skills/agent-device/references/workflow.md"), "utf8");
  assert.ok(workflow.startsWith("agent-device 0.20.9"));
  const fixtureHome = await createLaunchHome(temporary, process.execPath);
  transport = new StdioClientTransport({
    command: config.command, args: config.args, cwd: plugin, stderr: "pipe",
    env: {
      HOME: fixtureHome,
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      AGENT_DEVICE_CONFIG: "/nonexistent-global-agent-device-config.json",
      AGENT_DEVICE_STATE_DIR: join(temporary, "unrelated-global-state"),
      AGENT_DEVICE_DAEMON_BASE_URL: "http://127.0.0.1:1",
    },
  });
  let diagnostics = "";
  transport.stderr?.on("data", chunk => { diagnostics = (diagnostics + chunk).slice(-10000); });
  client = new Client({ name: "mobile-dev-agent-device-package-smoke", version: "1" });
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.equal(tools.length, 55);
  for (const name of ["open", "snapshot", "press", "fill", "scroll", "type", "wait", "close"]) {
    assert.ok(tools.some(tool => tool.name === name), `Missing ${name} control tool`);
  }
  const press = tools.find(tool => tool.name === "press");
  assert.ok(press.inputSchema.properties.target.oneOf.some(target => target.properties.kind.const === "ref"));
  assert.deepEqual(press.inputSchema.required, ["target", "session"]);
  for (const tool of tools) {
    for (const field of ["stateDir", "daemonBaseUrl", "daemonAuthToken", "mcpOutputFormat", "responseLevel", "iosXctestrunFile"]) {
      assert.equal(tool.inputSchema.properties[field], undefined, `${tool.name} exposes plugin configuration ${field}`);
    }
  }
  assert.equal(press.inputSchema.properties.platform, undefined);
  assert.equal(press.inputSchema.properties.udid, undefined);
  const otherState = join(temporary, "other-state");
  const rejected = await client.callTool({ name: "devices", arguments: { platform: "ios", stateDir: otherState } });
  assert.equal(rejected.isError, true);
  const state = await client.callTool({ name: "session", arguments: { action: "state-dir" } });
  assert.equal(state.isError, false, JSON.stringify(state.content));
  stateDir = state.structuredContent?.stateDir;
  assert.equal(typeof stateDir, "string", JSON.stringify(state));
  assert.ok(stateDir.includes("/mobile-dev-agent-device-"));
  assert.notEqual(stateDir, join(temporary, "unrelated-global-state"));
  const listed = await client.callTool({ name: "devices", arguments: { platform: "ios" } }, undefined, { timeout: 45000 });
  assert.equal(listed.isError, false, `${JSON.stringify(listed.content)}\n${diagnostics}`);
  assert.ok(Array.isArray(listed.structuredContent?.devices));
  assert.ok(listed.structuredContent.devices.length > 0);
  assert.ok(listed.structuredContent.devices.every(device => device.platform === "ios"));
  console.log(`Copied package exposed ${tools.length} agent-device tools and found ${listed.structuredContent.devices.length} iOS devices without a global CLI.`);
  // Read only the PID. The daemon file also holds a private local connection token.
  const { pid } = JSON.parse(await readFile(join(stateDir, "daemon.json"), "utf8"));
  assert.ok(Number.isInteger(pid) && pid > 0);
  process.kill(pid, 0);
  await client.close();
  client = undefined;
  const deadline = Date.now() + 10000;
  let stopped = false;
  while (Date.now() < deadline) {
    try { process.kill(pid, 0); }
    catch (error) { if (error.code === "ESRCH") { stopped = true; break; } throw error; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(stopped, "MCP shutdown should stop its owned agent-device daemon.");
  assert.ok(!(await readdir(temporary)).includes("unrelated-global-state"));
  console.log("MCP shutdown stopped its own agent-device daemon. No simulator app was opened or changed.");
} finally {
  await client?.close();
  await transport?.close();
  await rm(temporary, { recursive: true, force: true });
  if (stateDir) await rm(stateDir, { recursive: true, force: true });
}
