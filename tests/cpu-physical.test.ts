import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { setImmediate } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { cpuDeviceSchema } from "../src/shared/cpu.ts";
import type { CpuTarget } from "../src/shared/cpu.ts";
import { parsePhysicalApps, runningPhysicalApps } from "../src/server/cpu/apps.ts";
import { openPhysicalDebugserver } from "../src/server/cpu/physical.ts";
import { CpuSessions } from "../src/server/cpu/sessions.ts";
import { registerCpuTools } from "../src/server/cpu/tools.ts";
import { Baguette } from "../src/server/baguette.ts";
import { fakeBaguette } from "./fixtures.ts";
import type { PhysicalIosDevice } from "../src/shared/ios-devices.ts";

const udid = "00008150-001068280AE8C01C";
const target: CpuTarget = { platform: "ios", kind: "physical", deviceId: udid, bundleId: "com.example.dev" };
const device: PhysicalIosDevice = { udid, coreDeviceId: "11111111-1111-4111-8111-111111111111", name: "iPhone", model: "iPhone",
  productType: "iPhone18,1", state: "connected", runtime: "iOS 27", platform: "ios", kind: "physical", transportType: "wired", pairingState: "paired" };
const appPath = "file:///private/var/containers/Bundle/Application/ABC/Example%20App.app/";
const app = { bundleIdentifier: target.bundleId, url: appPath, builtByDeveloper: true };
function response(result: unknown) {
  const payload = { info: { outcome: "success" }, result };
  return JSON.stringify(payload);
}

test("hardware UDIDs require an explicit physical iOS target", () => {
  const physical = cpuDeviceSchema.parse({ platform: "ios", kind: "physical", deviceId: udid });
  assert.equal(physical.kind, "physical");
  assert.throws(() => cpuDeviceSchema.parse({ deviceId: udid }), /simulator UUID/);
  assert.throws(() => cpuDeviceSchema.parse({ platform: "android", kind: "physical", deviceId: "phone" }), /only used for iOS/);
});

test("physical app discovery joins bundle URLs to main processes and excludes extensions, release apps and system apps", () => {
  const apps = response({ apps: [app, { ...app, bundleIdentifier: "com.example.release", url: "file:///var/Release.app/", builtByDeveloper: false },
    { ...app, bundleIdentifier: "com.apple.system", url: "file:///var/System.app/" },
    { ...app, bundleIdentifier: "com.example.stopped", url: "file:///var/Stopped.app/" }] });
  const processes = response({ runningProcesses: [
    { processIdentifier: 123, executable: "file:///var/containers/Bundle/Application/ABC/Example%20App.app/Example%20App" },
    { processIdentifier: 456, executable: appPath + "PlugIns/Extension.appex/Extension" },
    { processIdentifier: 789, executable: "file:///var/Release.app/Release" },
    { processIdentifier: 999, executable: "file:///var/System.app/System" },
    { processIdentifier: 1 },
  ] });
  const discovered = parsePhysicalApps(apps, processes);
  assert.deepEqual(discovered, [{ bundleId: target.bundleId, pid: 123 }]);
  const malformed = response({ runningProcesses: [{ processIdentifier: -1 }] });
  assert.throws(() => parsePhysicalApps(apps, malformed));
});

test("physical app discovery only issues bounded read-only devicectl commands and forwards cancellation", async () => {
  const abort = new AbortController();
  const calls: string[] = [];
  const discovered = await runningPhysicalApps(udid, abort.signal, async (file, args, options) => {
    assert.equal(file, "/usr/bin/xcrun");
    assert.equal(options.signal, abort.signal);
    assert.equal(options.timeout, 15000);
    const kind = args[3];
    calls.push(kind);
    assert.deepEqual(args.slice(0, 3), ["devicectl", "device", "info"]);
    assert.ok(args.includes(udid));
    if (kind === "apps") {
      assert.ok(args.includes("--no-include-default-apps"));
      return { stdout: response({ apps: [app] }) };
    }
    assert.equal(kind, "processes");
    return { stdout: response({ runningProcesses: [{ processIdentifier: 123, executable: appPath + "Example" }] }) };
  });
  assert.deepEqual(calls, ["apps", "processes"]);
  assert.deepEqual(discovered, [{ bundleId: target.bundleId, pid: 123 }]);
});

async function helper(t: TestContext, body: string) {
  const temporary = tmpdir();
  const prefix = join(temporary, "mobile-dev-debugserver-test-");
  const root = await mkdtemp(prefix);
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "helper.cjs");
  const script = `#!${process.execPath}\n${body}`;
  await writeFile(path, script, { mode: 0o700 });
  return pathToFileURL(path);
}

