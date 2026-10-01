import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, writeFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CpuSample, CpuTarget } from "../shared/cpu.ts";
import { recordingIdSchema, recordingSchema } from "../shared/recordings.ts";
import type { PerformanceRecording } from "../shared/recordings.ts";
import { errorMessage } from "../shared/protocol.ts";
import { captureServerError } from "./telemetry.ts";
import type { CpuSessions } from "./cpu/sessions.ts";
import type { DisplayFpsSessions } from "./fps/sessions.ts";
import type { DisplayFpsSample } from "../shared/display-fps.ts";

export const RECORDINGS_DIRECTORY = join(homedir(), "Library/Application Support/mobile-dev/recordings");

export class RecordingStore {
  readonly directory: string;
  constructor(directory = RECORDINGS_DIRECTORY) { this.directory = directory; }

  async save(recording: PerformanceRecording) {
    const validated = recordingSchema.parse(recording);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const filename = join(this.directory, `${validated.id}.json`);
    const temporary = `${filename}.tmp`;
    const text = JSON.stringify(validated);
    try {
      await writeFile(temporary, text, { mode: 0o600 });
      await rename(temporary, filename);
    } finally { await rm(temporary, { force: true }); }
  }

  async read(id: string): Promise<PerformanceRecording> {
    const validated = recordingIdSchema.parse(id);
    const filename = join(this.directory, `${validated}.json`);
    const text = await readFile(filename, "utf8");
    const parsed: unknown = JSON.parse(text);
    const recording = recordingSchema.parse(parsed);
    if (recording.id !== validated) throw new Error("The saved recording ID does not match.");
    return recording;
  }

  async list(limit: number) {
    let entries;
    try { entries = await readdir(this.directory, { withFileTypes: true }); }
    catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
      throw error;
    }
    const candidates: Array<{ id: string; modified: number }> = [];
    for (const entry of entries) {
      if (entry.isFile() === false || entry.name.endsWith(".json") === false) continue;
      const id = entry.name.slice(0, -5);
      const parsed = recordingIdSchema.safeParse(id);
      if (parsed.success === false) continue;
      const filename = join(this.directory, entry.name);
      const metadata = await stat(filename);
      candidates.push({ id, modified: metadata.mtimeMs });
    }
    candidates.sort((left, right) => right.modified - left.modified);
    const selected = candidates.slice(0, limit);
    const recordings: PerformanceRecording[] = [];
    for (const candidate of selected) {
      const recording = await this.read(candidate.id);
      recordings.push(recording);
    }
    return recordings;
  }
}

type FpsCollection = { sessionId?: string; cursor: number; pending: DisplayFpsSample[] };

type ActiveRecording = { recording: PerformanceRecording; stop: boolean; interrupted: boolean; job: Promise<void> };

export class PerformanceRecordings {
  private active = new Map<string, ActiveRecording>();
  private disposed = false;
  private readonly cpu: Pick<CpuSessions, "open" | "read" | "closeSession">;
  private readonly fps: Pick<DisplayFpsSessions, "open" | "read" | "closeSession">;
  readonly store: RecordingStore;

  constructor(cpu: Pick<CpuSessions, "open" | "read" | "closeSession">,
    fps: Pick<DisplayFpsSessions, "open" | "read" | "closeSession">, store = new RecordingStore()) {
    this.cpu = cpu;
    this.fps = fps;
    this.store = store;
  }

  start(target: CpuTarget, title: string, durationSeconds: number, deviceName: string): PerformanceRecording {
    if (this.disposed) throw new Error("The plugin server has closed.");
    const recording: PerformanceRecording = {
      schemaVersion: 1, id: randomUUID(), title, target, deviceName, durationSeconds,
      startedAt: new Date().toISOString(), status: "connecting",
      memoryMetric: target.platform === "android" ? "rss" : "physical-footprint", samples: [],
      fps: { status: "connecting", samples: [] },
    };
    recordingSchema.parse(recording);
    const sessionId = this.cpu.open(target);
    const active: ActiveRecording = { recording, stop: false, interrupted: false, job: Promise.resolve() };
    this.active.set(recording.id, active);
    active.job = this.collect(active, sessionId);
    return { ...recording, samples: [], fps: { ...recording.fps, samples: [] } };
  }

