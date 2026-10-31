import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { createFpsSeries } from "../src/components/performance/fpsSeries.ts";
import { DisplayFpsPanel } from "../src/display-fps-panel.ts";
import type { DisplayFpsState } from "../src/display-fps-panel.ts";
import { fakeApp } from "@mobile-dev/test-support/fake-app.ts";
import type { DisplayFpsBatch } from "@mobile-dev/shared/display-fps.ts";
import type { SimulatorDevice } from "@mobile-dev/shared/protocol.ts";
import { createDeviceApps } from "@mobile-dev/test-support/device-apps-fixtures.ts";
import { PerformancePanel } from "../src/performance-panel.ts";
import type { CpuBatch } from "@mobile-dev/shared/cpu.ts";

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
  assert.deepEqual(series.data, [
    { time: 0, value: 60 }, { time: 1, value: 60 },
    { time: 1, value: 30 }, { time: 3, value: 30 },
    { time: 3, value: 0 }, { time: 4, value: 0 },
    { time: 4, value: null }, { time: 5, value: null },
    { time: 9, value: 20 }, { time: 10, value: 20 },
  ]);
});

test("FPS covers each measured interval from its start and leaves unmeasured time empty", () => {
  const series = createFpsSeries([
    { time: 1, interval: 0, fps: null },
    { time: 2, interval: 1, fps: 60 },
    { time: 5, interval: 1, fps: 20 },
  ]);
  assert.deepEqual(series.data, [
    { time: 1, value: 60 }, { time: 2, value: 60 },
    { time: 2, value: null },
    { time: 4, value: 20 }, { time: 5, value: 20 },
  ]);
});

test("the device FPS panel records on physical iOS without an app, backfills history, and closes on disconnect", async () => {
  let emit: ((batch: DisplayFpsBatch) => void) | undefined;
  const app = fakeApp({
    fallback: () => ({ content: [], structuredContent: { sessionId: "fps", fpsUri: "display-fps://mobile-dev/fps/batch?after=0", timeOrigin: 99 } }),
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
  });
  const calls = () => app.calls.map(call => call.name);
  let state: Partial<DisplayFpsState> = {};
  const panel = new DisplayFpsPanel(app, fields => { state = { ...state, ...fields }; });
  panel.select({ platform: "ios", kind: "physical", udid: "00008150-device", coreDeviceId: "id", name: "iPhone", model: "iPhone", productType: "iPhone18,1", runtime: "iOS 27", state: "connected", pairingState: "paired", transportType: "localNetwork" });
  panel.setAvailable(true);
  panel.show();
  await setImmediate();
  assert.deepEqual(calls(), ["mobile_display_fps_session"]);
  emit?.({ cursor: 1, phase: "recording", samples: [{ time: 100, interval: 1, fps: 0 }, { time: 101, interval: 1, fps: 60 }] });
  await setImmediate();
  emit?.({ cursor: 2, phase: "recording", samples: [{ time: 100, interval: 1, fps: 30 }] });
  await setImmediate();
  assert.deepEqual(state.fpsSamples, [{ time: 100, interval: 1, fps: 30 }, { time: 101, interval: 1, fps: 60 }]);
  await panel.disconnect();
  assert.deepEqual(calls(), ["mobile_display_fps_session", "mobile_display_fps_close"]);
  assert.equal(state.fpsPhase, "stopped");
});

function closeFailureHost() {
  const calls: string[] = [];
  let closeFailure: string | undefined;
  let opening: Promise<void> | undefined;
  let sequence = 0;
  let emit: ((batch: DisplayFpsBatch) => void) | undefined;
  const app = fakeApp({
    tools: {
      mobile_display_fps_close: ({ sessionId }) => {
        calls.push(`close:${sessionId}`);
        if (closeFailure) throw new Error(closeFailure);
        return { content: [] };
      },
    },
    async fallback({ arguments: { target } }) {
      await opening;
      const id = `fps${++sequence}`;
      calls.push(`open:${id}:${(target as { deviceId: string } | undefined)?.deviceId}`);
      return { content: [], structuredContent: { sessionId: id, fpsUri: `display-fps://mobile-dev/${id}/batch?after=0`, timeOrigin: 99 } };
    },
    readServerResource(input: { uri: string }, options: { signal: AbortSignal }) {
      return new Promise((resolve, reject) => {
        const cancelled = () => reject(new Error("cancelled"));
        options.signal.addEventListener("abort", cancelled, { once: true });
        emit = batch => {
          options.signal.removeEventListener("abort", cancelled);
          const text = JSON.stringify(batch);
          resolve({ contents: [{ uri: input.uri, mimeType: "application/json", text }] });
        };
      });
    },
  });
  let state: Partial<DisplayFpsState> = {};
  const panel = new DisplayFpsPanel(app, fields => { state = { ...state, ...fields }; });
  return { panel, calls, state: () => state, emit(batch: DisplayFpsBatch) { emit?.(batch); },
    failClose(message?: string) { closeFailure = message; }, delayOpen(promise: Promise<void>) { opening = promise; } };
}
const pixel: SimulatorDevice = { platform: "android", kind: "emulator", udid: "emulator-5554", name: "Pixel", state: "Booted", runtime: "Android" };
async function settle() { for (let i = 0; i < 8; i++) await setImmediate(); }

