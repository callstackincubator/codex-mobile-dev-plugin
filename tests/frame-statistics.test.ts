import test from "node:test";
import assert from "node:assert/strict";
import { summarizeDisplayFrames } from "../src/shared/frame-statistics.ts";
import type { DisplayFrame, DisplayFpsSample } from "../src/shared/display-fps.ts";

const ORIGIN = 9_007_199_254_740_993n;

function frame(offsetNs: bigint, presentType: number, jankType?: number): DisplayFrame {
  const end = ORIGIN + offsetNs;
  const start = end - 10_000n;
  const token = offsetNs.toString();
  const startTimeNs = start.toString();
  const endTimeNs = end.toString();
  return { token, startTimeNs, endTimeNs, presentType, jankType };
}

function sample(time: number, frames: DisplayFrame[]): DisplayFpsSample {
  const rounded = Math.round(time * 1e9);
  const intervalNs = BigInt(rounded);
  const end = ORIGIN + intervalNs;
  const intervalEndNs = end.toString();
  return { time, interval: 1, fps: frames.length, frameTimeline: { clock: "boottime", intervalEndNs, frames } };
}

test("jank uses classified presented frames, counts each bitmask once, and separates unknown and dropped frames", () => {
  const onTime = frame(10_000_000n, 1, 1);
  const late = frame(20_000_000n, 2, 1);
  const early = frame(30_000_000n, 3, 48);
  const stuffing = frame(40_000_000n, 1, 128);
  const unspecified = frame(50_000_000n, 1, 0);
  const unknown = frame(60_000_000n, 1, 256);
  const mixedUnknown = frame(70_000_000n, 1, 258);
  const futureReason = frame(80_000_000n, 1, 2048);
  const missing = frame(90_000_000n, 1);
  const dropped = frame(100_000_000n, 4, 2);
  const unknownPresentation = frame(110_000_000n, 5, 2);
  const droppedReason = frame(120_000_000n, 1, 1024);
  const frames = [onTime, late, early, stuffing, unspecified, unknown, mixedUnknown, futureReason, missing, dropped, unknownPresentation, droppedReason];
  const reading = sample(1, frames);
  const stats = summarizeDisplayFrames([reading], 1);
  assert.ok(stats);
  assert.equal(stats.frameCount, 12);
  assert.equal(stats.presentedFrameCount, 10);
  assert.equal(stats.classifiedPresentedFrameCount, 5);
  assert.equal(stats.unclassifiedPresentedFrameCount, 5);
  assert.equal(stats.jankyPresentedFrameCount, 3);
  assert.equal(stats.jankRatePercent, 60);
  assert.equal(stats.classificationCoveragePercent, 50);
  assert.equal(stats.droppedFrameCount, 1);
  assert.equal(stats.droppedFrameRatePercent, 100 / 11);
  assert.equal(stats.unknownPresentationFrameCount, 1);
  assert.equal(stats.frameIntervalCount, 8, "An unknown presentation breaks pacing continuity.");
});

test("missing classification, a captured idle interval, and unavailable frame data never imply zero jank", () => {
  const unclassified = frame(250_000_000n, 1, 0);
  const reading = sample(1, [unclassified]);
  const unknown = summarizeDisplayFrames([reading], 1);
  assert.ok(unknown);
  assert.equal(unknown.jankRatePercent, null);
  assert.equal(unknown.classificationCoveragePercent, 0);
  assert.equal(unknown.p95FrameIntervalMs, null);
  const empty = sample(1, []);
  const idle = summarizeDisplayFrames([empty], 1);
  assert.ok(idle);
  assert.equal(idle.frameCount, 0);
  assert.equal(idle.jankRatePercent, null);
  assert.equal(idle.classificationCoveragePercent, null);
  const missing = summarizeDisplayFrames([{ time: 1, interval: 1, fps: 60 }], 1);
  assert.equal(missing, null);
  const good = frame(250_000_000n, 1, 1);
  const classified = sample(1, [good]);
  const smooth = summarizeDisplayFrames([classified], 1);
  assert.ok(smooth);
  assert.equal(smooth.jankRatePercent, 0);
  assert.equal(smooth.classificationCoveragePercent, 100);
});

