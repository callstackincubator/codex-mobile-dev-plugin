import { fields, TraceStream } from "./protobuf.ts";
import { MAX_DISPLAY_FRAMES_PER_INTERVAL } from "../../shared/display-fps.ts";
import type { DisplayFrame, DisplayFrameTimeline } from "../../shared/display-fps.ts";

const SECOND = 1_000_000_000n;
const PRESENTED = new Set([1, 2, 3]);
type PendingDisplayFrame = Omit<DisplayFrame, "token" | "startTimeNs" | "endTimeNs"> & { token: bigint; startTimeNs: bigint };
export type FrameReading = { fps: number | null; interval: number; recordedAt: number; frameTimeline?: DisplayFrameTimeline };

// DisplayFrame is the compositor's frame. SurfaceFrames belong to individual
// layers and would count the same display update several times.
export class FrameTimeline {
  private stream: TraceStream;
  private pending = new Map<bigint, PendingDisplayFrame>();
  private tokens = new Map<bigint, bigint>();
  private frames = new Map<bigint, DisplayFrame[]>();
  private start?: bigint;
  private window = 0n;
  private anchor?: { device: bigint; host: number };
  private watermark = 0n;
  private sequences = new Set<bigint>();
  private clocks: Array<{ monotonic: bigint; offset: bigint }> = [];
  private defaults = new Map<bigint, number>();
  private sample: (reading: FrameReading) => void;
  private now: () => number;

  constructor(sample: (reading: FrameReading) => void, now = () => performance.now() / 1000) {
    this.sample = sample;
    this.now = now;
    this.stream = new TraceStream(packet => this.packet(packet));
  }
  push(chunk: Buffer) { this.stream.push(chunk); }

  private packet(packet: Buffer) {
    let timestamp: bigint | undefined;
    let timeline: Buffer | undefined;
    let service: Buffer | undefined;
    let sequence: bigint | undefined;
    let dropped = false;
    let clock: number | undefined;
    let clockSnapshot: Buffer | undefined;
    let defaults: Buffer | undefined;
    for (const field of fields(packet)) {
      if (field.id === 8) timestamp = field.integer;
      else if (field.id === 76) timeline = field.bytes;
      else if (field.id === 69) service = field.bytes;
      else if (field.id === 6) clockSnapshot = field.bytes;
      else if (field.id === 59) defaults = field.bytes;
      else if (field.id === 10) sequence = field.integer;
      else if (field.id === 42 && field.integer === 1n) dropped = true;
      else if (field.id === 58) clock = Number(field.integer);
    }
    if (sequence !== undefined) {
      if (dropped && this.sequences.has(sequence)) throw new Error("Perfetto lost trace packets. Restart Display FPS monitoring.");
      this.sequences.add(sequence);
    }
    if (clockSnapshot) this.synchronize(clockSnapshot);
    if (defaults && sequence !== undefined) {
      for (const field of fields(defaults)) {
        if (field.id !== 58) continue;
        const clockId = Number(field.integer);
        this.defaults.set(sequence, clockId);
      }
    }
    if (timestamp === undefined) return;
    if (service === undefined && timeline === undefined) return;
    const defaultClock = sequence === undefined ? undefined : this.defaults.get(sequence);
    const clockId = clock ?? defaultClock ?? 6;
    if (clockId === 3) {
      if (this.clocks.length === 0) throw new Error("FrameTimeline omitted the Android clock synchronization.");
      let offset = this.clocks[0].offset;
      for (const snapshot of this.clocks) {
        if (snapshot.monotonic > timestamp) break;
        offset = snapshot.offset;
      }
      timestamp += offset;
    } else if (clockId !== 6) throw new Error("FrameTimeline uses an unsupported clock.");
    if (service) {
      for (const field of fields(service)) {
        if (field.id === 1 && field.integer === 1n) this.start = timestamp;
        if (field.id === 4 && field.integer === 1n) this.complete(timestamp);
        if (field.id === 6 && field.integer === 1n) throw new Error("Another tool took the FPS trace for a bug report.");
      }
    }
    if (timeline) this.frame(timeline, timestamp);
  }

  private synchronize(snapshot: Buffer) {
    let monotonic: bigint | undefined;
    let boot: bigint | undefined;
    for (const clock of fields(snapshot)) {
      if (clock.id !== 1 || clock.bytes === undefined) continue;
      let id: bigint | undefined;
      let time: bigint | undefined;
      for (const detail of fields(clock.bytes)) {
        if (detail.id === 1) id = detail.integer;
        else if (detail.id === 2) time = detail.integer;
      }
      if (id === 3n) monotonic = time;
      else if (id === 6n) boot = time;
    }
    if (monotonic === undefined || boot === undefined) return;
    this.clocks.push({ monotonic, offset: boot - monotonic });
    this.clocks = this.clocks.slice(-600);
  }