  private appendFps(recording: PerformanceRecording, samples: DisplayFpsSample[], origin: number, end: number) {
    for (const sample of samples) {
      const time = sample.time - origin;
      if (time < 0 || time - sample.interval >= end) continue;
      const existing = recording.fps.samples.findIndex(reading => reading.time === time);
      const reading = { ...sample, time };
      if (existing >= 0) recording.fps.samples[existing] = reading;
      else {
        if (recording.fps.samples.length >= 1800) throw new Error("This recording exceeded its FPS sample limit.");
        recording.fps.samples.push(reading);
      }
    }
    recording.fps.samples.sort((left, right) => left.time - right.time);
  }

  private async readFps(recording: PerformanceRecording, state: FpsCollection, origin: number | undefined, end: number, waitMs = 0) {
    if (state.sessionId === undefined) return;
    try {
      const batch = await this.fps.read(state.sessionId, state.cursor, waitMs);
      state.cursor = batch.cursor;
      if (origin === undefined) {
        state.pending.push(...batch.samples);
        state.pending = state.pending.slice(-600);
      }
      else this.appendFps(recording, batch.samples, origin, end);
      if (batch.phase === "failed" || batch.phase === "stopped" || batch.phase === "stopping") {
        throw new Error(batch.error ?? "The Display FPS monitor stopped before the recording finished.");
      }
      if (batch.phase === "recording") recording.fps.status = "recording";
    } catch (error) {
      recording.fps.status = "unavailable";
      recording.fps.error = errorMessage(error);
      captureServerError(error, "recording.fps.collect");
      const sessionId = state.sessionId;
      state.sessionId = undefined;
      try { await this.fps.closeSession(sessionId); }
      catch (cleanupError) { captureServerError(cleanupError, "recording.fps.close"); }
    }
  }

