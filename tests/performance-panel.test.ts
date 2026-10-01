import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import type { App } from "@modelcontextprotocol/ext-apps";
import type { CpuApp, CpuBatch, CpuSample, CpuTarget } from "../src/shared/cpu.ts";
import { PerformancePanel } from "../src/ui/performance-panel.ts";
import { UDID, OTHER_UDID } from "./fixtures.ts";

const device = { udid: UDID, name: "iPhone", state: "Booted", runtime: "iOS" };
async function tick() { for (let i = 0; i < 8; i++) await setImmediate(); }

function host() {
  const events: string[] = [];
  const sources: string[] = [];
  const targets: CpuTarget[] = [];
  let apps: CpuApp[] = [{ bundleId: "com.example.app", pid: 123 }];
  let sequence = 0;
  let opening: Promise<void> | undefined;
  let emit: ((batch: CpuBatch) => void) | undefined;
  const app = {
    async callServerTool(input: { name: string; arguments: { sessionId?: string; deviceId?: string; target?: CpuTarget } }) {
      if (input.name === "mobile_performance_sources") {
        sources.push(input.arguments.deviceId!);
        return { content: [], structuredContent: { apps } };
      }
      if (input.name === "mobile_display_fps_session") return { isError: true, content: [{ type: "text", text: "FPS not provided by this CPU fixture" }] };
      if (input.name === "mobile_cpu_close") { events.push(`close:${input.arguments.sessionId}`); return { content: [] }; }
      await opening;
      if (input.arguments.target) targets.push(input.arguments.target);
      const id = String(++sequence).padStart(64, "0");
      events.push(`open:${id}`);
      return { content: [], structuredContent: { sessionId: id, cpuUri: `cpu://mobile-dev/${id}/batch?after=0` } };
    },
    readServerResource(input: { uri: string }, options: { signal: AbortSignal }) {
      return new Promise((resolve, reject) => {
        const fail = () => reject(new Error("Read cancelled"));
        options.signal.addEventListener("abort", fail, { once: true });
        emit = batch => {
          options.signal.removeEventListener("abort", fail);
          const text = JSON.stringify(batch);
          resolve({ contents: [{ uri: input.uri, mimeType: "application/json", text }] });
        };
      });
    },
  };
  return { app: app as unknown as App, events, sources, targets, emit(batch: CpuBatch) { emit?.(batch); },
    setApps(next: CpuApp[]) { apps = next; }, delayOpen(promise: Promise<void>) { opening = promise; } };
}

test("CPU collection defaults to the sole app, persists across tabs, and resets on PID changes", async t => {
  const fake = host();
  const panel = new PerformancePanel(fake.app);
  t.after(() => panel.dispose());
  panel.selectSimulator(device);
  panel.setAvailable(true);
  panel.show();
  await tick();
  assert.equal(panel.getSnapshot().bundleId, "com.example.app");
  assert.equal(fake.events.length, 1);
  fake.emit({ cursor: 1, phase: "recording", memoryMetric: "physical-footprint", samples: [{ time: 1, interval: 1, cpuPercent: 60, memoryBytes: 104857600, threads: [] }] });
  await tick();
  assert.equal(panel.getSnapshot().samples[0].cpuPercent, 60);
  panel.hide();
  assert.equal(panel.getSnapshot().open, false);
  assert.equal(fake.events.length, 1);
  fake.setApps([{ bundleId: "com.example.app", pid: 456 }]);
  await panel.discover();
  await tick();
  const names = fake.events.map(event => event.split(":")[0]);
  assert.deepEqual(names, ["open", "close", "open"]);
  assert.deepEqual(panel.getSnapshot().samples, []);
  await panel.disconnect();
  assert.equal(fake.events.length, 4);
  assert.equal(panel.getSnapshot().phase, "stopped");
});

