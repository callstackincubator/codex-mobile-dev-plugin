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
// UNKNOWN (256), unspecified (0), and future bits do not identify a classified frame.
const JANK_REASONS = 2 | 4 | 8 | 16 | 32 | 64 | 128 | 512 | 1024;
const CLASSIFIED_JANK_BITS = JANK_NONE | JANK_REASONS;

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
      const jank = frame.jankType;
      const classified = jank !== undefined && jank !== 0 && (jank & ~CLASSIFIED_JANK_BITS) === 0;
      if (classified) {
        stats.classifiedPresentedFrameCount++;
        if ((jank & JANK_REASONS) !== 0) stats.jankyPresentedFrameCount++;
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
