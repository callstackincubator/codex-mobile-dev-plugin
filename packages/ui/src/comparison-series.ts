import type { PerformanceRecording } from "@mobile-dev/shared/recordings.ts";
import { createRecordingCpuSeries, createRecordingFpsSeries } from "./recording-series.ts";
import type { RecordingPoint } from "./recording-series.ts";

export type ComparisonMetric = "cpu" | "rss" | "physical-footprint" | "fps";
export type ComparisonPoint = { time: number; [key: string]: number | null };
export const COMPARISON_COLORS = ["#2583ff", "#f57b28", "#36a269", "#9873e6", "#e34e85", "#159eaa"];

function metricSeries(recording: PerformanceRecording, metric: ComparisonMetric): RecordingPoint[] {
  if (metric === "cpu") return createRecordingCpuSeries(recording);
  if (metric === "fps") return createRecordingFpsSeries(recording);
  if (recording.memoryMetric !== metric) return [];
  const points: RecordingPoint[] = [];
  let previousTime: number | undefined;
  for (const sample of recording.samples) {
    if (sample.time > recording.durationSeconds) continue;
    if (previousTime !== undefined && sample.time - previousTime > sample.interval * 1.5) {
      points.push({ time: previousTime, value: null }, { time: sample.time, value: null });
    }
    const value = sample.memoryBytes === null ? null : sample.memoryBytes / 1048576;
    points.push({ time: sample.time, value });
    previousTime = sample.time;
  }
  return points;
}

// Two rows at interval boundaries keep both sides of a step; runs share timestamps so tooltips compare time, not sample index.
export function createComparisonSeries(recordings: PerformanceRecording[], metric: ComparisonMetric): ComparisonPoint[] {
  const series = recordings.map(recording => {
    const points = metricSeries(recording, metric);
    return points;
  });
  const occurrences = new Map<number, number>();
  for (const points of series) {
    let previousTime: number | undefined;
    for (const point of points) {
      const count = point.time === previousTime ? 2 : 1;
      const existing = occurrences.get(point.time) ?? 0;
      const maximum = Math.max(existing, count);
      occurrences.set(point.time, maximum);
      previousTime = point.time;
    }
  }
  const times = [...occurrences.keys()];
  times.sort((left, right) => left - right);
  const cursors = series.map(() => 0);
  const rows: ComparisonPoint[] = [];
  for (const time of times) {
    const count = occurrences.get(time)!;
    for (let side = 0; side < count; side++) {
      const row: ComparisonPoint = { time };
      for (const [index, points] of series.entries()) {
        let cursor = cursors[index];
        while (cursor < points.length && points[cursor].time < time) cursor++;
        cursors[index] = cursor;
        let value: number | null = null;
        const point = points[cursor];
        if (point?.time === time) {
          if (side > 0) {
            while (cursor + 1 < points.length && points[cursor + 1].time === time) cursor++;
          }
          value = points[cursor].value;
        } else {
          const previous = points[cursor - 1];
          if (previous !== undefined && point !== undefined && previous.value !== null && point.value !== null) {
            const fraction = (time - previous.time) / (point.time - previous.time);
            value = previous.value + (point.value - previous.value) * fraction;
          }
        }
        row[`run${index}`] = value;
      }
      rows.push(row);
    }
  }
  return rows;
}

export type SharpMetric = "cpu" | "memory" | "fps";
/** One stretch of a run where a measure moved sharply, with the readings across it. */
export type SharpChange = { run: number; metric: SharpMetric; start: number; end: number; values: number[] };

// Fixed per-second steps that count as sharp. A share of the largest change would flag a
// quiet run's noise as loudly as another run's spike.
export const SHARP_CHANGE: Record<SharpMetric, number> = { cpu: 10, memory: 50, fps: 15 };

type Reading = { time: number; interval: number; value: number | null };

function readings(recording: PerformanceRecording, metric: SharpMetric): Reading[] {
  if (metric === "fps") return recording.fps.samples.map(sample => ({ time: sample.time, interval: sample.interval, value: sample.fps }));
  return recording.samples.map(sample => ({
    time: sample.time,
    interval: sample.interval,
    value: metric === "cpu" ? sample.cpuPercent : sample.memoryBytes === null ? null : sample.memoryBytes / 1048576,
  }));
}

export function findSharpChanges(recordings: PerformanceRecording[]): SharpChange[][] {
  return recordings.map((recording, run) => {
    const changes: SharpChange[] = [];
    for (const metric of ["cpu", "memory", "fps"] as const) {
      let previous: { time: number; value: number } | undefined;
      let current: SharpChange | undefined;
      for (const reading of readings(recording, metric)) {
        if (reading.value === null || reading.time > recording.durationSeconds) {
          previous = undefined;
          current = undefined;
          continue;
        }
        if (previous !== undefined) {
          const elapsed = reading.time - previous.time;
          // A gap is missing readings, not a change: the series use the same tolerance.
          const continuous = elapsed > 0 && elapsed <= reading.interval * 1.5;
          // Readings come about a second apart; a slower cadence needs a larger step.
          const seconds = Math.max(1, Math.round(elapsed));
          const sharp = continuous && Math.abs(reading.value - previous.value) >= SHARP_CHANGE[metric] * seconds;
          if (sharp && current?.end === previous.time) {
            current.end = reading.time;
            current.values.push(reading.value);
          } else if (sharp) {
            current = { run, metric, start: previous.time, end: reading.time, values: [previous.value, reading.value] };
            changes.push(current);
          } else current = undefined;
        }
        previous = { time: reading.time, value: reading.value };
      }
    }
    changes.sort((left, right) => left.start - right.start);
    return changes;
  });
}
