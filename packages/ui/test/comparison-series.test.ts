import test from "node:test";
import assert from "node:assert/strict";
import { createComparisonSeries, findSharpChanges, hasComparisonReadings } from "../src/comparison-series.ts";
import { comparisonSchema, summarizeComparison } from "@mobile-dev/shared/performance-comparison.ts";
import { recordingFixture } from "@mobile-dev/test-support/recording-fixtures.ts";

test("overlays align elapsed times across different sampling intervals without stretching or extending runs", () => {
  const first = recordingFixture();
  first.durationSeconds = 3;
  first.samples = [
    { time: 1, interval: 1, cpuPercent: 20, memoryBytes: 1048576, threads: [] },
    { time: 2, interval: 1, cpuPercent: 80, memoryBytes: 3145728, threads: [] },
    { time: 3, interval: 1, cpuPercent: 40, memoryBytes: null, threads: [] },
  ];
  const second = recordingFixture();
  second.durationSeconds = 2;
  second.samples = [
    { time: 0.5, interval: 0.5, cpuPercent: 10, memoryBytes: 1048576, threads: [] },
    { time: 1.5, interval: 0.5, cpuPercent: 30, memoryBytes: 3145728, threads: [] },
    { time: 2, interval: 0.5, cpuPercent: 50, memoryBytes: 4194304, threads: [] },
  ];
  const rows = createComparisonSeries([first, second], "cpu");
  const atHalf = rows.filter(row => row.time === 0.5);
  assert.deepEqual(atHalf, [{ time: 0.5, run0: 20, run1: 10 }, { time: 0.5, run0: 20, run1: null }]);
  const atBoundary = rows.filter(row => row.time === 1);
  assert.deepEqual(atBoundary, [{ time: 1, run0: 20, run1: null }, { time: 1, run0: 80, run1: 30 }]);
  const afterShortRun = rows.find(row => row.time === 3);
  assert.deepEqual(afterShortRun, { time: 3, run0: 40, run1: null });
  const memory = createComparisonSeries([first, second], "rss");
  const interpolated = memory.filter(row => row.time === 1.5);
  assert.deepEqual(interpolated, [{ time: 1.5, run0: 2, run1: null }, { time: 1.5, run0: 2, run1: 3 }]);
  const missing = memory.find(row => row.time === 3);
  assert.equal(missing?.run0, null);
  assert.equal(missing?.run1, null);
});

test("memory definitions, missing intervals and unavailable FPS remain separate gaps", () => {
  const first = recordingFixture();
  const second = recordingFixture();
  second.memoryMetric = "physical-footprint";
  second.samples = [first.samples[0], first.samples[3]];
  second.fps = { status: "unavailable", samples: [] };
  const rss = createComparisonSeries([first, second], "rss");
  assert.ok(rss.every(row => row.run1 === null));
  const footprint = createComparisonSeries([first, second], "physical-footprint");
  assert.ok(footprint.every(row => row.run0 === null));
  assert.ok(footprint.some(row => row.time === 0 && row.run1 === null));
  const fps = createComparisonSeries([first, second], "fps");
  assert.ok(fps.every(row => row.run1 === null));
  const cpu = createComparisonSeries([first, second], "cpu");
  const inGap = cpu.find(row => row.time === 1);
  assert.equal(inGap?.run1, null);
});

test("shared selections clip summaries to each run and reject active or duplicate recordings", () => {
  const first = recordingFixture();
  const second = recordingFixture();
  second.id = "44b7030b-a74e-466f-aeb0-bcd3ae8af972";
  second.durationSeconds = 15;
  second.samples = second.samples.slice(0, 16);
  second.fps.samples = second.fps.samples.slice(0, 15);
  const selected = summarizeComparison([first, second], { start: 12, end: 18 });
  assert.deepEqual(selected[1].range, { start: 12, end: 15 });
  assert.equal(selected[1].summary?.averageCpuPercent, 72);
  assert.equal(selected[1].summary?.averageFps, 30);
  const outside = summarizeComparison([first, second], { start: 20, end: 25 });
  assert.equal(outside[1].summary, null);
  assert.equal(outside[1].range, null);
  const valid = comparisonSchema.safeParse({ title: "Before / after", recordings: [first, second] });
  assert.equal(valid.success, true);
  const duplicates = comparisonSchema.safeParse({ title: "Before / after", recordings: [first, first] });
  assert.equal(duplicates.success, false);
  second.status = "recording";
  const active = comparisonSchema.safeParse({ title: "Before / after", recordings: [first, second] });
  assert.equal(active.success, false);
});

test("a comparison track is available when any run has a reading", () => {
  assert.equal(hasComparisonReadings([{ time: 0, run0: null, run1: null }, { time: 1, run0: null, run1: 4 }], 2), true);
  assert.equal(hasComparisonReadings([{ time: 0, run0: null, run1: null }], 2), false);
  assert.equal(hasComparisonReadings([], 2), false);
});

test("sharp changes mark every jump, spike and dip by a fixed amount, and leave steady runs empty", () => {
  const MiB = 1048576;
  const cpu = [3, 3, 40, 84, 84, 57, 83, 83];
  const steady = recordingFixture();
  steady.durationSeconds = 8;
  steady.samples = cpu.map((_, index) => ({ time: index + 1, interval: 1, cpuPercent: 2 + (index % 2) * 3, memoryBytes: 700 * MiB, threads: [] }));
  const busy = recordingFixture();
  busy.durationSeconds = 8;
  busy.samples = cpu.map((value, index) => ({ time: index + 1, interval: 1, cpuPercent: value, memoryBytes: (index < 6 ? 700 : 820) * MiB, threads: [] }));
  const [quiet, changes] = findSharpChanges([steady, busy]);
  // A run that only wobbles has nothing to mark, however loud the other run is.
  assert.deepEqual(quiet, []);
  assert.deepEqual(changes.map(change => [change.metric, change.start, change.end, change.values]), [
    ["cpu", 2, 4, [3, 40, 84]],
    ["cpu", 5, 7, [84, 57, 83]],
    ["memory", 6, 7, [700, 820]],
  ]);
});

test("sharp changes need a larger step across slower readings and never bridge a gap", () => {
  const recording = recordingFixture();
  recording.durationSeconds = 10;
  recording.samples = [
    { time: 2, interval: 2, cpuPercent: 10, memoryBytes: null, threads: [] },
    { time: 4, interval: 2, cpuPercent: 25, memoryBytes: null, threads: [] },
    { time: 6, interval: 2, cpuPercent: 50, memoryBytes: null, threads: [] },
    { time: 10, interval: 2, cpuPercent: 90, memoryBytes: null, threads: [] },
  ];
  // 15 points over two seconds is not sharp; 25 is. The four-second gap is missing readings, not a change.
  assert.deepEqual(findSharpChanges([recording])[0].map(change => [change.start, change.end]), [[4, 6]]);
});
