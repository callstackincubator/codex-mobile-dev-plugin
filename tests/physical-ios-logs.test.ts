import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { nativeLogTargetSchema } from "../src/shared/logs.ts";
import type { LogRecord, LogSourceStatus } from "../src/shared/logs.ts";
import type { PhysicalIosDevice } from "../src/shared/ios-devices.ts";
import { physicalIosLogCommand } from "../src/server/physical-ios-logs.ts";
import type { PhysicalIosLogTarget } from "../src/server/physical-ios-logs.ts";
import { startNativeLogs } from "../src/server/native-logs.ts";
import { LogSessions } from "../src/server/log-sessions.ts";
import { registerLogTools } from "../src/server/log-tools.ts";
import { Baguette } from "../src/server/baguette.ts";
import { parseIOSLog } from "../src/server/log-parsers.ts";

const execute = promisify(execFile);
const phone: PhysicalIosDevice = {
  udid: "00008110-000A0B1C2D3E4000", coreDeviceId: "11111111-1111-4111-8111-111111111111",
  name: "Test iPhone", model: "iPhone", productType: "iPhone18,1", state: "connected", runtime: "iOS 27.0",
  platform: "ios", kind: "physical", transportType: "wired", pairingState: "paired",
};
const target: PhysicalIosLogTarget = { platform: "ios", kind: "physical", deviceId: phone.udid, process: "Example" };

async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 4000;
  while (predicate() === false) {
    assert.ok(Date.now() < deadline, "Timed out waiting for the log reader.");
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

test("physical log targets require a hardware UDID and cannot enter the simulator route", () => {
  const valid = nativeLogTargetSchema.safeParse(target);
  assert.equal(valid.success, true);
  const legacy = nativeLogTargetSchema.safeParse({ ...target, deviceId: "a".repeat(40) });
  assert.equal(legacy.success, true);
  const coreId = nativeLogTargetSchema.safeParse({ ...target, deviceId: phone.coreDeviceId });
  assert.equal(coreId.success, false);
  const simulator = nativeLogTargetSchema.safeParse({ platform: "ios", deviceId: phone.udid });
  assert.equal(simulator.success, false);
});

test("physical readers reuse discovery UDIDs and select its current USB or Wi-Fi transport", { skip: process.platform !== "darwin" }, async () => {
  const helper = pathToFileURL(process.execPath);
  for (const [transportType, mode] of [["wired", "usb"], ["localNetwork", "network"]]) {
    const command = await physicalIosLogCommand(target, async () => [{ ...phone, transportType }], helper);
    assert.equal(command.command, process.execPath);
    assert.deepEqual(command.args, ["--device", phone.udid, mode, "Example"]);
  }
  const disconnected = physicalIosLogCommand(target, async () => [{ ...phone, state: "disconnected" }], helper);
  await assert.rejects(disconnected, /no longer connected/);
  const unpaired = physicalIosLogCommand(target, async () => [{ ...phone, pairingState: "unpaired" }], helper);
  await assert.rejects(unpaired, /not paired/);
  const absent = physicalIosLogCommand(target, async () => [], helper);
  await assert.rejects(absent, /no longer connected/);
});

test("iOS log targets accept bounded PIDs and reject simultaneous name and PID filters", () => {
  const pidTarget = { platform: "ios", kind: "physical", deviceId: phone.udid, pid: 123 };
  const valid = nativeLogTargetSchema.safeParse(pidTarget);
  assert.equal(valid.success, true);
  for (const pid of [0, -1, 1.5, 2147483648, "123"]) {
    const parsed = nativeLogTargetSchema.safeParse({ ...pidTarget, pid });
    assert.equal(parsed.success, false);
  }
  const both = nativeLogTargetSchema.safeParse({ ...pidTarget, process: "Example" });
  assert.equal(both.success, false);
});

test("physical iOS PID filters exclude other processes and records without an identity", { skip: process.platform !== "darwin" }, async t => {
  const entries: LogRecord[] = [];
  let accepted!: () => void;
  const ready = new Promise<void>(resolve => { accepted = resolve; });
  const pidTarget: PhysicalIosLogTarget = { platform: "ios", kind: "physical", deviceId: phone.udid, pid: 123 };
  const code = `console.log('{"ready":true}');
    for (const processID of [456, undefined, 123]) console.log(JSON.stringify({ timestamp: '2026-10-02T12:00:00Z', processID,
      process: 'Example', eventMessage: 'fixture' }));
    setInterval(() => {}, 1000);`;
  const stop = startNativeLogs(pidTarget, { log: log => { entries.push(log); accepted(); }, status() {} }, async selected => {
    assert.deepEqual(selected, pidTarget);
    return { command: process.execPath, args: ["-e", code] };
  });
  t.after(stop);
  await ready;
  await stop();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].pid, 123);
  assert.equal(entries[0].deviceId, phone.udid);
});

