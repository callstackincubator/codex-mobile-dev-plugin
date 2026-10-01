import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { FrameTimeline } from "../src/server/fps/frame-timeline.ts";
import type { FpsMonitorOptions } from "../src/server/fps/source.ts";
import type { FrameReading } from "../src/server/fps/frame-timeline.ts";
import { DisplayFpsSessions } from "../src/server/fps/sessions.ts";
import { createFpsSeries } from "../src/ui/components/performance/fpsSeries.ts";
import { DisplayFpsPanel } from "../src/ui/display-fps-panel.ts";
import type { DisplayFpsState } from "../src/ui/display-fps-panel.ts";
import type { App } from "@modelcontextprotocol/ext-apps";
import type { DisplayFpsBatch } from "../src/shared/display-fps.ts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerDisplayFpsTools } from "../src/server/fps/tools.ts";
import { PerformancePanel } from "../src/ui/performance-panel.ts";
import type { CpuBatch } from "../src/shared/cpu.ts";

function encode(value: bigint | number) {
  let remaining = BigInt(value);
  const bytes: number[] = [];
  do {
    const low = Number(remaining & 127n);
    const byte = low | (remaining > 127n ? 128 : 0);
    bytes.push(byte);
    remaining >>= 7n;
  } while (remaining);
  return Buffer.from(bytes);
}
function integer(id: number, value: bigint | number) {
  const tag = encode(id * 8);
  const data = encode(value);
  return Buffer.concat([tag, data]);
}
function message(id: number, bytes: Buffer) {
  const tag = encode(id * 8 + 2);
  const length = encode(bytes.length);
  return Buffer.concat([tag, length, bytes]);
}
function packet(time: number, data: Buffer, extra?: Buffer) {
  const rounded = Math.round(time * 1e9);
  const nanos = BigInt(rounded);
  const timestamp = integer(8, nanos);
  const parts = extra ? [timestamp, data, extra] : [timestamp, data];
  const bytes = Buffer.concat(parts);
  return message(1, bytes);
}
function service(time: number, id: number) {
  const flag = integer(id, 1);
  const event = message(69, flag);
  return packet(time, event);
}
function frame(time: number, cookie: bigint, token: bigint, present = 1, kind = 2) {
  const identity = integer(1, cookie);
  const display = integer(2, token);
  const presentation = integer(4, present);
  const detail = Buffer.concat([identity, display, presentation]);
  const start = message(kind, detail);
  const startEvent = message(76, start);
  const end = message(5, identity);
  const endEvent = message(76, end);
  const first = packet(time - 0.01, startEvent);
  const last = packet(time, endEvent);
  const packets = [first, last];
  return Buffer.concat(packets);
}

test("FrameTimeline counts presented compositor frames once, excludes layers and dropped frames, and handles split packets", () => {
  const readings: FrameReading[] = [];
  const parser = new FrameTimeline(reading => readings.push(reading), () => 100);
  const first = service(10, 1);
  const presented = frame(10.5, 9007199254740993n, 9007199254740994n);
  const duplicate = frame(10.6, 11n, 9007199254740994n);
  const layer = frame(10.7, 12n, 15n, 1, 4);
  const dropped = frame(10.8, 13n, 16n, 4);
  const late = frame(10.9, 14n, 17n, 2);
  const completed = service(14, 4);
  const trace = Buffer.concat([first, presented, duplicate, layer, dropped, late, completed]);
  for (let offset = 0; offset < trace.length; offset += 3) {
    const chunk = trace.subarray(offset, offset + 3);
    parser.push(chunk);
  }
  const values = readings.map(reading => reading.fps);
  assert.deepEqual(values, [2, 0]);
  assert.equal(readings[0].interval, 1);
  assert.equal(readings[0].recordedAt, 97);
});

test("late presentation events revise their original interval and unknown presentation states remain missing", () => {
  const readings: FrameReading[] = [];
  const parser = new FrameTimeline(reading => readings.push(reading), () => 100);
  const started = service(10, 1);
  const completed = service(14, 4);
  parser.push(started);
  parser.push(completed);
  const delayed = frame(10.5, 1n, 1n);
  parser.push(delayed);
  const revised = readings.at(-1);
  assert.deepEqual(revised, { fps: 1, interval: 1, recordedAt: 97 });
  const unknown = frame(11.5, 2n, 2n, 5);
  parser.push(unknown);
  const invalid = readings.at(-1);
  assert.deepEqual(invalid, { fps: null, interval: 1, recordedAt: 98 });
});

