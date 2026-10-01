import { z } from "zod";
import { cpuTargetSchema } from "./cpu.ts";
import { PLUGIN_VERSION } from "./version.ts";

export const RECORDING_URI = `ui://mobile-dev/${PLUGIN_VERSION}/recording.html`;
export const recordingIdSchema = z.uuid();
export const recordingRangeSchema = z.object({
  start: z.number().finite().nonnegative(),
  end: z.number().finite().positive(),
}).strict().refine(range => range.end > range.start, "The range end must follow its start.");
const reading = z.number().finite().nonnegative().nullable();
export const recordingSampleSchema = z.object({
  time: z.number().finite().nonnegative(),
  interval: z.number().finite().nonnegative(),
  cpuPercent: reading,
  memoryBytes: reading,
  threads: z.array(z.object({ id: z.string(), name: z.string(), cpuPercent: reading })).max(4096),
});
export const recordingFpsSampleSchema = z.object({
  time: z.number().finite().nonnegative(),
  interval: z.number().finite().nonnegative(),
  fps: reading,
});
const recordingFpsSchema = z.object({
  status: z.enum(["connecting", "recording", "finished", "unavailable"]),
  samples: z.array(recordingFpsSampleSchema).max(1800),
  error: z.string().optional(),
});
export const recordingSchema = z.object({
  schemaVersion: z.literal(1),
  id: recordingIdSchema,
  title: z.string().min(1).max(160),
  deviceName: z.string().min(1).max(256),
  target: cpuTargetSchema,
  durationSeconds: z.number().int().min(1).max(300),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().optional(),
  status: z.enum(["connecting", "recording", "finishing", "finished", "failed"]),
  memoryMetric: z.enum(["rss", "physical-footprint"]),
  samples: z.array(recordingSampleSchema).max(1800),
  fps: recordingFpsSchema.default({ status: "unavailable", samples: [], error: "FPS was not captured in this recording." }),
  error: z.string().optional(),
});
export type PerformanceRecording = z.infer<typeof recordingSchema>;
export type RecordingRange = z.infer<typeof recordingRangeSchema>;
export type RecordingSummary = {
  peakCpuPercent: number | null;
  averageCpuPercent: number | null;
  firstMemoryBytes: number | null;
  lastMemoryBytes: number | null;
  memoryChangeBytes: number | null;
  sampleCount: number;
  averageFps: number | null;
  minimumFps: number | null;
  peakFps: number | null;
  fpsSampleCount: number;
  threads: Array<{ id: string; name: string; averageCpuPercent: number; peakCpuPercent: number }>;
};

export function summarizeRecording(recording: PerformanceRecording, range?: RecordingRange): RecordingSummary {
  const start = range?.start ?? 0;
  const end = range?.end ?? recording.durationSeconds;
  if (end > recording.durationSeconds) throw new Error("The selected range exceeds this recording's duration.");
  let peakCpuPercent: number | null = null;
  let cpuTotal = 0;
  let cpuWeight = 0;
  let firstMemoryBytes: number | null = null;
  let lastMemoryBytes: number | null = null;
  let sampleCount = 0;
  const threads = new Map<string, { id: string; name: string; total: number; weight: number; peakCpuPercent: number }>();
  for (const sample of recording.samples) {
    const intervalStart = Math.max(start, sample.time - sample.interval);
    const intervalEnd = Math.min(end, sample.time);
    const weight = Math.max(0, intervalEnd - intervalStart);
    const withinRange = sample.time >= start && sample.time <= end;
    if (withinRange) {
      sampleCount++;
      if (sample.memoryBytes !== null) {
        if (firstMemoryBytes === null) firstMemoryBytes = sample.memoryBytes;
        lastMemoryBytes = sample.memoryBytes;
      }
    }
    if (weight === 0) continue;
    if (sample.cpuPercent !== null) {
      peakCpuPercent = Math.max(peakCpuPercent ?? 0, sample.cpuPercent);
      cpuTotal += sample.cpuPercent * weight;
      cpuWeight += weight;
    }
    for (const thread of sample.threads) {
      if (thread.cpuPercent === null) continue;
      let aggregate = threads.get(thread.id);
      if (aggregate === undefined) {
        aggregate = { id: thread.id, name: thread.name, total: 0, weight: 0, peakCpuPercent: 0 };
        threads.set(thread.id, aggregate);
      }
      aggregate.name = thread.name;
      aggregate.total += thread.cpuPercent * weight;
      aggregate.weight += weight;
      aggregate.peakCpuPercent = Math.max(aggregate.peakCpuPercent, thread.cpuPercent);
    }
  }
  const ranked = Array.from(threads.values(), thread => ({
    id: thread.id, name: thread.name, averageCpuPercent: thread.total / thread.weight, peakCpuPercent: thread.peakCpuPercent,
  }));
  ranked.sort((left, right) => right.averageCpuPercent - left.averageCpuPercent);
  let fpsTotal = 0;
  let fpsWeight = 0;
  let minimumFps: number | null = null;
  let peakFps: number | null = null;
  let fpsSampleCount = 0;
  for (const sample of recording.fps.samples) {
    const intervalStart = Math.max(start, sample.time - sample.interval);
    const intervalEnd = Math.min(end, sample.time);
    const weight = Math.max(0, intervalEnd - intervalStart);
    if (weight === 0) continue;
    fpsSampleCount++;
    if (sample.fps === null) continue;
    fpsTotal += sample.fps * weight;
    fpsWeight += weight;
    minimumFps = Math.min(minimumFps ?? sample.fps, sample.fps);
    peakFps = Math.max(peakFps ?? sample.fps, sample.fps);
  }
  const memoryChangeBytes = firstMemoryBytes !== null && lastMemoryBytes !== null ? lastMemoryBytes - firstMemoryBytes : null;
  return { peakCpuPercent, averageCpuPercent: cpuWeight > 0 ? cpuTotal / cpuWeight : null,
    firstMemoryBytes, lastMemoryBytes, memoryChangeBytes, sampleCount, threads: ranked,
    averageFps: fpsWeight > 0 ? fpsTotal / fpsWeight : null, minimumFps, peakFps, fpsSampleCount };
}