test("thread identity and recorded activity survive history expiry; sort choice survives tabs and process changes", async t => {
  const fake = host();
  const panel = new PerformancePanel(fake.app);
  t.after(() => panel.dispose());
  panel.selectSimulator(device);
  panel.setAvailable(true);
  panel.show();
  await tick();
  const send = async (time: number, threads: CpuSample["threads"]) => {
    fake.emit({ cursor: time, phase: "recording", memoryMetric: "physical-footprint", samples: [{ time, interval: 1, cpuPercent: 10, memoryBytes: 104857600, threads }] });
    await tick();
  };
  await send(1, [
    { id: "old", name: "", cpuPercent: 0 },
    { id: "kept", name: "", cpuPercent: 10 },
  ]);
  const initial = panel.getSnapshot();
  assert.equal(initial.threadOrder, "activity");
  panel.setThreadOrder("first-seen");
  const first = initial.threadHistory;
  const firstEntries = Array.from(first);
  assert.deepEqual(firstEntries, [["old", { number: 1, peakCpuPercent: 0 }], ["kept", { number: 2, peakCpuPercent: 10 }]]);
  panel.hide();
  panel.show();
  await tick();
  const shown = panel.getSnapshot();
  assert.equal(shown.threadHistory, first);
  assert.equal(shown.threadOrder, "first-seen");
  await send(2, [
    { id: "kept", name: "hades", cpuPercent: 10 },
    { id: "new", name: "", cpuPercent: 0 },
  ]);
  const second = panel.getSnapshot();
  const secondEntries = Array.from(second.threadHistory);
  assert.deepEqual(secondEntries, [["old", { number: 1, peakCpuPercent: 0 }], ["kept", { number: 2, peakCpuPercent: 10 }], ["new", { number: 3, peakCpuPercent: 0 }]]);
  await send(152, [
    { id: "new", name: "", cpuPercent: 0 },
    { id: "kept", name: "hades", cpuPercent: 0 },
    { id: "newer", name: "", cpuPercent: 0 },
  ]);
  const retained = panel.getSnapshot();
  const retainedEntries = Array.from(retained.threadHistory);
  assert.deepEqual(retainedEntries, [["kept", { number: 2, peakCpuPercent: 10 }], ["new", { number: 3, peakCpuPercent: 0 }], ["newer", { number: 4, peakCpuPercent: 0 }]], "Expired threads release their state without reusing their numbers.");
  assert.equal(first.size, 2, "Earlier snapshots remain immutable.");
  await send(303, [
    { id: "newer", name: "", cpuPercent: null },
    { id: "new", name: "", cpuPercent: 0 },
    { id: "kept", name: "hades", cpuPercent: 0 },
  ]);
  const inactive = panel.getSnapshot();
  const inactiveKept = inactive.threadHistory.get("kept");
  assert.equal(inactive.samples.length, 1);
  assert.deepEqual(inactiveKept, { number: 2, peakCpuPercent: 10 }, "The thread retains its activity after every active sample expires.");

  fake.setApps([{ bundleId: "com.example.app", pid: 456 }]);
  await panel.discover();
  await tick();
  const restarting = panel.getSnapshot();
  assert.equal(restarting.threadHistory.size, 0);
  assert.equal(restarting.threadOrder, "first-seen");
  await send(1, [{ id: "restarted", name: "", cpuPercent: 10 }]);
  const restarted = panel.getSnapshot();
  const restartedHistory = restarted.threadHistory.get("restarted");
  assert.deepEqual(restartedHistory, { number: 1, peakCpuPercent: 10 });
});

test("closing during session creation closes the late session before disposal completes", async () => {
  const fake = host();
  let resolveOpen!: () => void;
  fake.delayOpen(new Promise(resolve => { resolveOpen = resolve; }));
  const panel = new PerformancePanel(fake.app);
  panel.selectSimulator(device);
  panel.setAvailable(true);
  panel.show();
  await tick();
  const disposing = panel.dispose();
  resolveOpen();
  await disposing;
  const names = fake.events.map(event => event.split(":")[0]);
  assert.deepEqual(names, ["open", "close"]);
  assert.equal(panel.getSnapshot().open, false);
});