  private async collect(active: ActiveRecording, sessionId: string) {
    const recording = active.recording;
    const connectingAt = performance.now();
    const fps: FpsCollection = { cursor: 0, pending: [] };
    let origin: number | undefined;
    let latestCpu: CpuSample | undefined;
    let cpuOrigin: number | undefined;
    let cursor = 0;
    try {
      if (recording.target.platform === "ios" && recording.target.kind !== "physical") {
        recording.fps.status = "unavailable";
        recording.fps.error = "Display FPS is not supported on iOS simulators.";
      } else {
        try {
          fps.sessionId = this.fps.open({ platform: recording.target.platform, deviceId: recording.target.deviceId });
        } catch (error) {
          recording.fps.status = "unavailable";
          recording.fps.error = errorMessage(error);
          captureServerError(error, "recording.fps.open");
        }
      }
      while (active.stop === false) {
        const now = performance.now();
        if (origin !== undefined && now / 1000 - origin >= recording.durationSeconds) break;
        const timedOut = origin === undefined && now - connectingAt > 60000;
        if (timedOut && latestCpu === undefined) throw new Error("The CPU collector did not become ready within 60 seconds.");
        if (timedOut && recording.fps.status === "connecting") {
          recording.fps.status = "unavailable";
          recording.fps.error = "The Display FPS collector did not become ready within 60 seconds.";
          const error = new Error(recording.fps.error);
          captureServerError(error, "recording.fps.connect");
          if (fps.sessionId !== undefined) await this.fps.closeSession(fps.sessionId);
          fps.sessionId = undefined;
        }
        const remaining = origin === undefined ? 1000 : (recording.durationSeconds - (now / 1000 - origin)) * 1000;
        const waitMs = Math.max(0, Math.min(1000, remaining));
        const batch = await this.cpu.read(sessionId, cursor, waitMs);
        cursor = batch.cursor;
        if (batch.phase === "failed") throw new Error(batch.error ?? "CPU collection failed.");
        if (batch.phase === "stopped" || batch.phase === "stopping") throw new Error("The CPU monitor stopped before the recording finished.");
        if (batch.samples.length > 0) {
          if (batch.timeOrigin === undefined) throw new Error("The CPU collector did not provide its timeline origin.");
          cpuOrigin = batch.timeOrigin;
          latestCpu = batch.samples[batch.samples.length - 1];
        }
        await this.readFps(recording, fps, origin, recording.durationSeconds);
        if (origin === undefined && latestCpu !== undefined && cpuOrigin !== undefined && recording.fps.status !== "connecting") {
          origin = cpuOrigin + latestCpu.time;
          recording.startedAt = new Date().toISOString();
          recording.status = "recording";
          recording.samples.push({ ...latestCpu, time: 0 });
          this.appendFps(recording, fps.pending, origin, recording.durationSeconds);
          fps.pending = [];
          continue;
        }
        if (origin === undefined || cpuOrigin === undefined) continue;
        for (const sample of batch.samples) {
          const time = cpuOrigin + sample.time - origin;
          if (time < 0 || time > recording.durationSeconds) continue;
          if (recording.samples.length >= 1800) throw new Error("This recording exceeded its sample limit.");
          recording.samples.push({ ...sample, time });
        }
      }
      if (active.interrupted) throw new Error("Recording interrupted because the plugin server closed.");
      if (recording.samples.length === 0 || origin === undefined) throw new Error("No performance samples were recorded.");
      const elapsed = performance.now() / 1000 - origin;
      const end = Math.min(recording.durationSeconds, elapsed);
      recording.status = "finishing";
      await this.cpu.closeSession(sessionId);
      const drainMs = recording.target.platform === "android" ? 5000 : 1500;
      const drainUntil = performance.now() + drainMs;
      while (fps.sessionId !== undefined && active.interrupted === false && performance.now() < drainUntil) {
        const remaining = drainUntil - performance.now();
        const waitMs = Math.max(0, Math.min(1000, remaining));
        await this.readFps(recording, fps, origin, end, waitMs);
      }
      if (active.interrupted) throw new Error("Recording interrupted because the plugin server closed.");
      if (recording.fps.status === "recording") recording.fps.status = "finished";
      recording.status = "finished";
    } catch (error) {
      recording.status = "failed";
      recording.error = errorMessage(error);
      captureServerError(error, "recording.collect");
    } finally {
      const closing = [this.cpu.closeSession(sessionId)];
      if (fps.sessionId !== undefined) {
        const closeFps = this.fps.closeSession(fps.sessionId);
        closing.push(closeFps);
      }
      const closed = await Promise.allSettled(closing);
      for (const result of closed) {
        if (result.status === "fulfilled") continue;
        recording.status = "failed";
        recording.error = errorMessage(result.reason);
        captureServerError(result.reason, "recording.close");
      }
      if (recording.fps.status === "connecting" || recording.fps.status === "recording") recording.fps.status = "unavailable";
      recording.completedAt = new Date().toISOString();
      try {
        await this.store.save(recording);
        this.active.delete(recording.id);
      } catch (error) {
        recording.status = "failed";
        recording.error = "The recording could not be saved to disk.";
        captureServerError(error, "recording.save");
      }
    }
  }

  async read(id: string): Promise<PerformanceRecording> {
    const validated = recordingIdSchema.parse(id);
    const active = this.active.get(validated);
    if (active) return { ...active.recording, samples: [...active.recording.samples],
      fps: { ...active.recording.fps, samples: [...active.recording.fps.samples] } };
    return this.store.read(validated);
  }

  async finish(id: string) {
    const active = this.active.get(id);
    if (active) { active.stop = true; await active.job; }
    return this.read(id);
  }

  async list(limit: number) {
    const saved = await this.store.list(limit);
    const pending = Array.from(this.active.values(), active => active.recording);
    const all = [...pending, ...saved];
    all.sort((left, right) => right.startedAt.localeCompare(left.startedAt));
    return all.slice(0, limit);
  }

  async close() {
    this.disposed = true;
    const pending = [...this.active.values()];
    for (const active of pending) { active.interrupted = true; active.stop = true; }
    const jobs = pending.map(active => active.job);
    await Promise.all(jobs);
  }
}
