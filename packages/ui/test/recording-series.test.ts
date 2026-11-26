import { createIosFrameOverlay, createAndroidFrameOverlay } from "../src/fps-frame-overlay.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { createRecordingCpuSeries, createRecordingFpsSeries, findRecordingChangeRanges } from "../src/recording-series.ts";
import { recordingFixture } from "../../test-support/recording-fixtures.ts";

test("Android markers count each flagged display frame once and preserve unknown coverage and FPS gaps", () => {
  const frame = (token: string, presentType: number, jankType?: number) => ({
    token, startTimeNs: "100000000", endTimeNs: "250000000", presentType, jankType,
  });
  const frames = [frame("1", 2, 48), frame("2", 4), frame("3", 1, 128), frame("4", 3, 512),
    frame("5", 1, 257), frame("6", 1, 2048), frame("7", 5, 16), frame("8", 1, 1)];
  const timeline = { clock: "boottime" as const, intervalEndNs: "1000000000", frames };
  const sample = { time: 5, interval: 1, fps: 60, frameTimeline: timeline };
  const overlay = createAndroidFrameOverlay([sample, { time: 6, interval: 1, fps: 30 }]);
  assert.ok(overlay);
  const markers = overlay.markers.map(({ event }) => "frame" in event && [event.label, event.time]);
  assert.deepEqual(markers, [["Late", 4.25], ["Dropped", 4.25], ["Janky", 4.25], ["Janky", 4.25]]);
  assert.equal(overlay.samples[0].markerCount, 4);
  assert.equal(overlay.samples[1].markerCount, null);
  const gap = createAndroidFrameOverlay([{ ...sample, fps: null }]);
  assert.equal(gap?.markers.length, 4);
  assert.equal(gap?.markers[0].sample, undefined);
  const clipped = createAndroidFrameOverlay([sample], { start: 4, end: 4.25 });
  assert.equal(clipped?.markers.length, 0);
  const absent = createAndroidFrameOverlay([{ time: 2, interval: 1, fps: 0 }]);
  assert.equal(absent, undefined);
});

test("hitches join the displayed FPS intervals across boundaries, missing samples and partial capture", () => {
  const recording = recordingFixture();
  recording.fps.samples = [
    { time: 1, interval: 1, fps: 60 },
    { time: 2, interval: 1.1, fps: 50 },
    { time: 3, interval: 1, fps: null },
    { time: 5, interval: 1, fps: 0 },
    { time: 6, interval: 1, fps: 60 },
  ];
  const events = [0.99, 1, 2.5, 3.5, 4.5].map(time => ({ time, lateMs: 8.33, refreshIntervalMs: 8.33 }));
  const curve = createRecordingFpsSeries(recording);
  const overlay = createIosFrameOverlay({ status: "finished", end: 5.5, events }, curve);
  assert.ok(overlay);
  const readings = overlay.markers.map(hitch => hitch.sample?.fps);
  const counts = overlay.samples.map(sample => sample.markerCount);
  assert.deepEqual(readings, [60, 50, undefined, undefined, 0]);
  assert.deepEqual(counts, [1, 1, 1, null]);
  const idle = createIosFrameOverlay({ status: "finished", end: 6, events: [] }, curve);
  assert.equal(idle?.samples[1].markerCount, 0);
  const missing = createIosFrameOverlay({ status: "unavailable", error: "No trace" }, curve);
  assert.equal(missing, undefined);
  const onlyHitches = createIosFrameOverlay({ status: "finished", end: 6, events }, []);
  assert.equal(onlyHitches?.markers.length, 5);
  assert.equal(onlyHitches?.samples.length, 0);
});

test("CPU readings cover their preceding measured intervals starting at zero", () => {
  const recording = recordingFixture();
  recording.samples = recording.samples.slice(0, 3);
  recording.samples[0].interval = 0;
  recording.samples[2].cpuPercent = 72;
  const points = createRecordingCpuSeries(recording);
  assert.deepEqual(points, [
    { time: 0, value: 20 }, { time: 1, value: 20 },
    { time: 1, value: 72 }, { time: 2, value: 72 },
  ]);
  assert.equal(recording.samples[0].cpuPercent, null);
  assert.equal(recording.samples[1].time, 1);
});

test("CPU intervals preserve missing readings and uncovered gaps", () => {
  const recording = recordingFixture();
  recording.samples = [
    { time: 1, interval: 1, cpuPercent: 20, memoryBytes: null, threads: [] },
    { time: 2, interval: 1, cpuPercent: null, memoryBytes: null, threads: [] },
    { time: 5, interval: 1, cpuPercent: 0, memoryBytes: null, threads: [] },
  ];
  const points = createRecordingCpuSeries(recording);
  assert.deepEqual(points, [
    { time: 0, value: 20 }, { time: 1, value: 20 },
    { time: 1, value: null }, { time: 2, value: null },
    { time: 2, value: null }, { time: 4, value: null },
    { time: 4, value: 0 }, { time: 5, value: 0 },
  ]);
});