test("switching between iOS and Android closes the previous monitor and selects the active device", async t => {
  const fake = host();
  const panel = new PerformancePanel(fake.app);
  t.after(() => panel.dispose());
  panel.selectSimulator(device);
  panel.setAvailable(true);
  panel.show();
  await tick();
  fake.emit({ cursor: 1, phase: "recording", memoryMetric: "physical-footprint", samples: [{ time: 1, interval: 1, cpuPercent: 60, memoryBytes: 104857600, threads: [] }] });
  await tick();
  panel.setThreadOrder("first-seen");
  panel.selectSimulator({ ...device, udid: "emulator-5554", name: "Pixel", platform: "android" });
  await tick();
  const android = panel.getSnapshot();
  assert.equal(android.threadOrder, "first-seen");
  assert.equal(panel.getSnapshot().phase, "connecting");
  assert.equal(panel.getSnapshot().bundleId, "com.example.app");
  assert.equal(panel.getSnapshot().platform, "android");
  assert.equal(panel.getSnapshot().selectedLabel, "Pixel");
  assert.deepEqual(panel.getSnapshot().samples, []);
  assert.deepEqual(fake.sources, [UDID, "emulator-5554"]);
  assert.deepEqual(fake.targets.at(-1), { platform: "android", deviceId: "emulator-5554", bundleId: "com.example.app" });

  panel.selectSimulator(device);
  await tick();
  const ios = panel.getSnapshot();
  assert.equal(ios.threadOrder, "first-seen");
  assert.equal(panel.getSnapshot().bundleId, "com.example.app");
  assert.equal(panel.getSnapshot().selectedLabel, "iPhone");
  assert.equal(panel.getSnapshot().monitoring, true);
  assert.deepEqual(panel.getSnapshot().samples, []);
  assert.deepEqual(fake.sources, [UDID, "emulator-5554", UDID]);
  assert.equal(fake.targets.at(-1)?.platform, "ios");
  const names = fake.events.map(event => event.split(":")[0]);
  assert.deepEqual(names, ["open", "close", "open", "close", "open"]);
});

test("the default app is selected when it starts after the Performance tab opens", async t => {
  const fake = host();
  fake.setApps([]);
  const panel = new PerformancePanel(fake.app);
  t.after(() => panel.dispose());
  panel.selectSimulator(device);
  panel.setAvailable(true);
  panel.show();
  await tick();
  assert.equal(panel.getSnapshot().bundleId, "");
  assert.deepEqual(fake.events, []);

  fake.setApps([{ bundleId: "com.example.app", pid: 123 }]);
  await panel.discover();
  await tick();
  assert.equal(panel.getSnapshot().bundleId, "com.example.app");
  assert.equal(fake.events.length, 1);
  await panel.discover();
  await tick();
  assert.equal(fake.events.length, 1, "Refreshing the same app keeps its CPU session.");
});

test("multiple apps require a choice and discovery preserves that choice when it exits", async t => {
  const fake = host();
  const first = { bundleId: "com.example.app", pid: 123 };
  const second = { bundleId: "com.example.other", pid: 456 };
  fake.setApps([first, second]);
  const panel = new PerformancePanel(fake.app);
  t.after(() => panel.dispose());
  panel.selectSimulator(device);
  panel.setAvailable(true);
  panel.show();
  await tick();
  assert.equal(panel.getSnapshot().bundleId, "");
  assert.deepEqual(fake.events, []);

  panel.selectApp(second.bundleId);
  await tick();
  await panel.discover();
  await tick();
  assert.equal(panel.getSnapshot().bundleId, second.bundleId);
  assert.equal(fake.events.length, 1);

  fake.setApps([first]);
  await panel.discover();
  await tick();
  assert.equal(panel.getSnapshot().bundleId, second.bundleId);
  const names = fake.events.map(event => event.split(":")[0]);
  assert.deepEqual(names, ["open", "close"]);
});

test("switching devices closes the old monitor and restores each device's selected app", async t => {
  const fake = host();
  const first = { bundleId: "com.example.app", pid: 123 };
  const second = { bundleId: "com.example.other", pid: 456 };
  fake.setApps([first, second]);
  const panel = new PerformancePanel(fake.app);
  t.after(() => panel.dispose());
  panel.selectSimulator(device);
  panel.setAvailable(true);
  panel.show();
  await tick();
  panel.selectApp(second.bundleId);
  await tick();

  fake.setApps([first]);
  panel.selectSimulator({ ...device, udid: OTHER_UDID, name: "Other iPhone" });
  await tick();
  assert.equal(panel.getSnapshot().bundleId, first.bundleId);
  assert.equal(panel.getSnapshot().selectedLabel, "Other iPhone");

  fake.setApps([first, second]);
  panel.selectSimulator(device);
  await tick();
  assert.equal(panel.getSnapshot().bundleId, second.bundleId);
  assert.equal(panel.getSnapshot().selectedLabel, "iPhone");
  const names = fake.events.map(event => event.split(":")[0]);
  assert.deepEqual(names, ["open", "close", "open", "close", "open"]);
});
