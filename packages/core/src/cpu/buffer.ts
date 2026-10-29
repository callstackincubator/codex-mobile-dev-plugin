import { CPU_HISTORY_SECONDS, CPU_MAX_SAMPLES } from "@mobile-dev/shared/cpu.ts";
import type { CpuBatch, CpuPhase, CpuSample, MemoryMetric } from "@mobile-dev/shared/cpu.ts";
import { RevisionBuffer } from "../revision-buffer.ts";

/** A collector's recent samples, one per time, with its phase. */
export class SampleBuffer<T extends { time: number }> {
  private readonly samples = new RevisionBuffer<T>({ limit: CPU_MAX_SAMPLES, window: { seconds: CPU_HISTORY_SECONDS, time: sample => sample.time } });
  private current: CpuPhase = "connecting";
  private failure?: string;
  /** Sees every phase the buffer records. */
  onPhase?: (phase: CpuPhase) => void;

  get phase() { return this.current; }
  get error() { return this.failure; }

  push(sample: T) {
    if (this.samples.closed) return;
    this.current = "recording";
    this.failure = undefined;
    this.samples.append(sample);
    this.onPhase?.("recording");
  }

  status(phase: CpuPhase, error?: string) {
    if (this.samples.closed) return;
    this.current = phase;
    this.failure = error;
    this.samples.bump();
    this.onPhase?.(phase);
  }

  close() { this.samples.close(); }

  /** Waits up to `waitMs` for a change after `after`, then returns what changed. */
  async collect(after: number, waitMs = 1000, signal?: AbortSignal) {
    await this.samples.wait(after, waitMs, signal);
    return { cursor: this.samples.revision, samples: this.samples.since(after).map(entry => entry.value) };
  }
}

export class CpuBuffer extends SampleBuffer<CpuSample> {
  private readonly memoryMetric: MemoryMetric;
  timeOrigin?: number;

  constructor(memoryMetric: MemoryMetric) { super(); this.memoryMetric = memoryMetric; }

  async read(after: number, waitMs = 1000, signal?: AbortSignal): Promise<CpuBatch> {
    const { cursor, samples } = await this.collect(after, waitMs, signal);
    return { cursor, timeOrigin: this.timeOrigin, phase: this.phase, samples, memoryMetric: this.memoryMetric, error: this.error };
  }
}
