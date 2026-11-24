import { z } from "zod";
import { displayFrameTime } from "./display-fps.ts";
import type { DisplayFpsSample } from "./display-fps.ts";

const number = z.number();
const finite = number.finite();
const nonnegative = finite.nonnegative();
const count = nonnegative.int();
const reading = nonnegative.nullable();
const percentage = nonnegative.max(100);
const nullablePercentage = percentage.nullable();
export const displayFrameStatsSchema = z.object({
  frameCount: count,
  presentedFrameCount: count,
  droppedFrameCount: count,
  unknownPresentationFrameCount: count,
  classifiedPresentedFrameCount: count,
  unclassifiedPresentedFrameCount: count,
  jankyPresentedFrameCount: count,
  jankRatePercent: nullablePercentage,
  classificationCoveragePercent: nullablePercentage,
  droppedFrameRatePercent: nullablePercentage,
  frameIntervalCount: count,
  averageFrameIntervalMs: reading,
  p50FrameIntervalMs: reading,
  p95FrameIntervalMs: reading,
  p99FrameIntervalMs: reading,
  maxFrameIntervalMs: reading,
});
export const nullableDisplayFrameStatsSchema = displayFrameStatsSchema.nullable();
export type DisplayFrameStats = z.infer<typeof displayFrameStatsSchema>;

const JANK_NONE = 1;
const JANK_UNKNOWN = 256;
const jankReasons: [number, string][] = [
  [2, "SurfaceFlinger scheduling"], [4, "Prediction error"], [8, "Display HAL"],
  [16, "SurfaceFlinger CPU deadline missed"], [32, "SurfaceFlinger GPU deadline missed"],
  [64, "App deadline missed"], [128, "Buffer stuffing"],
  [512, "SurfaceFlinger stuffing"], [1024, "Dropped frame"],
];
const JANK_REASONS = jankReasons.reduce((mask, [bit]) => mask | bit, 0);
const CLASSIFIED_JANK_BITS = JANK_NONE | JANK_REASONS;

export function classifyDisplayJank(bits: number | undefined) {
  if (bits === undefined || bits === 0 || (bits & ~CLASSIFIED_JANK_BITS) !== 0) return "unknown";
  return (bits & JANK_REASONS) === 0 ? "none" : "janky";
}

export function describeDisplayJank(bits = 0) {
  const labels = [];
  for (const [bit, label] of jankReasons) {
    if ((bits & bit) !== 0) labels.push(label);
  }
  if ((bits & JANK_UNKNOWN) !== 0) labels.push("Unknown reason");
  if ((bits & ~(CLASSIFIED_JANK_BITS | JANK_UNKNOWN)) !== 0) labels.push("Unrecognized jank flags");
  if (labels.length > 0) return labels.join(", ");
  return bits === JANK_NONE ? "No classified jank" : "Jank classification unavailable";
}

function percentile(sorted: number[], fraction: number) {
  const rank = Math.ceil(sorted.length * fraction);
  return sorted[rank - 1];
}

export function summarizeDisplayFrames(samples: DisplayFpsSample[], duration: number, range?: { start: number; end: number }): DisplayFrameStats | null {
  const start = range?.start ?? 0;
  const end = range?.end ?? duration;
  if (end > duration) throw new Error("The selected range exceeds this recording's duration.");
  const stats: DisplayFrameStats = {
    frameCount: 0, presentedFrameCount: 0, droppedFrameCount: 0, unknownPresentationFrameCount: 0,
    classifiedPresentedFrameCount: 0, unclassifiedPresentedFrameCount: 0, jankyPresentedFrameCount: 0,
    jankRatePercent: null, classificationCoveragePercent: null, droppedFrameRatePercent: null,
    frameIntervalCount: 0, averageFrameIntervalMs: null, p50FrameIntervalMs: null,
    p95FrameIntervalMs: null, p99FrameIntervalMs: null, maxFrameIntervalMs: null,
  };
  let available = false;
  let previousPresentation: bigint | undefined;
  let previousIntervalEnd: bigint | undefined;
  const intervals: number[] = [];
  let intervalTotal = 0;
  for (const sample of samples) {
    const timeline = sample.frameTimeline;
    if (timeline === undefined) {
      previousPresentation = undefined;
      previousIntervalEnd = undefined;
      continue;
    }
    available = true;
    const intervalEnd = BigInt(timeline.intervalEndNs);
    const roundedInterval = Math.round(sample.interval * 1e9);
    const intervalNs = BigInt(roundedInterval);
    const intervalStart = intervalEnd - intervalNs;
    if (previousIntervalEnd !== undefined && intervalStart !== previousIntervalEnd) previousPresentation = undefined;
    previousIntervalEnd = intervalEnd;
    for (const frame of timeline.frames) {
      const time = displayFrameTime(frame, timeline.intervalEndNs, sample.time);
      if (time < start || time >= end) {
        previousPresentation = undefined;
        continue;
      }
      stats.frameCount++;
      if (frame.presentType === 4) {
        stats.droppedFrameCount++;
        continue;
      }
      const presented = frame.presentType === 1 || frame.presentType === 2 || frame.presentType === 3;
      if (presented === false) {
        stats.unknownPresentationFrameCount++;
        previousPresentation = undefined;
        continue;
      }
      stats.presentedFrameCount++;
      const jank = classifyDisplayJank(frame.jankType);
      if (jank !== "unknown") {
        stats.classifiedPresentedFrameCount++;
        if (jank === "janky") stats.jankyPresentedFrameCount++;
      } else stats.unclassifiedPresentedFrameCount++;
      const presentation = BigInt(frame.endTimeNs);
      if (previousPresentation !== undefined && presentation > previousPresentation) {
        const elapsedNs = presentation - previousPresentation;
        const elapsedMs = Number(elapsedNs) / 1e6;
        intervals.push(elapsedMs);
        intervalTotal += elapsedMs;
      }
      previousPresentation = presentation;
    }
  }
  if (available === false) return null;
  if (stats.classifiedPresentedFrameCount > 0) stats.jankRatePercent = 100 * stats.jankyPresentedFrameCount / stats.classifiedPresentedFrameCount;
  if (stats.presentedFrameCount > 0) stats.classificationCoveragePercent = 100 * stats.classifiedPresentedFrameCount / stats.presentedFrameCount;
  const presentationCount = stats.presentedFrameCount + stats.droppedFrameCount;
  if (presentationCount > 0) stats.droppedFrameRatePercent = 100 * stats.droppedFrameCount / presentationCount;
  stats.frameIntervalCount = intervals.length;
  if (intervals.length > 0) {
    intervals.sort((left, right) => left - right);
    stats.averageFrameIntervalMs = intervalTotal / intervals.length;
    stats.p50FrameIntervalMs = percentile(intervals, 0.5);
    stats.p95FrameIntervalMs = percentile(intervals, 0.95);
    stats.p99FrameIntervalMs = percentile(intervals, 0.99);
    stats.maxFrameIntervalMs = intervals[intervals.length - 1];
  }
  return stats;
}
