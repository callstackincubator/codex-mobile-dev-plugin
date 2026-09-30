import test from "node:test";
import assert from "node:assert/strict";
import type { CpuSample } from "../src/shared/cpu.ts";
import { createCpuSeries, orderCpuThreads } from "../src/ui/components/performance/cpuSeries.ts";
import type { ThreadHistory } from "../src/ui/performance/types.ts";

test("weights the CPU average by measured time and excludes unknown readings", () => {
  const samples: CpuSample[] = [
    { time: 0, interval: 0, cpuPercent: null, threads: [] },
    { time: 0.25, interval: 0.25, cpuPercent: 100, threads: [] },
    { time: 1, interval: 0.75, cpuPercent: 20, threads: [] },
    { time: 1.25, interval: 0.25, cpuPercent: null, threads: [] },
  ];
  const series = createCpuSeries(samples);
  assert.equal(series.average, 40);
  assert.equal(series.maximum, 100);
  assert.equal(series.current, null);
});

test("activity order uses current CPU, remembers prior activity and keeps equal readings stable", () => {
  const samples: CpuSample[] = [
    { time: 1, interval: 1, cpuPercent: 70, threads: [
      { id: "never", name: "", cpuPercent: 0 },
      { id: "earlier", name: "", cpuPercent: 50 },
      { id: "busy", name: "", cpuPercent: 20 },
      { id: "tie", name: "", cpuPercent: 0 },
      { id: "unknown", name: "", cpuPercent: null },
    ] },
    { time: 2, interval: 1, cpuPercent: 80, threads: [
      { id: "unknown", name: "", cpuPercent: null },
      { id: "tie", name: "", cpuPercent: 40 },
      { id: "never", name: "", cpuPercent: 0 },
      { id: "busy", name: "", cpuPercent: 40 },
    ] },
  ];
  const series = createCpuSeries(samples);
  const history = new Map<string, ThreadHistory>([
    ["never", { number: 1, peakCpuPercent: 0 }],
    ["earlier", { number: 2, peakCpuPercent: 50 }],
    ["busy", { number: 3, peakCpuPercent: 40 }],
    ["tie", { number: 4, peakCpuPercent: 40 }],
    ["unknown", { number: 5, peakCpuPercent: 0 }],
  ]);
  const sorted = orderCpuThreads(series.threads, history, "activity");
  const ids = sorted.map(thread => thread.id);
  assert.deepEqual(ids, ["busy", "tie", "earlier", "never", "unknown"]);
  const originalIds = series.threads.map(thread => thread.id);
  assert.deepEqual(originalIds, ["never", "earlier", "busy", "tie", "unknown"]);

  samples.push({ time: 3, interval: 1, cpuPercent: 80, threads: [
    { id: "tie", name: "", cpuPercent: 60 },
    { id: "busy", name: "", cpuPercent: 20 },
    { id: "never", name: "", cpuPercent: 0 },
    { id: "unknown", name: "", cpuPercent: null },
  ] });
  const nextSeries = createCpuSeries(samples);
  const next = orderCpuThreads(nextSeries.threads, history, "activity");
  const nextIds = next.map(thread => thread.id);
  assert.deepEqual(nextIds, ["tie", "busy", "earlier", "never", "unknown"]);
});

test("first-seen order follows stable recording numbers when retained samples enumerate differently", () => {
  const samples: CpuSample[] = [{ time: 200, interval: 1, cpuPercent: 70, threads: [
    { id: "newest", name: "", cpuPercent: 70 },
    { id: "middle", name: "", cpuPercent: 0 },
    { id: "first", name: "", cpuPercent: null },
  ] }];
  const series = createCpuSeries(samples);
  const history = new Map<string, ThreadHistory>([
    ["first", { number: 1, peakCpuPercent: 0 }],
    ["middle", { number: 2, peakCpuPercent: 0 }],
    ["newest", { number: 3, peakCpuPercent: 70 }],
  ]);
  const sorted = orderCpuThreads(series.threads, history, "first-seen");
  const ids = sorted.map(thread => thread.id);
  assert.deepEqual(ids, ["first", "middle", "newest"]);
});

test("keeps distinct thread IDs and gaps when a thread leaves the sample", () => {
  const samples: CpuSample[] = [
    { time: 0, interval: 0, cpuPercent: null, threads: [
      { id: "1", name: "worker", cpuPercent: null },
      { id: "2", name: "worker", cpuPercent: null },
    ] },
    { time: 0.25, interval: 0.25, cpuPercent: 70, threads: [
      { id: "1", name: "worker", cpuPercent: 50 },
      { id: "2", name: "worker", cpuPercent: 20 },
    ] },
    { time: 0.5, interval: 0.25, cpuPercent: 10, threads: [
      { id: "2", name: "renamed worker", cpuPercent: 10 },
    ] },
  ];
  const series = createCpuSeries(samples);
  assert.equal(series.threadCount, 1);
  assert.equal(series.threads.length, 2);
  assert.deepEqual(series.threads[0], { id: "1", name: "worker", running: false, data: [
    { time: 0, value: null }, { time: 0.25, value: 50 }, { time: 0.5, value: null },
  ] });
  assert.equal(series.threads[1].name, "renamed worker");
  assert.equal(series.threads[1].running, true);
});