test("physical streams wait for acceptance, preserve process metadata across PIDs, and close cleanly", { skip: process.platform !== "darwin" }, async t => {
  const entries: LogRecord[] = [];
  const statuses: LogSourceStatus[] = [];
  const code = `setTimeout(() => {
    console.log('{"ready":true}');
    for (const processID of [123, 456]) console.log(JSON.stringify({ timestamp: '1970-01-01T00:00:42.123456Z', messageType: 'Error',
      process: 'Example', processID, eventMessage: 'fixture', subsystem: 'com.example', category: 'javascript' }));
    setInterval(() => {}, 1000);
  }, 100);`;
  const stop = startNativeLogs(target, { log: log => entries.push(log), status: status => statuses.push(status) }, async selected => {
    assert.deepEqual(selected, target);
    return { command: process.execPath, args: ["-e", code] };
  });
  t.after(stop);
  await waitFor(() => statuses.length > 0);
  assert.equal(statuses.some(status => status.state === "live"), false);
  await waitFor(() => entries.length === 2);
  assert.equal(statuses.at(-1)?.state, "live");
  assert.deepEqual(entries.map(entry => entry.pid), [123, 456]);
  for (const entry of entries) {
    assert.equal(entry.deviceId, phone.udid);
    assert.equal(entry.process, "Example");
    assert.equal(entry.level, "error");
    assert.equal(entry.source, "js");
    assert.equal(entry.subsystem, "com.example");
  }
  await stop();
  const count = statuses.length;
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(statuses.length, count);
});

test("a failed physical reader reports diagnostics and rediscovers before reconnecting", { skip: process.platform !== "darwin" }, async t => {
  let attempts = 0;
  const entries: LogRecord[] = [];
  const statuses: LogSourceStatus[] = [];
  const stop = startNativeLogs(target, { log: log => entries.push(log), status: status => statuses.push(status) }, async () => {
    attempts++;
    const code = attempts === 1 ? "console.error('fixture disconnect'); process.exit(1)" :
      "console.log('{\"ready\":true}'); console.log('{\"eventMessage\":\"reconnected\",\"process\":\"Example\"}'); setInterval(() => {}, 1000)";
    return { command: process.execPath, args: ["-e", code] };
  });
  t.after(stop);
  await waitFor(() => entries.length > 0);
  assert.equal(attempts, 2);
  assert.ok(statuses.some(status => status.state === "reconnecting" && status.message === "fixture disconnect"));
  assert.equal(entries[0].deviceId, phone.udid);
  assert.equal(statuses.at(-1)?.state, "live");
});

test("MCP validates physical devices independently of Baguette and closes the authorized reader", async t => {
  let current = phone;
  let opened = 0;
  let closed = 0;
  const logs = new LogSessions({ native: selected => {
    assert.deepEqual(selected, target);
    opened++;
    return async () => { closed++; };
  }, metro: () => async () => {} });
  const server = new McpServer({ name: "physical-log-test", version: "1" });
  const baguette = new Baguette("http://127.0.0.1:1");
  registerLogTools(server, logs, baguette, async () => [current]);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "physical-log-client", version: "1" });
  t.after(async () => { await client.close(); await logs.close(); await server.close(); baguette.dispose(); });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  for (const invalid of [{ ...phone, state: "disconnected" }, { ...phone, pairingState: "unpaired" }]) {
    current = invalid;
    const result = await client.callTool({ name: "mobile_logs_session", arguments: { options: { native: target } } });
    assert.equal(result.isError, true);
    assert.equal(opened, 0);
  }
  current = phone;
  const result = await client.callTool({ name: "mobile_logs_session", arguments: { options: { native: target } } });
  assert.equal(result.isError, undefined);
  assert.equal(opened, 1);
  const id = result._meta?.sessionId;
  const closedResult = await client.callTool({ name: "mobile_logs_close", arguments: { sessionId: id } });
  assert.equal(closedResult.isError, undefined);
  assert.equal(closed, 1);
});

test("the native decoder handles missing labels, escapes arbitrary messages, and rejects malformed bounds", { skip: process.platform !== "darwin" }, async t => {
  const temporary = await mkdtemp(join(tmpdir(), "mobile-dev-ios-log-decoder-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const root = resolve("vendor/ios-logs");
  for (const name of ["libplist-2.8.0", "libimobiledevice-1.4.0"]) {
    await execute("tar", ["-xjf", `${root}/sources/${name}.tar.bz2`, "-C", temporary]);
  }
  const binary = join(temporary, "decoder-test");
  await execute("clang", ["-std=c11", "-Wall", "-Wextra", "-Werror", `-I${temporary}/libplist-2.8.0/include`,
    `-I${temporary}/libimobiledevice-1.4.0/include`, "tests/fixtures/ios-log-decoder.c", `${root}/libimobiledevice-1.0.6.dylib`,
    `${root}/libplist-2.0.12.dylib`, "-o", binary]);
  const result = await execute(binary, [], { env: { ...process.env, DYLD_LIBRARY_PATH: root } });
  const lines = result.stdout.trim().split("\n");
  const records = lines.map(parseIOSLog);
  assert.equal(records.length, 2);
  assert.equal(records[0]?.message, 'line\n"quoted" and C:\\\\folder\\"file" 🌍');
  assert.equal(records[0]?.timestamp, "1970-01-01T00:00:42.123Z");
  assert.equal(records[0]?.category, "javascript");
  assert.equal(records[1]?.pid, 456);
  assert.equal(records[1]?.category, undefined);
  assert.equal(records[1]?.subsystem, undefined);
});
