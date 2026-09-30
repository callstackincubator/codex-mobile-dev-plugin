import type { CpuPoint, CpuSample } from "../../../shared/cpu.ts";

const BYTES_PER_MIB = 1024 * 1024;

export function createMemorySeries(samples: CpuSample[]) {
  const data: CpuPoint[] = [];
  let sum = 0;
  let count = 0;
  let minimum: number | null = null;
  let maximum: number | null = null;
  for (const sample of samples) {
    const value = sample.memoryBytes === null ? null : sample.memoryBytes / BYTES_PER_MIB;
    data.push({ time: sample.time, value });
    if (value === null) continue;
    sum += value;
    count++;
    minimum = minimum === null ? value : Math.min(minimum, value);
    maximum = maximum === null ? value : Math.max(maximum, value);
  }
  const last = data.at(-1);
  return { data, current: last?.value ?? null, average: count > 0 ? sum / count : null, minimum, maximum };
}

export function formatMemory(value: number | null): string {
  if (value === null) return "—";
  const rounded = value.toFixed(1);
  return `${rounded} MiB`;
}
