import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { CpuSessions } from "../src/cpu/sessions.ts";
import { registerCpuTools } from "../src/cpu/tools.ts";
import { DeviceResolver } from "../src/devices.ts";
import { DisplayFpsSessions } from "../src/fps/sessions.ts";
import { registerDisplayFpsTools } from "../src/fps/tools.ts";
import { LogSessions } from "../src/log-sessions.ts";
import { registerLogTools } from "../src/log-tools.ts";
import { installTracePropagation, instrumentMcpServer } from "../src/telemetry.ts";
import { fakeSimctl, UDID } from "@mobile-dev/test-support/fixtures.ts";
import { connectClient } from "@mobile-dev/test-support/mcp.ts";

/** Holds the first device validation until released; later validations pass straight through. */
function validationGate() {
  let enter = () => {};
  let release = () => {};
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const released = new Promise<void>(resolve => { release = resolve; });
  return { entered, release, async wait() { enter(); await released; } };
}

async function connect(t: TestContext, register: (server: McpServer) => void) {
  const server = new McpServer({ name: "collector-startup-test", version: "1" });
  instrumentMcpServer(server);
  register(server);
  return connectClient(t, server, { name: "collector-startup-client", prepare: installTracePropagation });
}

/** Cancels a start request while its device validation is pending, then lets validation finish. */
async function cancelDuringValidation(client: Client, gate: ReturnType<typeof validationGate>, name: string, args: Record<string, unknown>) {
  const abort = new AbortController();
  const pending = client.callTool({ name, arguments: args }, undefined, { signal: abort.signal });
  const rejection = assert.rejects(pending);
  await gate.entered;
  abort.abort();
  await rejection;
  gate.release();
  await setImmediate();
}

/** Starts a session, then aborts the request after its response arrived. */
async function startDelivered(client: Client, name: string, args: Record<string, unknown>) {
  const abort = new AbortController();
  const result = await client.callTool({ name, arguments: args }, undefined, { signal: abort.signal });
  assert.equal(result.isError, undefined, JSON.stringify(result.content));
  abort.abort();
  await setImmediate();
  return result.structuredContent as { sessionId: string };
}

test("a CPU start cancelled during validation leaves no monitor, and a delivered session stays open", async t => {
  const gate = validationGate();
  const simctl = fakeSimctl();
  let opened = 0;
  let stopped = 0;
  const cpu = new CpuSessions({ apps: async () => [{ bundleId: "dev.test", pid: 123 }], monitor: async () => {
    opened++;
    return { closed: new Promise(() => {}), async stop() { stopped++; } };
  } });
  t.after(() => cpu.close());
  const client = await connect(t, server => {
    registerCpuTools(server, cpu, new DeviceResolver({ simulators: { async device(udid, booted) { await gate.wait(); return simctl.device(udid, booted); } } }));
  });
  const args = { target: { deviceId: UDID, bundleId: "dev.test" } };
  await cancelDuringValidation(client, gate, "mobile_cpu_session", args);
  assert.equal(opened, stopped);
  const { sessionId } = await startDelivered(client, "mobile_cpu_session", args);
  assert.equal(stopped, opened - 1);
  const reading = await client.callTool({ name: "mobile_read_cpu", arguments: { sessionId } });
  assert.equal(reading.isError, undefined);
  await client.callTool({ name: "mobile_cpu_close", arguments: { sessionId } });
  assert.equal(stopped, opened);
});

test("a Display FPS start cancelled during validation leaves no monitor, and a delivered session stays open", async t => {
  const gate = validationGate();
  let opened = 0;
  let stopped = 0;
  const sessions = new DisplayFpsSessions(async () => {
    opened++;
    return { closed: new Promise(() => {}), async stop() { stopped++; } };
  });
  t.after(() => sessions.close());
  const client = await connect(t, server => {
    registerDisplayFpsTools(server, sessions, new DeviceResolver({ ios: async () => [], android: async () => {
      await gate.wait();
      return [{ id: "emulator-5554", name: "Pixel" }];
    } }));
  });
  const args = { target: { platform: "android", deviceId: "emulator-5554" } };
  await cancelDuringValidation(client, gate, "mobile_display_fps_session", args);
  assert.equal(opened, stopped);
  const { sessionId } = await startDelivered(client, "mobile_display_fps_session", args);
  assert.equal(stopped, opened - 1);
  const reading = await client.callTool({ name: "mobile_read_display_fps", arguments: { sessionId } });
  assert.equal(reading.isError, undefined);
  await client.callTool({ name: "mobile_display_fps_close", arguments: { sessionId } });
  assert.equal(stopped, opened);
});

test("a log start cancelled during validation leaves no reader, and a delivered session stays open", async t => {
  const gate = validationGate();
  const simctl = fakeSimctl();
  let opened = 0;
  let stopped = 0;
  const logs = new LogSessions({ native: () => { opened++; return async () => { stopped++; }; }, metro: () => async () => {} });
  t.after(() => logs.close());
  const client = await connect(t, server => {
    registerLogTools(server, logs, new DeviceResolver({ simulators: { async device(udid, booted) { await gate.wait(); return simctl.device(udid, booted); } } }));
  });
  const args = { options: { native: { platform: "ios", deviceId: UDID } } };
  await cancelDuringValidation(client, gate, "mobile_logs_session", args);
  assert.equal(opened, stopped);
  const { sessionId } = await startDelivered(client, "mobile_logs_session", args);
  assert.equal(stopped, opened - 1);
  const reading = await client.callTool({ name: "mobile_read_logs", arguments: { sessionId } });
  assert.equal(reading.isError, undefined);
  await client.callTool({ name: "mobile_logs_close", arguments: { sessionId } });
  assert.equal(stopped, opened);
});
