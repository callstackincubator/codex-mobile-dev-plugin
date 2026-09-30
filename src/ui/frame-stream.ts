import { StopReconnectError } from "./reconnect.ts";
import type { FrameRead, StreamFrame } from "../shared/stream.ts";

export type Bitmap = { width: number; height: number; close(): void };
type Samples = { total: number; count: number; max: number; recent: number[] };
type Timing = { average: number; p95: number };
type InputTiming = Timing & { count: number; max: number };
export type ObservedRead = FrameRead & { browserArrivedAt: number };

function samples(): Samples { return { total: 0, count: 0, max: 0, recent: [] }; }
function record(samples: Samples, value: number) {
  samples.total += value;
  samples.count++;
  samples.max = Math.max(samples.max, value);
  if (samples.recent.length === 128) samples.recent.shift();
  samples.recent.push(value);
}
function timing(samples: Samples): Timing {
  samples.recent.sort((a, b) => a - b);
  const percentile = Math.ceil(samples.recent.length * .95);
  const index = Math.max(0, percentile - 1);
  const average = samples.count > 0 ? samples.total / samples.count : 0;
  const p95 = samples.recent[index] ?? 0;
  samples.total = 0;
  samples.count = 0;
  samples.max = 0;
  samples.recent.length = 0;
  return { average, p95 };
}

function inputTiming(samples: Samples): InputTiming {
  const count = samples.count;
  const max = samples.max;
  const result = timing(samples);
  return { ...result, count, max };
}

export type FrameStats = {
  fps: number;
  sourceFps: number;
  reads: number;
  bytes: number;
  skippedBeforeRead: number;
  skippedBeforeDecode: number;
  skippedBeforePaint: number;
  read: Timing;
  serverWait: Timing;
  bridge: Timing;
  requestTravel: Timing;
  serverPrepare: Timing;
  responseTravel: Timing;
  sdkDispatch: Timing;
  decode: Timing;
  jpegPrepare: Timing;
  bitmapDecode: Timing;
  paintWait: Timing;
  paint: Timing;
  receivedToPaint: Timing;
  input: InputTiming;
};

type Options<T extends Bitmap> = {
  read(after: number, signal: AbortSignal): Promise<ObservedRead>;
  decode(data: string): Promise<T | undefined>;
  paint(bitmap: T): void;
  requestPaint(callback: () => void): number;
  cancelPaint(id: number): void;
};

export class FrameStream<T extends Bitmap> {
  private readonly controller = new AbortController();
  private encoded?: StreamFrame;
  private decoded?: { bitmap: T; receivedAt: number; readyAt: number };
  private decoding = false;
  private generation = 0;
  private paintId?: number;
  private started = false;
  private stopped = false;
  private resolve?: () => void;
  private reject?: (error: Error) => void;
  private readonly finished: Promise<void>;
  private readonly options: Options<T>;
  private lastStats = performance.now();
  private counters = { frames: 0, sourceFrames: 0, reads: 0, bytes: 0, skippedBeforeRead: 0, skippedBeforeDecode: 0, skippedBeforePaint: 0 };
  private readonly timings = { read: samples(), serverWait: samples(), bridge: samples(), requestTravel: samples(), serverPrepare: samples(), responseTravel: samples(), sdkDispatch: samples(), decode: samples(), jpegPrepare: samples(), bitmapDecode: samples(), paintWait: samples(), paint: samples(), receivedToPaint: samples(), input: samples() };