test("the first sequence packet may carry dropped=true; subsequent packet loss fails the stream", () => {
  const parser = new FrameTimeline(() => {});
  const sequence = integer(10, 4);
  const dropped = integer(42, 1);
  const flags = Buffer.concat([sequence, dropped]);
  const flag = integer(1, 1);
  const event = message(69, flag);
  const first = packet(10, event, flags);
  parser.push(first);
  const second = packet(11, event, flags);
  assert.throws(() => parser.push(second), /lost trace packets/);
});

test("Android 12 monotonic FrameTimeline timestamps align to the service's boottime clock", () => {
  const readings: FrameReading[] = [];
  const parser = new FrameTimeline(reading => readings.push(reading), () => 100);
  const monoId = integer(1, 3);
  const monoTime = integer(2, 10_000_000_000n);
  const mono = Buffer.concat([monoId, monoTime]);
  const bootId = integer(1, 6);
  const bootTime = integer(2, 50_000_000_000n);
  const boot = Buffer.concat([bootId, bootTime]);
  const monoClock = message(1, mono);
  const bootClock = message(1, boot);
  const snapshot = Buffer.concat([monoClock, bootClock]);
  const synchronization = message(6, snapshot);
  const synchronized = packet(50, synchronization);
  const started = service(50, 1);
  parser.push(synchronized);
  parser.push(started);
  const identity = integer(1, 1);
  const token = integer(2, 1);
  const presented = integer(4, 1);
  const details = Buffer.concat([identity, token, presented]);
  const beginning = message(2, details);
  const start = message(76, beginning);
  const ending = message(5, identity);
  const end = message(76, ending);
  const clock = integer(58, 3);
  const startedFrame = packet(10.4, start, clock);
  const endedFrame = packet(10.5, end, clock);
  const completed = service(54, 4);
  parser.push(startedFrame);
  parser.push(endedFrame);
  parser.push(completed);
  assert.equal(readings[0].fps, 1);
  assert.equal(readings[0].recordedAt, 97);
});

test("FPS sessions reserve a device, retain corrections by timestamp, and release a pending startup exactly once", async t => {
  let options: FpsMonitorOptions | undefined;
  let connected!: () => void;
  const waiting = new Promise<void>(resolve => { connected = resolve; });
  let stops = 0;
  const sessions = new DisplayFpsSessions(async input => {
    options = input;
    await waiting;
    return { stop: async () => { stops++; }, closed: new Promise<Error>(() => {}) };
  });
  t.after(() => sessions.close());
  const target = { platform: "android" as const, deviceId: "phone" };
  const id = sessions.open(target);
  assert.throws(() => sessions.open(target), /already has/);
  assert.ok(options);
  options.onSample({ fps: 0, interval: 1, recordedAt: 100 });
  const initial = await sessions.read(id, 0, 0);
  options.onSample({ fps: 60, interval: 1, recordedAt: 100 });
  const correction = await sessions.read(id, initial.cursor, 0);
  assert.deepEqual(correction.samples, [{ fps: 60, interval: 1, time: 100 }]);
  const all = await sessions.read(id, 0, 0);
  assert.equal(all.samples.length, 1);
  const closing = sessions.closeSession(id);
  assert.equal(options.signal.aborted, true);
  connected();
  await closing;
  assert.equal(stops, 1);
  const expiredRead = sessions.read(id, 0, 0);
  await assert.rejects(expiredRead, /expired or closed/);
});

test("FPS startup errors remain visible without invented measurements", async t => {
  const sessions = new DisplayFpsSessions(async () => { throw new Error("FrameTimeline unavailable"); });
  t.after(() => sessions.close());
  const id = sessions.open({ platform: "android", deviceId: "phone" });
  await setImmediate();
  const batch = await sessions.read(id, 0, 0);
  assert.equal(batch.phase, "failed");
  assert.equal(batch.error, "FrameTimeline unavailable");
  assert.deepEqual(batch.samples, []);
});

