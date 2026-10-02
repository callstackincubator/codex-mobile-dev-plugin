import type { PerformanceRecording } from "../shared/recordings.ts";
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

// Two rows at interval boundaries retain both sides of a step. Every run is
// evaluated at the same time, so tooltips compare time rather than sample index.
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
