import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, writeFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CpuTarget } from "../shared/cpu.ts";
import { recordingIdSchema, recordingSchema } from "../shared/recordings.ts";
import type { PerformanceRecording } from "../shared/recordings.ts";
import { errorMessage } from "../shared/protocol.ts";
import { captureServerError } from "./telemetry.ts";
import type { CpuSessions } from "./cpu/sessions.ts";

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
    for (const candidate of selected) recordings.push(await this.read(candidate.id));
    return recordings;
  }
}

type ActiveRecording = { recording: PerformanceRecording; stop: boolean; interrupted: boolean; job: Promise<void> };

export class PerformanceRecordings {
  private active = new Map<string, ActiveRecording>();
  private disposed = false;
  private readonly cpu: Pick<CpuSessions, "open" | "read" | "closeSession">;
  readonly store: RecordingStore;

  constructor(cpu: Pick<CpuSessions, "open" | "read" | "closeSession">, store = new RecordingStore()) {
    this.cpu = cpu;
    this.store = store;
  }

  start(target: CpuTarget, title: string, durationSeconds: number, deviceName: string): PerformanceRecording {
    if (this.disposed) throw new Error("The plugin server has closed.");
    const recording: PerformanceRecording = {
      schemaVersion: 1, id: randomUUID(), title, target, deviceName, durationSeconds,
      startedAt: new Date().toISOString(), status: "connecting",
      memoryMetric: target.platform === "android" ? "rss" : "physical-footprint", samples: [],
    };
    recordingSchema.parse(recording);
    const sessionId = this.cpu.open(target);
    const active: ActiveRecording = { recording, stop: false, interrupted: false, job: Promise.resolve() };
    this.active.set(recording.id, active);
    active.job = this.collect(active, sessionId);
    return { ...recording, samples: [] };
  }

  private async collect(active: ActiveRecording, sessionId: string) {
    const recording = active.recording;
    const connectingAt = performance.now();
    let recordingAt: number | undefined;
    let origin: number | undefined;
    let cursor = 0;
    try {
      while (active.stop === false) {
        const now = performance.now();
        if (recordingAt !== undefined && now - recordingAt >= recording.durationSeconds * 1000) break;
        if (recordingAt === undefined && now - connectingAt > 60000) throw new Error("The CPU collector did not become ready within 60 seconds.");
        const remaining = recordingAt === undefined ? 1000 : recording.durationSeconds * 1000 - (now - recordingAt);
        const waitMs = Math.min(1000, remaining);
        const batch = await this.cpu.read(sessionId, cursor, waitMs);
        cursor = batch.cursor;
        if (batch.phase === "failed") throw new Error(batch.error ?? "CPU collection failed.");
        if (batch.phase === "stopped" || batch.phase === "stopping") throw new Error("The CPU monitor stopped before the recording finished.");
        for (const sample of batch.samples) {
          if (origin === undefined) {
            origin = sample.time;
            recordingAt = performance.now();
            recording.startedAt = new Date().toISOString();
            recording.status = "recording";
          }
          const time = sample.time - origin;
          if (time < 0 || time > recording.durationSeconds) continue;
          if (recording.samples.length >= 1800) throw new Error("This recording exceeded its sample limit.");
          recording.samples.push({ ...sample, time });
        }
      }
      if (active.interrupted) throw new Error("Recording interrupted because the plugin server closed.");
      if (recording.samples.length === 0) throw new Error("No performance samples were recorded.");
      recording.status = "finished";
    } catch (error) {
      recording.status = "failed";
      recording.error = errorMessage(error);
      captureServerError(error, "recording.collect");
    } finally {
      try { await this.cpu.closeSession(sessionId); }
      catch (error) {
        recording.status = "failed";
        recording.error = errorMessage(error);
        captureServerError(error, "recording.close");
      }
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
    if (active) return { ...active.recording, samples: [...active.recording.samples] };
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