test("text clients record device-wide FPS without an app or simulator backend, and reject iOS simulators", async t => {
  let stops = 0;
  const sessions = new DisplayFpsSessions(async input => {
    input.onSample({ fps: 60, interval: 1, recordedAt: 100 });
    return { stop: async () => { stops++; }, closed: new Promise<Error>(() => {}) };
  });
  const server = new McpServer({ name: "fps", version: "1" });
  registerDisplayFpsTools(server, sessions, { android: async () => [{ id: "phone", name: "Phone" }], ios: async () => [] });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "fps", version: "1" });
  t.after(async () => { await client.close(); await sessions.close(); await server.close(); });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const listed = await client.listTools();
  const names = listed.tools.map(tool => tool.name);
  assert.deepEqual(names, ["mobile_display_fps_session", "mobile_read_display_fps", "mobile_display_fps_close"]);
  const opened = await client.callTool({ name: "mobile_display_fps_session", arguments: { target: { platform: "android", deviceId: "phone" } } });
  assert.equal(opened.isError, undefined);
  const id = opened.structuredContent?.sessionId;
  const uri = opened.structuredContent?.fpsUri;
  assert.equal(typeof id, "string");
  assert.equal(typeof uri, "string");
  assert.equal(typeof opened.structuredContent?.timeOrigin, "number");
  const read = await client.callTool({ name: "mobile_read_display_fps", arguments: { sessionId: id } });
  const samples = read.structuredContent?.samples;
  assert.deepEqual(samples, [{ time: 100, interval: 1, fps: 60 }]);
  assert.equal(typeof uri, "string");
  if (typeof uri !== "string") throw new Error("Missing resource");
  const resource = await client.readResource({ uri });
  const content = resource.contents[0];
  assert.ok("text" in content);
  const batch = JSON.parse(content.text);
  assert.deepEqual(batch.samples, samples);
  await client.callTool({ name: "mobile_display_fps_close", arguments: { sessionId: id } });
  assert.equal(stops, 1);
  const unsupported = await client.callTool({ name: "mobile_display_fps_session", arguments: { target: { platform: "ios", deviceId: "11111111-1111-4111-8111-111111111111" } } });
  assert.equal(unsupported.isError, true);
  const text = unsupported.content.find(item => item.type === "text");
  assert.ok(text && "text" in text);
  assert.match(text.text, /physical iOS devices/);
});

test("FPS statistics include idle zeros, weight interval duration, and leave missing intervals as gaps", () => {
  const samples = [
    { time: 1, interval: 1, fps: 60 }, { time: 3, interval: 2, fps: 30 },
    { time: 4, interval: 1, fps: 0 }, { time: 5, interval: 1, fps: null },
    { time: 10, interval: 1, fps: 20 },
  ];
  const series = createFpsSeries(samples);
  assert.equal(series.average, 28);
  assert.equal(series.minimum, 0);
  assert.equal(series.maximum, 60);
  assert.equal(series.current, 20);
  const gap = series.data.at(-2);
  assert.deepEqual(gap, { time: 5.001, value: null });
});

test("the device FPS panel records on physical iOS without an app, backfills history, and closes on disconnect", async () => {
  const calls: string[] = [];
  let emit: ((batch: DisplayFpsBatch) => void) | undefined;
  const app = {
    async callServerTool(input: { name: string }) {
      calls.push(input.name);
      return { content: [], structuredContent: { sessionId: "fps", fpsUri: "display-fps://mobile-dev/fps/batch?after=0", timeOrigin: 99 } };
    },
    readServerResource(input: { uri: string }, options: { signal: AbortSignal }) {
      return new Promise((resolve, reject) => {
        const cancelled = () => {
          const error = new Error("cancelled");
          reject(error);
        };
        options.signal.addEventListener("abort", cancelled, { once: true });
        emit = batch => {
          options.signal.removeEventListener("abort", cancelled);
          const text = JSON.stringify(batch);
          resolve({ contents: [{ uri: input.uri, mimeType: "application/json", text }] });
        };
      });
    },
  };
  let state: Partial<DisplayFpsState> = {};
  const panel = new DisplayFpsPanel(app as unknown as App, fields => { state = { ...state, ...fields }; });
  panel.select({ platform: "ios", kind: "physical", udid: "00008150-device", coreDeviceId: "id", name: "iPhone", model: "iPhone", productType: "iPhone18,1", runtime: "iOS 27", state: "connected", pairingState: "paired", transportType: "localNetwork" });
  panel.setAvailable(true);
  panel.show();
  await setImmediate();
  assert.deepEqual(calls, ["mobile_display_fps_session"]);
  emit?.({ cursor: 1, phase: "recording", samples: [{ time: 100, interval: 1, fps: 0 }, { time: 101, interval: 1, fps: 60 }] });
  await setImmediate();
  emit?.({ cursor: 2, phase: "recording", samples: [{ time: 100, interval: 1, fps: 30 }] });
  await setImmediate();
  assert.deepEqual(state.fpsSamples, [{ time: 100, interval: 1, fps: 30 }, { time: 101, interval: 1, fps: 60 }]);
  await panel.disconnect();
  assert.deepEqual(calls, ["mobile_display_fps_session", "mobile_display_fps_close"]);
  assert.equal(state.fpsPhase, "stopped");
});