test("range statistics include the start, exclude the end, and count pacing only between frames within the range", () => {
  const before = frame(125_000_000n, 1, 2);
  const start = frame(250_000_000n, 1, 1);
  const inside = frame(500_000_000n, 2, 2);
  const end = frame(750_000_000n, 1, 2);
  const frames = [before, start, inside, end];
  const reading = sample(1, frames);
  const stats = summarizeDisplayFrames([reading], 1, { start: 0.25, end: 0.75 });
  assert.ok(stats);
  assert.equal(stats.frameCount, 2);
  assert.equal(stats.jankRatePercent, 50);
  assert.equal(stats.frameIntervalCount, 1);
  assert.equal(stats.p95FrameIntervalMs, 250);
  assert.throws(() => summarizeDisplayFrames([reading], 1, { start: 0, end: 2 }), /exceeds/);
});

test("pacing percentiles use exact timestamp differences and nearest rank", () => {
  const frames: DisplayFrame[] = [];
  let elapsed = 10_000n;
  const first = frame(elapsed, 1, 1);
  frames.push(first);
  for (let index = 1; index <= 100; index++) {
    const intervalNs = BigInt(index * 100_000);
    elapsed += intervalNs;
    const next = frame(elapsed, 1, 1);
    frames.push(next);
  }
  const reading = sample(1, frames);
  const stats = summarizeDisplayFrames([reading], 1);
  assert.ok(stats);
  assert.equal(stats.frameIntervalCount, 100);
  assert.ok(stats.averageFrameIntervalMs !== null);
  const meanError = Math.abs(stats.averageFrameIntervalMs - 5.05);
  assert.ok(meanError < 1e-12);
  assert.equal(stats.p50FrameIntervalMs, 5);
  assert.equal(stats.p95FrameIntervalMs, 9.5);
  assert.equal(stats.p99FrameIntervalMs, 9.9);
  assert.equal(stats.maxFrameIntervalMs, 10);
});

test("pacing includes dropped updates between presentations and resets across missing capture intervals", () => {
  const before = frame(100_000_000n, 1, 1);
  const dropped = frame(200_000_000n, 4, 2);
  const after = frame(400_000_000n, 1, 2);
  const reading = sample(1, [before, dropped, after]);
  const stats = summarizeDisplayFrames([reading], 1);
  assert.ok(stats);
  assert.equal(stats.jankRatePercent, 50);
  assert.equal(stats.p95FrameIntervalMs, 300);
  const laterFirst = frame(2_100_000_000n, 1, 1);
  const laterSecond = frame(2_200_000_000n, 1, 1);
  const later = sample(3, [laterFirst, laterSecond]);
  const withGap = summarizeDisplayFrames([reading, later], 3);
  assert.ok(withGap);
  assert.equal(withGap.frameIntervalCount, 2, "A missing second is not treated as a measured presentation gap.");
  const missing: DisplayFpsSample = { time: 2, interval: 1, fps: null };
  const explicitGap = summarizeDisplayFrames([reading, missing, later], 3);
  assert.deepEqual(explicitGap, withGap);
});

test("captured idle intervals preserve measured pacing continuity", () => {
  const before = frame(500_000_000n, 1, 1);
  const after = frame(2_250_000_000n, 1, 2);
  const first = sample(1, [before]);
  const idle = sample(2, []);
  const last = sample(3, [after]);
  const stats = summarizeDisplayFrames([first, idle, last], 3);
  assert.ok(stats);
  assert.equal(stats.frameIntervalCount, 1);
  assert.equal(stats.p95FrameIntervalMs, 1750);
});