  constructor(options: Options<T>) {
    this.options = options;
    this.finished = new Promise<void>((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
  }

  async run(signal: AbortSignal): Promise<void> {
    if (this.started) throw new Error("The frame reader has already started.");
    this.started = true;
    const abort = () => { this.close(); };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) this.close();
    void this.readLoop().catch(error => { this.fail(error); });
    try { await this.finished; }
    finally { signal.removeEventListener("abort", abort); }
  }

  private async readLoop() {
    let after = 0;
    while (this.stopped === false) {
      const generation = this.generation;
      const started = performance.now();
      const read = await this.options.read(after, this.controller.signal);
      if (this.stopped) return;
      const elapsed = performance.now() - started;
      const requestEpoch = performance.timeOrigin + started;
      const resumedEpoch = requestEpoch + elapsed;
      this.counters.reads++;
      record(this.timings.read, elapsed);
      record(this.timings.serverWait, read.serverWaitMs);
      const bridge = Math.max(0, elapsed - read.serverWaitMs);
      record(this.timings.bridge, bridge);
      record(this.timings.requestTravel, read.serverStartedAt - requestEpoch);
      record(this.timings.serverPrepare, read.serverPreparedAt - read.serverStartedAt - read.serverWaitMs);
      record(this.timings.responseTravel, read.browserArrivedAt - read.serverPreparedAt);
      record(this.timings.sdkDispatch, resumedEpoch - read.browserArrivedAt);
      if (read.frame == null) continue;
      const frame = read.frame;
      if (Number.isSafeInteger(frame.sequence) === false || frame.sequence <= after) throw new StopReconnectError("The plugin returned an invalid frame sequence.");
      this.counters.sourceFrames += frame.sequence - after;
      this.counters.skippedBeforeRead += frame.sequence - after - 1;
      this.counters.bytes += frame.bytes;
      after = frame.sequence;
      if (generation !== this.generation) { this.counters.skippedBeforeDecode++; continue; }
      if (this.encoded) this.counters.skippedBeforeDecode++;
      this.encoded = frame;
      if (this.decoding === false) {
        this.decoding = true;
        queueMicrotask(() => { void this.decodeLoop().catch(error => { this.fail(error); }); });
      }
    }
  }

  private async decodeLoop() {
    try {
      while (this.stopped === false && this.encoded) {
        const frame = this.encoded;
        this.encoded = undefined;
        const generation = this.generation;
        const started = performance.now();
        const bitmap = await this.options.decode(frame.data);
        record(this.timings.decode, performance.now() - started);
        if (bitmap == null) continue;
        if (this.stopped) { bitmap.close(); return; }
        if (generation !== this.generation) { bitmap.close(); continue; }
        if (this.decoded) {
          this.decoded.bitmap.close();
          this.counters.skippedBeforePaint++;
        }
        const readyAt = performance.now();
        this.decoded = { bitmap, receivedAt: frame.receivedAt, readyAt };
        if (this.paintId == null) this.paintId = this.options.requestPaint(() => { this.paint(); });
      }
    } finally { this.decoding = false; }
  }

  private paint() {
    this.paintId = undefined;
    const decoded = this.decoded;
    this.decoded = undefined;
    if (decoded == null) return;
    try {
      if (this.stopped) return;
      const started = performance.now();
      record(this.timings.paintWait, started - decoded.readyAt);
      this.options.paint(decoded.bitmap);
      record(this.timings.paint, performance.now() - started);
      const age = Math.max(0, Date.now() - decoded.receivedAt);
      record(this.timings.receivedToPaint, age);
      this.counters.frames++;
    } catch (error) { this.fail(error); }
    finally { decoded.bitmap.close(); }
  }

  inputTiming(elapsed: number) { record(this.timings.input, elapsed); }

  decodeTiming(phase: "jpegPrepare" | "bitmapDecode", elapsed: number) { record(this.timings[phase], elapsed); }

  stats(): FrameStats {
    const now = performance.now();
    const elapsed = now - this.lastStats;
    this.lastStats = now;
    const fps = this.counters.frames * 1000 / elapsed;
    const sourceFps = this.counters.sourceFrames * 1000 / elapsed;
    const { frames, sourceFrames, ...counts } = this.counters;
    this.counters = { frames: 0, sourceFrames: 0, reads: 0, bytes: 0, skippedBeforeRead: 0, skippedBeforeDecode: 0, skippedBeforePaint: 0 };
    return {
      fps, sourceFps, ...counts,
      read: timing(this.timings.read), serverWait: timing(this.timings.serverWait), bridge: timing(this.timings.bridge),
      requestTravel: timing(this.timings.requestTravel), serverPrepare: timing(this.timings.serverPrepare),
      responseTravel: timing(this.timings.responseTravel), sdkDispatch: timing(this.timings.sdkDispatch),
      paintWait: timing(this.timings.paintWait),
      jpegPrepare: timing(this.timings.jpegPrepare), bitmapDecode: timing(this.timings.bitmapDecode),
      decode: timing(this.timings.decode), paint: timing(this.timings.paint), receivedToPaint: timing(this.timings.receivedToPaint), input: inputTiming(this.timings.input),
    };
  }

  fail(error: unknown) {
    if (this.stopped) return;
    this.dispose();
    const failure = error instanceof Error ? error : new Error(String(error));
    this.reject?.(failure);
  }

  close() {
    if (this.stopped) return;
    this.dispose();
    this.resolve?.();
  }

  clearFrames() {
    this.generation++;
    this.encoded = undefined;
    if (this.paintId != null) this.options.cancelPaint(this.paintId);
    this.paintId = undefined;
    this.decoded?.bitmap.close();
    this.decoded = undefined;
  }

  private dispose() {
    this.stopped = true;
    this.controller.abort();
    this.clearFrames();
  }
}

export async function decodeJpeg(data: string, report: (phase: "jpegPrepare" | "bitmapDecode", elapsed: number, startedAt: number) => void): Promise<ImageBitmap> {
  const started = performance.now();
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  const blob = new Blob([bytes], { type: "image/jpeg" });
  const preparedAt = performance.now();
  report("jpegPrepare", preparedAt - started, started);
  const bitmapStartedAt = performance.now();
  const bitmap = await createImageBitmap(blob);
  report("bitmapDecode", performance.now() - bitmapStartedAt, bitmapStartedAt);
  return bitmap;
}