test("CPU and display samples share a clock and selecting another app preserves the device recording", async t => {
  const calls: string[] = [];
  const reads = new Map<string, (batch: CpuBatch | DisplayFpsBatch) => void>();
  let sequence = 0;
  const app = {
    async callServerTool(input: { name: string }) {
      calls.push(input.name);
      if (input.name === "mobile_performance_sources") return { content: [], structuredContent: { apps: [
        { bundleId: "app.a", pid: 1 }, { bundleId: "app.b", pid: 2 },
      ] } };
      if (input.name === "mobile_display_fps_session") return { content: [], structuredContent: {
        sessionId: "fps", fpsUri: "display-fps://mobile-dev/fps/batch?after=0", timeOrigin: 100,
      } };
      if (input.name === "mobile_cpu_session") {
        const id = `cpu${++sequence}`;
        return { content: [], structuredContent: { sessionId: id, cpuUri: `cpu://mobile-dev/${id}/batch?after=0` } };
      }
      return { content: [] };
    },
    readServerResource(input: { uri: string }, options: { signal: AbortSignal }) {
      return new Promise((resolve, reject) => {
        const url = new URL(input.uri);
        const cancelled = () => {
          const error = new Error("cancelled");
          reject(error);
        };
        options.signal.addEventListener("abort", cancelled, { once: true });
        reads.set(url.protocol, batch => {
          options.signal.removeEventListener("abort", cancelled);
          const text = JSON.stringify(batch);
          resolve({ contents: [{ uri: input.uri, mimeType: "application/json", text }] });
        });
      });
    },
  };
  const panel = new PerformancePanel(app as unknown as App);
  t.after(() => panel.dispose());
  panel.selectSimulator({ platform: "android", udid: "phone", name: "Android", state: "Booted", runtime: "Android" });
  panel.setAvailable(true);
  panel.show();
  await setImmediate();
  panel.selectApp("app.a");
  await setImmediate();
  const cpu = reads.get("cpu:");
  const fps = reads.get("display-fps:");
  assert.ok(cpu && fps);
  cpu({ cursor: 1, phase: "recording", timeOrigin: 100, memoryMetric: "rss", samples: [
    { time: 2, interval: 1, cpuPercent: 20, memoryBytes: 100, threads: [] },
  ] });
  fps({ cursor: 1, phase: "recording", samples: [{ time: 102, interval: 1, fps: 60 }] });
  await setImmediate();
  const initial = panel.getSnapshot();
  assert.equal(initial.samples[0].time, initial.fpsSamples[0].time);
  panel.selectApp("app.b");
  await setImmediate();
  const changedApp = panel.getSnapshot();
  assert.equal(changedApp.fpsSamples, initial.fpsSamples);
  const opens = calls.filter(name => name === "mobile_display_fps_session");
  assert.equal(opens.length, 1);
  const next = reads.get("cpu:");
  assert.ok(next);
  next({ cursor: 1, phase: "recording", timeOrigin: 110, memoryMetric: "rss", samples: [
    { time: 1, interval: 1, cpuPercent: 10, memoryBytes: 100, threads: [] },
  ] });
  await setImmediate();
  const nextApp = panel.getSnapshot();
  assert.equal(nextApp.samples[0].time, 11);
  await panel.disconnect();
  const closes = calls.filter(name => name === "mobile_display_fps_close");
  assert.equal(closes.length, 1);
});
