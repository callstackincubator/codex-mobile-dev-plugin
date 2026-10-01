import type { PerformanceRecording, RecordingRange } from "../shared/recordings.ts";

export type RecordingPoint = { time: number; value: number | null };

export function createRecordingCpuSeries(recording: PerformanceRecording): RecordingPoint[] {
  const points: RecordingPoint[] = [];
  let previousEnd: number | undefined;
  for (const sample of recording.samples) {
    const start = Math.max(0, sample.time - sample.interval, previousEnd ?? 0);
    const end = Math.min(recording.durationSeconds, sample.time);
    if (end <= start) continue;
    if (previousEnd !== undefined && start > previousEnd) {
      points.push({ time: previousEnd, value: null }, { time: start, value: null });
    }
    points.push({ time: start, value: sample.cpuPercent }, { time: end, value: sample.cpuPercent });
    previousEnd = end;
  }
  return points;
}

type ChangeInterval = RecordingRange & { variation: number; precedingVariation: number };

function variationUntil(intervals: ChangeInterval[], time: number): number {
  let low = 0;
  let high = intervals.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (intervals[middle].end <= time) low = middle + 1;
    else high = middle;
  }
  if (low === intervals.length) {
    const last = intervals[intervals.length - 1];
    return last.precedingVariation + last.variation;
  }
  const interval = intervals[low];
  if (time <= interval.start) return interval.precedingVariation;
  const fraction = (time - interval.start) / (interval.end - interval.start);
  return interval.precedingVariation + interval.variation * fraction;
}

export function findRecordingChangeRanges(recording: PerformanceRecording, metric: "cpuPercent" | "memoryBytes"): RecordingRange[] {
  const intervals: ChangeInterval[] = [];
  let previous: { time: number; value: number } | undefined;
  let precedingVariation = 0;
  let minimumRate = Infinity;
  let maximumRate = 0;
  for (const sample of recording.samples) {
    const value = sample[metric];
    if (value === null) {
      previous = undefined;
      continue;
    }
    const elapsed = previous ? sample.time - previous.time : 0;
    // Host timestamps can drift from native intervals; tolerate half an interval of delivery jitter.
    const continuous = elapsed <= sample.interval * 1.5;
    if (previous !== undefined && elapsed > 0 && continuous) {
      const start = Math.max(0, previous.time);
      const end = Math.min(recording.durationSeconds, sample.time);
      if (end > start) {
        const difference = Math.abs(value - previous.value);
        const rate = difference / elapsed;
        const variation = rate * (end - start);
        intervals.push({ start, end, variation, precedingVariation });
        precedingVariation += variation;
        minimumRate = Math.min(minimumRate, rate);
        maximumRate = Math.max(maximumRate, rate);
      }
    }
    previous = { time: sample.time, value };
  }
  if (intervals.length === 0 || maximumRate === 0) return [];
  if (maximumRate - minimumRate <= maximumRate * 0.000001) return [];
  const requestedWindow = Math.max(1, recording.durationSeconds * 0.1);
  const window = Math.min(10, requestedWindow);
  const densities: number[] = [];
  let maximumDensity = 0;
  for (const interval of intervals) {
    const center = (interval.start + interval.end) / 2;
    const before = variationUntil(intervals, center - window / 2);
    const after = variationUntil(intervals, center + window / 2);
    const density = (after - before) / window;
    densities.push(density);
    if (interval.variation > 0) maximumDensity = Math.max(maximumDensity, density);
  }
  const threshold = maximumDensity * 0.8;
  const ranges: RecordingRange[] = [];
  for (const [index, interval] of intervals.entries()) {
    if (interval.variation === 0 || densities[index] < threshold) continue;
    const last = ranges[ranges.length - 1];
    if (last !== undefined && interval.start === last.end) last.end = interval.end;
    else ranges.push({ start: interval.start, end: interval.end });
  }
  return ranges;
}