  private frame(event: Buffer, timestamp: bigint) {
    for (const field of fields(event)) {
      if (field.bytes === undefined || (field.id !== 2 && field.id !== 5)) continue;
      let cookie: bigint | undefined;
      let token: bigint | undefined;
      let present = 0;
      const metadata: Pick<DisplayFrame, "onTimeFinish" | "gpuComposition" | "jankType" | "predictionType" | "jankSeverityType"> = {};
      for (const detail of fields(field.bytes)) {
        if (detail.id === 1) cookie = detail.integer;
        else if (detail.id === 2) token = detail.integer;
        else if (detail.id === 4) present = Number(detail.integer);
        else if (detail.id === 5) metadata.onTimeFinish = detail.integer === 1n;
        else if (detail.id === 6) metadata.gpuComposition = detail.integer === 1n;
        else if (detail.id === 7) metadata.jankType = Number(detail.integer);
        else if (detail.id === 8) metadata.predictionType = Number(detail.integer);
        else if (detail.id === 9) metadata.jankSeverityType = Number(detail.integer);
      }
      if (cookie === undefined) throw new Error("FrameTimeline omitted a frame identity.");
      if (field.id === 2) {
        if (token === undefined) throw new Error("FrameTimeline omitted a display token.");
        this.pending.set(cookie, { token, presentType: present, startTimeNs: timestamp, ...metadata });
        if (this.pending.size > 4096) throw new Error("FrameTimeline did not finish its display frames.");
      } else {
        const frame = this.pending.get(cookie);
        if (frame === undefined) continue;
        this.pending.delete(cookie);
        if (this.start === undefined || timestamp < this.start) continue;
        const index = (timestamp - this.start) / SECOND;
        if (index + 150n < this.window) continue;
        if (this.tokens.has(frame.token)) continue;
        this.tokens.set(frame.token, timestamp);
        const frames = this.frames.get(index) ?? [];
        if (frames.length >= MAX_DISPLAY_FRAMES_PER_INTERVAL) throw new Error("FrameTimeline exceeded its display frame limit.");
        const endTimeNs = timestamp.toString();
        const startTimeNs = frame.startTimeNs.toString();
        const token = frame.token.toString();
        frames.push({ ...frame, token, startTimeNs, endTimeNs });
        this.frames.set(index, frames);
        // SurfaceFlinger can resolve a present fence on a later display update.
        // Correct the original interval when a delayed frame reaches Perfetto.
        if (index < this.window) this.publish(index);
      }
    }
  }

  private publish(index: bigint) {
    if (this.start === undefined || this.anchor === undefined) return;
    const end = this.start + (index + 1n) * SECOND;
    const elapsed = Number(end - this.anchor.device) / 1e9;
    const recordedAt = this.anchor.host + elapsed;
    const frames = this.frames.get(index) ?? [];
    const ordered = frames.slice();
    ordered.sort((left, right) => {
      const leftTime = BigInt(left.endTimeNs);
      const rightTime = BigInt(right.endTimeNs);
      if (leftTime === rightTime) return 0;
      return leftTime < rightTime ? -1 : 1;
    });
    let count = 0;
    let invalid = false;
    for (const frame of ordered) {
      if (PRESENTED.has(frame.presentType)) count++;
      else if (frame.presentType !== 4) invalid = true;
    }
    const fps = invalid ? null : count;
    const intervalEndNs = end.toString();
    this.sample({ fps, interval: 1, recordedAt, frameTimeline: { clock: "boottime", intervalEndNs, frames: ordered } });
  }

  private complete(timestamp: bigint) {
    if (this.start === undefined) return;
    if (this.anchor === undefined) this.anchor = { device: timestamp, host: this.now() };
    if (timestamp <= this.watermark) return;
    this.watermark = timestamp;
    // Flushes and readback happen asynchronously. Leave two seconds for frame
    // completion packets before publishing a complete one-second interval.
    const until = timestamp - 2n * SECOND;
    while (this.start + (this.window + 1n) * SECOND <= until) {
      this.publish(this.window);
      this.window++;
    }
    for (const index of this.frames.keys()) if (index + 150n < this.window) this.frames.delete(index);
    for (const [token, time] of this.tokens) if (time < until - 150n * SECOND) this.tokens.delete(token);
  }
}
