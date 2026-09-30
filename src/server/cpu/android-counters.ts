import { z } from "zod";
import type { CpuReading } from "./counters.ts";

const ticks = z.string().regex(/^\d{1,20}$/);
export const androidReadySchema = z.object({
  type: z.literal("ready"), pid: z.number().int().positive(), collectorPid: z.number().int().positive(),
  clockTicks: z.number().int().positive().max(1000000), processStart: ticks,
});
export const androidSampleSchema = z.object({
  type: z.literal("sample"), timestampUs: ticks, processStart: ticks, processTicks: ticks, collectorCpuUs: ticks,
  memoryBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  threads: z.array(z.object({ tid: z.number().int().positive(), start: ticks, ticks, name: z.string().max(256) })).max(4096),
});
export type AndroidSample = z.infer<typeof androidSampleSchema>;

export class AndroidCpuSampler {
  private previous?: AndroidSample;
  private readonly clockTicks: number;
  private readonly processStart: string;
  constructor(clockTicks: number, processStart: string) { this.clockTicks = clockTicks; this.processStart = processStart; }

  sample(profile: AndroidSample): CpuReading {
    if (profile.processStart !== this.processStart) throw new Error("The Android app process restarted. Reconnect CPU monitoring.");
    const timestampUs = BigInt(profile.timestampUs);
    const previous = this.previous;
    const earlierTimestamp = previous ? BigInt(previous.timestampUs) : timestampUs;
    const delta = timestampUs - earlierTimestamp;
    const valid = delta > 0n && delta <= 10000000n;
    const intervalUs = valid ? Number(delta) : 0;
    const percentage = (current: string, earlier: string): number | null => {
      const difference = BigInt(current) - BigInt(earlier);
      if (valid === false || difference < 0n) return null;
      return Number(difference) * 100000000 / this.clockTicks / intervalUs;
    };
    const earlierThreads = new Map<string, string>();
    if (previous && valid) {
      for (const thread of previous.threads) earlierThreads.set(`${thread.tid}-${thread.start}`, thread.ticks);
    }
    const ids = new Set<string>();
    const threads = profile.threads.map(thread => {
      const id = `${thread.tid}-${thread.start}`;
      if (ids.has(id)) throw new Error("Duplicate Android CPU thread counter.");
      ids.add(id);
      const earlier = earlierThreads.get(id);
      const cpuPercent = earlier === undefined ? null : percentage(thread.ticks, earlier);
      return { id, name: thread.name, cpuPercent };
    });
    const cpuPercent = previous ? percentage(profile.processTicks, previous.processTicks) : null;
    this.previous = profile;
    return { timestampUs, intervalUs, cpuPercent, memoryBytes: profile.memoryBytes, threads };
  }
}