test("change highlights identify separate transitions rather than a high flat CPU plateau", () => {
  const recording = recordingFixture();
  const cpu = findRecordingChangeRanges(recording, "cpuPercent");
  assert.deepEqual(cpu, [{ start: 11, end: 12 }, { start: 18, end: 19 }]);
  const memory = findRecordingChangeRanges(recording, "memoryBytes");
  assert.deepEqual(memory, [], "Steady memory growth has no distinct region of rapid change.");
});

test("change density favors rapid oscillation and is independent for CPU and memory", () => {
  const recording = recordingFixture();
  for (const sample of recording.samples) {
    sample.cpuPercent = sample.time < 11 ? 70 : 20;
    if (sample.time >= 11 && sample.time <= 16) sample.cpuPercent = sample.time % 2 === 0 ? 20 : 60;
    const memoryMib = sample.time >= 22 && sample.time <= 25 && sample.time % 2 === 0 ? 300 : 242;
    sample.memoryBytes = memoryMib * 1048576;
  }
  const cpu = findRecordingChangeRanges(recording, "cpuPercent");
  const coversCpuChanges = cpu.some(range => range.start <= 12 && range.end >= 15);
  const excludesCpuPlateau = cpu.every(range => range.start >= 10 && range.end <= 17);
  assert.ok(coversCpuChanges);
  assert.ok(excludesCpuPlateau);
  const memory = findRecordingChangeRanges(recording, "memoryBytes");
  const coversMemoryChanges = memory.some(range => range.start <= 23 && range.end >= 24);
  const excludesEarlyMemory = memory.every(range => range.start >= 21);
  assert.ok(coversMemoryChanges);
  assert.ok(excludesEarlyMemory);
});

test("missing readings and delivery gaps cannot become highlighted transitions", () => {
  const recording = recordingFixture();
  recording.samples = [
    { time: 0, interval: 0, cpuPercent: 0, memoryBytes: 0, threads: [] },
    { time: 1, interval: 1, cpuPercent: 10, memoryBytes: 10, threads: [] },
    { time: 2, interval: 1, cpuPercent: null, memoryBytes: null, threads: [] },
    { time: 3, interval: 1, cpuPercent: 50, memoryBytes: 50, threads: [] },
    { time: 4, interval: 1, cpuPercent: 50, memoryBytes: 50, threads: [] },
    { time: 8, interval: 1, cpuPercent: 200, memoryBytes: 200, threads: [] },
    { time: 9, interval: 1, cpuPercent: 200, memoryBytes: 200, threads: [] },
  ];
  const ranges = findRecordingChangeRanges(recording, "cpuPercent");
  assert.deepEqual(ranges, [{ start: 0, end: 1 }]);
});

test("change density weights elapsed time rather than the number of samples", () => {
  const recording = recordingFixture();
  recording.samples = [
    { time: 0, interval: 0, cpuPercent: 0, memoryBytes: null, threads: [] },
    { time: 1, interval: 1, cpuPercent: 10, memoryBytes: null, threads: [] },
    { time: 1.1, interval: 0.1, cpuPercent: 11, memoryBytes: null, threads: [] },
    { time: 1.2, interval: 0.1, cpuPercent: 12, memoryBytes: null, threads: [] },
    { time: 2, interval: 0.8, cpuPercent: 20, memoryBytes: null, threads: [] },
  ];
  const ranges = findRecordingChangeRanges(recording, "cpuPercent");
  assert.deepEqual(ranges, [], "The same change per second is uniform despite different sampling intervals.");
  for (const sample of recording.samples) sample.cpuPercent = 42;
  const flat = findRecordingChangeRanges(recording, "cpuPercent");
  assert.deepEqual(flat, []);
});

test("FPS interval charts clip boundary intervals while preserving zero and missing readings", () => {
  const recording = recordingFixture();
  recording.durationSeconds = 3;
  recording.fps.samples = [
    { time: 0.5, interval: 1, fps: 0 },
    { time: 1.5, interval: 1, fps: null },
    { time: 3.5, interval: 1, fps: 60 },
  ];
  const points = createRecordingFpsSeries(recording);
  assert.deepEqual(points, [
    { time: 0, value: 0 }, { time: 0.5, value: 0 },
    { time: 0.5, value: null }, { time: 1.5, value: null },
    { time: 1.5, value: null }, { time: 2.5, value: null },
    { time: 2.5, value: 60 }, { time: 3, value: 60 },
  ]);
});