test("a transient Display FPS close failure stays visible and is retried before the next session opens", async () => {
  const fake = closeFailureHost();
  const { panel, calls } = fake;
  panel.select(pixel);
  panel.setAvailable(true);
  panel.show();
  await settle();
  assert.deepEqual(calls, ["open:fps1:emulator-5554"]);

  fake.failClose("transient close failure");
  await assert.rejects(panel.stop(), /transient close failure/);
  panel.retry();
  await settle();
  assert.equal(fake.state().fpsPhase, "failed");
  assert.equal(fake.state().fpsError, "transient close failure");
  assert.equal(fake.state().fpsMonitoring, false);
  assert.deepEqual(calls.slice(1), ["close:fps1", "close:fps1"], "No session opens beside one that may still be collecting.");

  fake.failClose();
  panel.retry();
  await settle();
  assert.deepEqual(calls.slice(3), ["close:fps1", "open:fps2:emulator-5554"]);
  fake.emit({ cursor: 1, phase: "recording", samples: [{ time: 100, interval: 1, fps: 60 }] });
  await settle();
  assert.equal(fake.state().fpsPhase, "recording");
  assert.equal(fake.state().fpsError, "");
  assert.deepEqual(fake.state().fpsSamples, [{ time: 100, interval: 1, fps: 60 }]);

  fake.failClose("transient close failure");
  await assert.rejects(panel.stop(), /transient close failure/);
  fake.failClose();
  panel.show();
  await settle();
  assert.deepEqual(calls.slice(5), ["close:fps2", "close:fps2", "open:fps3:emulator-5554"], "Showing the panel again after recovery closes the stale session first.");
  await panel.disconnect();
  assert.deepEqual(calls.slice(8), ["close:fps3"]);
});

test("a Display FPS session that opens after a device switch keeps its failed close for retry", async () => {
  const fake = closeFailureHost();
  const { panel, calls } = fake;
  let resolveOpen!: () => void;
  fake.delayOpen(new Promise(resolve => { resolveOpen = resolve; }));
  panel.select(pixel);
  panel.setAvailable(true);
  panel.show();
  await settle();
  panel.select({ ...pixel, udid: "emulator-5556", name: "Tablet" });
  fake.failClose("transient close failure");
  resolveOpen();
  await settle();
  assert.equal(fake.state().fpsPhase, "failed");
  assert.equal(fake.state().fpsError, "transient close failure");
  assert.deepEqual(calls, ["open:fps1:emulator-5554", "close:fps1", "close:fps1"], "The new device waits for the late session to close.");

  fake.failClose();
  panel.retry();
  await settle();
  assert.deepEqual(calls.slice(3), ["close:fps1", "open:fps2:emulator-5556"]);
  fake.emit({ cursor: 1, phase: "recording", samples: [{ time: 100, interval: 1, fps: 60 }] });
  await settle();
  assert.equal(fake.state().fpsPhase, "recording");
  await panel.disconnect();
  assert.deepEqual(calls.slice(5), ["close:fps2"]);
});

test("CPU and display samples share a clock and selecting another app preserves the device recording", async t => {
  const reads = new Map<string, (batch: CpuBatch | DisplayFpsBatch) => void>();
  let sequence = 0;
  const app = fakeApp({
    tools: {
      mobile_performance_sources: () => ({ content: [], structuredContent: { apps: [
        { bundleId: "app.a", pid: 1 }, { bundleId: "app.b", pid: 2 },
      ] , foregroundApp: null } }),
      mobile_display_fps_session: () => ({ content: [], structuredContent: {
        sessionId: "fps", fpsUri: "display-fps://mobile-dev/fps/batch?after=0", timeOrigin: 100,
      } }),
      mobile_cpu_session: () => {
        const id = `cpu${++sequence}`;
        return { content: [], structuredContent: { sessionId: id, cpuUri: `cpu://mobile-dev/${id}/batch?after=0` } };
      },
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
  });
  const calls = () => app.calls.map(call => call.name);
  const deviceApps = createDeviceApps(app);
  const panel = new PerformancePanel(app, deviceApps);
  t.after(() => { deviceApps.dispose(); return panel.dispose(); });
  deviceApps.selectDevice({ platform: "android", kind: "physical", transportType: "wired", udid: "phone", name: "Android", state: "Booted", runtime: "Android" });
  panel.setAvailable(true);
  deviceApps.setAvailable(true);
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
  const opens = calls().filter(name => name === "mobile_display_fps_session");
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
  const closes = calls().filter(name => name === "mobile_display_fps_close");
  assert.equal(closes.length, 1);
});
