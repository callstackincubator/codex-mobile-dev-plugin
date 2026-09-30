import type { CpuPoint, CpuSample } from "../../../shared/cpu";
import type { ThreadHistory, ThreadOrder } from "../../performance/types";

export type CpuThreadSeries = { id: string; name: string; running: boolean; data: CpuPoint[] };

export function orderCpuThreads(threads: CpuThreadSeries[], history: ReadonlyMap<string, ThreadHistory>, order: ThreadOrder): CpuThreadSeries[] {
  const sorted = threads.slice();
  sorted.sort((first, second) => {
    const firstHistory = history.get(first.id);
    const secondHistory = history.get(second.id);
    if (firstHistory === undefined || secondHistory === undefined) throw new Error("Missing CPU thread history.");
    if (order === "activity") {
      const firstActive = firstHistory.peakCpuPercent > 0;
      const secondActive = secondHistory.peakCpuPercent > 0;
      if (firstActive !== secondActive) return firstActive ? -1 : 1;
      const firstPoint = first.data.at(-1);
      const secondPoint = second.data.at(-1);
      const firstUsage = firstPoint?.value ?? 0;
      const secondUsage = secondPoint?.value ?? 0;
      const difference = secondUsage - firstUsage;
      if (difference !== 0) return difference;
    }
    return firstHistory.number - secondHistory.number;
  });
  return sorted;
}

export function createCpuSeries(samples: CpuSample[]) {
  const process: CpuPoint[] = [];
  const threads = new Map<string, CpuThreadSeries>();
  let weightedCpu = 0;
  let measuredTime = 0;
  let maximum: number | null = null;
  const last = samples.at(-1);
  const currentIds = new Set<string>();
  if (last) for (const thread of last.threads) currentIds.add(thread.id);
  for (const sample of samples) {
    process.push({ time: sample.time, value: sample.cpuPercent });
    if (sample.cpuPercent !== null) {
      weightedCpu += sample.cpuPercent * sample.interval;
      measuredTime += sample.interval;
      maximum = maximum === null ? sample.cpuPercent : Math.max(maximum, sample.cpuPercent);
    }
    const present = new Set<string>();
    for (const thread of sample.threads) {
      present.add(thread.id);
      let series = threads.get(thread.id);
      if (!series) {
        const running = currentIds.has(thread.id);
        series = { id: thread.id, name: thread.name, running, data: [] };
        threads.set(thread.id, series);
      }
      if (thread.name) series.name = thread.name;
      series.data.push({ time: sample.time, value: thread.cpuPercent });
    }
    for (const series of threads.values()) {
      if (present.has(series.id)) continue;
      // A missing/exited thread is a gap, not a fabricated 0% observation.
      const point = series.data.at(-1);
      if (point?.value !== null) series.data.push({ time: sample.time, value: null });
    }
  }
  const threadList = Array.from(threads.values());
  return {
    process, threads: threadList,
    current: last?.cpuPercent ?? null,
    average: measuredTime > 0 ? weightedCpu / measuredTime : null,
    maximum,
    threadCount: last?.threads.length ?? 0,
  };
}

export function formatCpu(value: number | null): string {
  if (value === null) return "—";
  const rounded = value.toFixed(1);
  return `${rounded}%`;
}
