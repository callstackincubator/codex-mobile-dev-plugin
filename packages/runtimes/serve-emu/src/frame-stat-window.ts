// Rolling window of per-frame arrival timing and encoded sizes, backing the
// frameStats block in /health. Interval percentiles over the recent window
// let agents (and us) tell a slow encoder (large p50) from a bursty one
// (p50 fine, p95/max spiking).

export type FrameStatsSummary = {
  windowFrames: number;
  intervalMs: { p50: number; p95: number; max: number } | null;
  avgKeyFrameBytes: number | null;
  avgDeltaFrameBytes: number | null;
  keyFramesInWindow: number;
};

export class FrameStatWindow {
  #capacity: number;
  #intervalsMs: Float64Array;
  #sizes: Uint32Array;
  #isKey: Uint8Array;
  #idx = 0;
  #count = 0;
  #lastFrameMs = 0;

  constructor(capacity: number) {
    this.#capacity = capacity;
    this.#intervalsMs = new Float64Array(capacity);
    this.#sizes = new Uint32Array(capacity);
    this.#isKey = new Uint8Array(capacity);
  }

  record(bytes: number, isKey: boolean, nowMs = performance.now()): void {
    this.#intervalsMs[this.#idx] = this.#lastFrameMs > 0 ? nowMs - this.#lastFrameMs : 0;
    this.#sizes[this.#idx] = bytes;
    this.#isKey[this.#idx] = isKey ? 1 : 0;
    this.#idx = (this.#idx + 1) % this.#capacity;
    if (this.#count < this.#capacity) this.#count++;
    this.#lastFrameMs = nowMs;
  }

  reset(): void {
    this.#idx = 0;
    this.#count = 0;
    this.#lastFrameMs = 0;
  }

  summary(): FrameStatsSummary | null {
    if (this.#count === 0) return null;
    const intervals: number[] = [];
    let keyBytes = 0;
    let keyFrames = 0;
    let deltaBytes = 0;
    let deltaFrames = 0;
    for (let i = 0; i < this.#count; i++) {
      if (this.#intervalsMs[i] > 0) intervals.push(this.#intervalsMs[i]);
      if (this.#isKey[i]) {
        keyBytes += this.#sizes[i];
        keyFrames++;
      } else {
        deltaBytes += this.#sizes[i];
        deltaFrames++;
      }
    }
    intervals.sort((a, b) => a - b);
    const at = (q: number) => intervals[Math.min(intervals.length - 1, Math.floor(intervals.length * q))];
    const round1 = (n: number) => Math.round(n * 10) / 10;
    return {
      windowFrames: this.#count,
      intervalMs:
        intervals.length > 0
          ? { p50: round1(at(0.5)), p95: round1(at(0.95)), max: round1(intervals[intervals.length - 1]) }
          : null,
      avgKeyFrameBytes: keyFrames > 0 ? Math.round(keyBytes / keyFrames) : null,
      avgDeltaFrameBytes: deltaFrames > 0 ? Math.round(deltaBytes / deltaFrames) : null,
      keyFramesInWindow: keyFrames,
    };
  }
}
