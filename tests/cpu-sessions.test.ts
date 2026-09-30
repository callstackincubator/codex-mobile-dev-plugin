import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { CpuSessions } from "../src/server/cpu/sessions.ts";
import { CpuBuffer } from "../src/server/cpu/buffer.ts";
import { parseRunningApps } from "../src/server/cpu/apps.ts";
import type { CpuMonitor } from "../src/server/cpu/monitor.ts";
import type { CpuReading } from "../src/server/cpu/counters.ts";
import { UDID } from "./fixtures.ts";

const target = { deviceId: UDID, bundleId: "com.example.app" };
const pending = () => new Promise<Error>(() => {});

test("running app discovery excludes system services, exited apps, and malformed PIDs", () => {
  const apps = parseRunningApps("PID\tStatus\tLabel\n123\t0\tUIKitApplication:com.example.app[1][rb-legacy]\n-\t0\tUIKitApplication:com.example.stopped[1]\n456\t0\tUIKitApplication:com.apple.Maps[1]\n789\t0\tcom.example.service\n0\t0\tUIKitApplication:com.example.invalid[1]");
  assert.deepEqual(apps, [{ bundleId: "com.example.app", pid: 123 }]);
});

test("CPU batches retain 150 seconds, report only new samples, and release waiting reads on close", async () => {
  const buffer = new CpuBuffer("physical-footprint");
  for (let time = 0; time <= 200; time++) buffer.push({ time, interval: 1, cpuPercent: time, memoryBytes: 104857600, threads: [] });
  const batch = await buffer.read(0, 0);
  assert.equal(batch.samples.length, 151);
  assert.equal(batch.samples[0].time, 50);
  assert.equal(batch.samples.at(-1)?.time, 200);
  const waiting = buffer.read(batch.cursor, 60000);
  buffer.close();
  const closed = await waiting;
  assert.equal(closed.samples.length, 0);
});

test("CPU sessions stream real readings, reserve their target, and detach once", async t => {
  let emit!: (reading: CpuReading) => void;
  let stops = 0;
  const cpu = new CpuSessions({
    apps: async () => [{ bundleId: target.bundleId, pid: 123 }],
    monitor: async options => { emit = options.onSample; return { closed: pending(), async stop() { stops++; } }; },
  });
  t.after(() => cpu.close());
  const id = cpu.open(target);
  await setImmediate();
  emit({ timestampUs: 1000000n, intervalUs: 1000000, cpuPercent: 125, memoryBytes: 104857600, threads: [{ id: "1", name: "main", cpuPercent: 100 }] });
  const batch = await cpu.read(id, 0, 0);
  assert.equal(batch.phase, "recording");
  assert.equal(batch.samples[0].cpuPercent, 125);
  assert.equal(batch.samples[0].threads[0].name, "main");
  assert.equal(batch.samples[0].memoryBytes, 104857600);
  assert.equal(batch.memoryMetric, "physical-footprint");
  assert.throws(() => cpu.open(target), /already has an active CPU monitor/);
  await Promise.all([cpu.closeSession(id), cpu.closeSession(id)]);
  assert.equal(stops, 1);
  await assert.rejects(cpu.read(id, 0, 0), /expired or closed/);
  await assert.rejects(cpu.read("0".repeat(64), 0, 0), /expired or closed/);
});

test("closing during attach cancels startup and waits for a late monitor to detach", async t => {
  let attached!: (monitor: CpuMonitor) => void;
  let signal!: AbortSignal;
  let stops = 0;
  const cpu = new CpuSessions({
    apps: async () => [{ bundleId: target.bundleId, pid: 123 }],
    monitor: options => { signal = options.signal; return new Promise(resolve => { attached = resolve; }); },
  });
  t.after(() => cpu.close());
  const id = cpu.open(target);
  await setImmediate();
  const closing = cpu.closeSession(id);
  assert.equal(signal.aborted, true);
  attached({ closed: pending(), async stop() { stops++; } });
  await closing;
  assert.equal(stops, 1);
  const next = cpu.open(target);
  await cpu.closeSession(next);
});

test("monitor startup failures reach the performance panel without invented samples", async t => {
  const cpu = new CpuSessions({ apps: async () => [], monitor: async () => { throw new Error("Must not attach"); } });
  t.after(() => cpu.close());
  const id = cpu.open(target);
  await setImmediate();
  const batch = await cpu.read(id, 0, 0);
  assert.equal(batch.phase, "failed");
  assert.match(batch.error ?? "", /no longer running/);
  assert.deepEqual(batch.samples, []);
});
