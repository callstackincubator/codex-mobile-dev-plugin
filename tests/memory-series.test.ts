import test from "node:test";
import assert from "node:assert/strict";
import type { CpuSample } from "../src/shared/cpu.ts";
import { createMemorySeries, formatMemory } from "../src/ui/components/performance/memorySeries.ts";

test("memory series shows the first reading before a CPU interval exists and converts bytes to MiB", () => {
  const baseline: CpuSample = { time: 0, interval: 0, cpuPercent: null, memoryBytes: 104857600, threads: [] };
  const series = createMemorySeries([baseline]);
  assert.deepEqual(series.data, [{ time: 0, value: 100 }]);
  assert.equal(series.current, 100);
  assert.equal(series.average, 100);
});

test("memory statistics include decreases and preserve gaps without inventing zero usage", () => {
  const samples: CpuSample[] = [
    { time: 0, interval: 0, cpuPercent: null, memoryBytes: 104857600, threads: [] },
    { time: 1, interval: 1, cpuPercent: 0, memoryBytes: 157286400, threads: [] },
    { time: 2, interval: 1, cpuPercent: 0, memoryBytes: 52428800, threads: [] },
    { time: 3, interval: 1, cpuPercent: null, memoryBytes: null, threads: [] },
  ];
  const series = createMemorySeries(samples);
  assert.deepEqual(series.data, [
    { time: 0, value: 100 }, { time: 1, value: 150 }, { time: 2, value: 50 }, { time: 3, value: null },
  ]);
  assert.equal(series.average, 100);
  assert.equal(series.minimum, 50);
  assert.equal(series.maximum, 150);
  assert.equal(series.current, null);
  const empty = createMemorySeries([]);
  assert.equal(empty.average, null);
  assert.equal(empty.minimum, null);
  assert.equal(empty.maximum, null);
  assert.equal(formatMemory(null), "—");
  assert.equal(formatMemory(0), "0.0 MiB");
  assert.equal(formatMemory(123.456), "123.5 MiB");
});
