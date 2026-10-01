import type { CpuPoint } from "../../../shared/cpu.ts";
import type { DisplayFpsSample } from "../../../shared/display-fps.ts";

export function createFpsSeries(samples: DisplayFpsSample[]) {
  const data: CpuPoint[] = [];
  let total = 0;
  let duration = 0;
  let minimum: number | null = null;
  let maximum: number | null = null;
  let previous: DisplayFpsSample | undefined;
  for (const sample of samples) {
    if (sample.interval <= 0) continue;
    const start = sample.time - sample.interval;
    if (previous && previous.fps !== null && start > previous.time + 0.001) {
      data.push({ time: previous.time, value: null });
    }
    data.push({ time: start, value: sample.fps });
    data.push({ time: sample.time, value: sample.fps });
    if (sample.fps !== null && sample.interval > 0) {
      total += sample.fps * sample.interval;
      duration += sample.interval;
      minimum = minimum === null ? sample.fps : Math.min(minimum, sample.fps);
      maximum = maximum === null ? sample.fps : Math.max(maximum, sample.fps);
    }
    previous = sample;
  }
  const average = duration > 0 ? total / duration : null;
  return { data, current: samples.at(-1)?.fps ?? null, average, minimum, maximum };
}
