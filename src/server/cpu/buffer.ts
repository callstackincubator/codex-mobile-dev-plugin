import { CPU_HISTORY_SECONDS, CPU_MAX_SAMPLES } from "../../shared/cpu.ts";
import type { CpuBatch, CpuPhase, CpuSample, MemoryMetric } from "../../shared/cpu.ts";

export class CpuBuffer {
  private samples: Array<{ revision: number; sample: CpuSample }> = [];
  private revision = 0;
  private phase: CpuPhase = "connecting";
  private error?: string;
  private closed = false;
  private waiters = new Set<() => void>();
  private readonly memoryMetric: MemoryMetric;
  timeOrigin?: number;

  constructor(memoryMetric: MemoryMetric) { this.memoryMetric = memoryMetric; }

  push(sample: CpuSample) {
    if (this.closed) return;
    const earliest = sample.time - CPU_HISTORY_SECONDS;
    this.samples = this.samples.filter(entry => entry.sample.time >= earliest);
    this.samples.push({ revision: ++this.revision, sample });
    this.samples = this.samples.slice(-CPU_MAX_SAMPLES);
    this.phase = "recording";
    this.error = undefined;
    this.notify();
  }

  status(phase: CpuPhase, error?: string) {
    if (this.closed) return;
    this.phase = phase;
    this.error = error;
    this.revision++;
    this.notify();
  }

  private notify() { for (const done of this.waiters) done(); }
  close() { this.closed = true; this.notify(); }

  async read(after: number, waitMs = 1000): Promise<CpuBatch> {
    if (this.closed === false && after >= this.revision && waitMs > 0) {
      await new Promise<void>(resolve => {
        const done = () => { clearTimeout(timer); this.waiters.delete(done); resolve(); };
        const timer = setTimeout(done, waitMs);
        this.waiters.add(done);
      });
    }
    const samples = this.samples.filter(entry => entry.revision > after);
    return { cursor: this.revision, timeOrigin: this.timeOrigin, phase: this.phase, samples: samples.map(entry => entry.sample), memoryMetric: this.memoryMetric, error: this.error };
  }
}
