import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AgentDeviceRuntime } from "../packages/core/src/agent-device-runtime.ts";
import { agentDeviceTools, readAgentDeviceCatalog } from "../packages/core/src/agent-device-tools.ts";
import { foregroundSimulatorPid } from "../packages/core/src/device-apps/foreground.ts";
import { parseRunningApps } from "../packages/core/src/device-apps/apps.ts";
import { usePanelRuntime } from "../packages/core/src/panel-runtime.ts";

// Run against an already booted simulator and an installed app. No shutdown, relaunch,
// or forced claim recovery: a failure must preserve the evidence of the broken handoff.
//   node tooling/smoke-agent-device-release.mjs <udid> <bundle-id>
const [udid, app] = process.argv.slice(2);
assert.ok(udid && app, "Pass an already booted simulator UDID and an installed app bundle ID.");
const root = new URL("../packages/runtimes/agent-device/", import.meta.url);
const pin = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const installed = JSON.parse(await readFile(new URL("node_modules/agent-device/package.json", root), "utf8"));
assert.equal(installed.version, pin.dependencies["agent-device"], "Install the pinned runtime before testing.");
const run = promisify(execFile);
const simctl = async (...args) => (await run("xcrun", ["simctl", ...args], { timeout: 20000, maxBuffer: 4 * 1024 * 1024 })).stdout;
const devices = JSON.parse(await simctl("list", "devices", "--json"));
assert.ok(Object.values(devices.devices).flat().some(device => device.udid === udid && device.state === "Booted"), "Boot the selected simulator through Mobile Dev first.");
usePanelRuntime(async () => fileURLToPath(new URL("../dist/", import.meta.url)));
const stateDir = await mkdtemp(join(tmpdir(), "mobile-dev-release-smoke-"));
process.env.AGENT_DEVICE_STATE_DIR = stateDir;
const runtime = new AgentDeviceRuntime(root);
const server = new McpServer({ name: "mobile-dev-release-smoke", version: "1" });
const cleanup = agentDeviceTools(readAgentDeviceCatalog(new URL("tools.json", root)), runtime)(server);
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: "mobile-dev-release-smoke", version: "1" });
const active = new Set();
const evidence = { runtime: installed.version, app, observations: [] };

async function call(name, args) {
  const result = await client.callTool({ name: `device_${name}`, arguments: args }, undefined, { timeout: 180000 });
  assert.notEqual(result.isError, true, JSON.stringify(result));
  return result;
}

async function observe(phase, expectedPid) {
  const running = parseRunningApps(await simctl("spawn", udid, "launchctl", "list"), true);
  const process = running.find(candidate => candidate.bundleId === app);
  assert.ok(process, `${phase}: the app must still be running`);
  const foregroundPid = await foregroundSimulatorPid(udid);
  assert.equal(foregroundPid, process.pid, `${phase}: the app must remain foreground`);
  if (expectedPid !== undefined) assert.equal(process.pid, expectedPid, `${phase}: the app must not restart`);
  evidence.observations.push({ phase, pid: process.pid, foregroundPid });
  console.log(`${phase}: app PID ${process.pid}, foreground PID ${foregroundPid}`);
  return process.pid;
}

try {
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  // Start outside agent-device, matching an agent attaching to an already-running app.
  await simctl("launch", udid, app);
  const pid = await observe("before opening a session");
  const first = "release-smoke-first";
  const second = "release-smoke-second";
  active.add(first);
  await call("open", { session: first, platform: "ios", udid, app, foreground: true });
  await observe("first session owns device", pid);
  const blocked = await client.callTool({ name: "device_open", arguments: { session: second, platform: "ios", udid, app } });
  assert.equal(blocked.isError, true, "The first session must keep exclusive ownership until released.");
  assert.match(JSON.stringify(blocked), /DEVICE_IN_USE/);
  await call("close", { session: first });
  active.delete(first);
  await observe("after releasing first session", pid);
  const sessions = await call("session", { action: "list" });
  assert.doesNotMatch(JSON.stringify(sessions), new RegExp(first), "The released session must be retired.");
  active.add(second);
  await call("open", { session: second, platform: "ios", udid, app, foreground: true });
  await observe("second session acquired device", pid);
  await call("close", { session: second });
  active.delete(second);
  await observe("after releasing second session", pid);
  await cleanup();
  await observe("after stopping test runtime", pid);
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  for (const session of active) await call("close", { session }).catch(error => console.error(error));
  await client.close();
  await server.close();
  await cleanup();
  // Keep the isolated state directory and diagnostics for investigating failures.
  console.log(`Runtime diagnostics: ${stateDir}`);
}