const echoHelper = `
const net = require('node:net');
if (process.argv[2] !== 'debugserver' || process.argv[3] !== '${udid}') process.exit(2);
const server = net.createServer(socket => {
  socket.pipe(socket);
  socket.once('close', () => server.close());
});
server.on('close', () => process.exit(0));
server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  const line = JSON.stringify({port: address.port}) + '\\n';
  process.stdout.write(line.slice(0, 4));
  setImmediate(() => process.stdout.write(line.slice(4)));
});
process.stdin.resume();
process.stdin.once('end', () => server.close());
`;

test("the device bridge accepts fragmented readiness, forwards raw GDB bytes and closes its child once", async t => {
  const binary = await helper(t, echoHelper);
  const abort = new AbortController();
  const transport = await openPhysicalDebugserver(udid, abort.signal, binary);
  t.after(() => transport.close());
  const packet = Buffer.from("$QSetDetachOnError:1#00");
  const reading = once(transport.socket, "data");
  transport.socket.write(packet);
  const [received] = await reading;
  assert.deepEqual(received, packet);
  await Promise.all([transport.close(), transport.close()]);
  const exit = await transport.exited;
  assert.equal(exit, 0);
  assert.equal(transport.socket.destroyed, true);
});

test("aborting an established device bridge releases its socket and native helper", async t => {
  const binary = await helper(t, echoHelper);
  const abort = new AbortController();
  const transport = await openPhysicalDebugserver(udid, abort.signal, binary);
  t.after(() => transport.close());
  abort.abort();
  await transport.exited;
  assert.equal(transport.socket.destroyed, true);
});

test("device bridge startup exposes device errors and cancels a helper waiting for a connection", async t => {
  const failed = await helper(t, "process.stderr.write('Developer disk image is not mounted'); process.exit(1);");
  const signal = new AbortController();
  const opening = openPhysicalDebugserver(udid, signal.signal, failed);
  await assert.rejects(opening, /Developer disk image is not mounted/);
  const waiting = await helper(t, "process.stdin.resume(); process.stdin.once('end', () => process.exit(0));");
  const abort = new AbortController();
  const pending = openPhysicalDebugserver(udid, abort.signal, waiting);
  await setImmediate();
  abort.abort();
  await assert.rejects(pending, /abort/i);
});

test("physical CPU MCP sessions use device discovery, stream samples and leave the simulator backend untouched", async t => {
  const fake = await fakeBaguette();
  const baguette = new Baguette(fake.url);
  let online = true;
  let paired = true;
  let stops = 0;
  const apps = async (deviceId: string, _signal?: AbortSignal, platform?: string, kind?: string) => {
    assert.equal(deviceId, udid);
    assert.equal(platform, "ios");
    assert.equal(kind, "physical");
    return [{ bundleId: target.bundleId, pid: 123 }];
  };
  const cpu = new CpuSessions({ apps, monitor: async options => {
    assert.deepEqual(options.target, target);
    options.onSample({ timestampUs: 1000000n, intervalUs: 1000000, cpuPercent: 20, memoryBytes: 104857600,
      threads: [{ id: "123", name: "main", cpuPercent: 20 }] });
    return { closed: new Promise(() => {}), async stop() { stops++; } };
  } });
  const server = new McpServer({ name: "physical-cpu-test", version: "1" });
  registerCpuTools(server, cpu, baguette, { apps, androidDevices: async () => [],
    iosDevices: async () => [{ ...device, state: online ? "connected" : "disconnected", pairingState: paired ? "paired" : "unpaired" }] });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "physical-cpu-client", version: "1" });
  t.after(async () => { await client.close(); await cpu.close(); await server.close(); baguette.dispose(); await fake.close(); });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const discovered = await client.callTool({ name: "mobile_performance_sources", arguments: { platform: "ios", kind: "physical", deviceId: udid } });
  assert.equal(discovered.isError, undefined);
  const opened = await client.callTool({ name: "mobile_cpu_session", arguments: { target } });
  assert.equal(opened.isError, undefined);
  const id = opened.structuredContent?.sessionId;
  await setImmediate();
  const reading = await client.callTool({ name: "mobile_read_cpu", arguments: { sessionId: id } });
  assert.equal(reading.structuredContent?.phase, "recording");
  assert.equal(reading.structuredContent?.memoryMetric, "physical-footprint");
  const stopped = await client.callTool({ name: "mobile_cpu_close", arguments: { sessionId: id } });
  assert.equal(stopped.isError, undefined);
  assert.equal(stops, 1);
  online = false;
  const offline = await client.callTool({ name: "mobile_cpu_session", arguments: { target } });
  assert.equal(offline.isError, true);
  online = true;
  paired = false;
  const unpaired = await client.callTool({ name: "mobile_cpu_session", arguments: { target } });
  assert.equal(unpaired.isError, true);
  assert.deepEqual(fake.requests, []);
});
