import { errorMessage } from "@mobile-dev/shared/protocol.ts";
import type { CpuPhase } from "@mobile-dev/shared/cpu.ts";
import type { CpuMonitor } from "./cpu/monitor.ts";
import type { SampleBuffer } from "./cpu/buffer.ts";
import { recordCollectorReady } from "./telemetry.ts";
import type { CollectorReadiness } from "./telemetry.ts";

export type CollectorStart = {
  /** Finds the app, attaches or deploys, and returns the running monitor. */
  attach: (signal: AbortSignal) => Promise<CpuMonitor>;
  /** Records the session ready when the monitor attaches rather than at its first sample. */
  readyOnAttach: boolean;
  /** Aborts startup as soon as a stop begins, or only while the monitor is still attaching. */
  abortOnStop: "immediately" | "before-attach";
  telemetry: CollectorReadiness;
};

/** Android serials of local emulators; everything else ADB lists is a connected device. */
export function androidKind(deviceId: string) {
  return /^emulator-\d+$/.test(deviceId) ? "emulator" : "physical";
}

/** One CPU or Display FPS collector: its startup, its failure while running, and its stop. */
export class CollectorSession<T extends { time: number }> {
  readonly buffer: SampleBuffer<T>;
  private readonly abort = new AbortController();
  private readonly options: CollectorStart;
  private start?: Promise<void>;
  private startedAt = 0;
  private monitor?: CpuMonitor;
  private stopping = false;
  private measured = false;

  constructor(buffer: SampleBuffer<T>, options: CollectorStart) {
    this.buffer = buffer;
    this.options = options;
    buffer.onPhase = phase => this.measure(phase);
  }

  /** Starts the collector once its session is registered. */
  begin() {
    this.startedAt = performance.now();
    this.start = this.run();
  }

  /** Whether samples still belong to this session. */
  get active() { return this.abort.signal.aborted === false && this.stopping === false; }

  private measure(phase: CpuPhase) {
    const outcome = phase === "recording" ? "ready" : phase === "failed" ? "failed" : phase === "stopping" ? "cancelled" : undefined;
    if (outcome === undefined || this.measured) return;
    this.measured = true;
    recordCollectorReady(this.options.telemetry, outcome, performance.now() - this.startedAt);
  }

  private async run() {
    const signal = this.abort.signal;
    try {
      this.monitor = await this.options.attach(signal);
      if (this.active === false) return;
      if (this.options.readyOnAttach) this.buffer.status("recording");
      const monitor = this.monitor;
      void monitor.closed.then(async error => {
        if (this.stopping) return;
        this.buffer.status("failed", error.message);
        try { await monitor.stop(); }
        catch (cleanupError) { this.buffer.status("failed", errorMessage(cleanupError)); }
      });
    } catch (error) {
      if (signal.aborted === false) this.buffer.status("failed", errorMessage(error));
    }
  }

  async stop() {
    this.buffer.status("stopping");
    this.buffer.close();
    this.stopping = true;
    if (this.options.abortOnStop === "immediately" || this.monitor === undefined) this.abort.abort();
    try { await this.start; await this.monitor?.stop(); }
    finally { this.abort.abort(); }
  }
}
