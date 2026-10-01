import { randomBytes } from "node:crypto";
import { CPU_HISTORY_SECONDS, CPU_MAX_SAMPLES } from "../../shared/cpu.ts";
import type { CpuPhase } from "../../shared/cpu.ts";
import { displayFpsTargetSchema } from "../../shared/display-fps.ts";
import type { DisplayFpsBatch, DisplayFpsSample, DisplayFpsTarget } from "../../shared/display-fps.ts";
import { errorMessage } from "../../shared/protocol.ts";
import { startDisplayFpsMonitor } from "./source.ts";
import type { CpuMonitor } from "../cpu/monitor.ts";

type Session = {
  target: DisplayFpsTarget; phase: CpuPhase; error?: string; abort: AbortController; expires: number;
  samples: Array<{ revision: number; sample: DisplayFpsSample }>; revision: number; waiters: Set<() => void>;
  start?: Promise<void>; monitor?: CpuMonitor; stopping?: Promise<void>;
};

export class DisplayFpsSessions {
  private sessions = new Map<string, Session>();
  private devices = new Set<string>();
  private disposed = false;
  private expiry: NodeJS.Timeout;
  private monitor: typeof startDisplayFpsMonitor;
  constructor(monitor = startDisplayFpsMonitor) {
    this.monitor = monitor;
    this.expiry = setInterval(() => {
      for (const [id, session] of this.sessions) {
        if (session.expires < Date.now()) void this.closeSession(id).catch(error => console.error("FPS cleanup:", error));
      }
    }, 10000);
    this.expiry.unref();
  }
  private key(target: DisplayFpsTarget) { return `${target.platform}:${target.deviceId}`; }
  private status(session: Session, phase: CpuPhase, error?: string) {
    if (session.stopping) return;
    session.phase = phase;
    session.error = error;
    session.revision++;
    for (const notify of session.waiters) notify();
  }
  open(input: DisplayFpsTarget) {
    const target = displayFpsTargetSchema.parse(input);
    if (this.disposed) throw new Error("The plugin server has closed.");
    if (this.sessions.size >= 8) throw new Error("Too many Display FPS sessions.");
    const key = this.key(target);
    if (this.devices.has(key)) throw new Error("This device already has a Display FPS monitor. Stop it in the other panel first.");
    const session: Session = { target, phase: "connecting", abort: new AbortController(), expires: Date.now() + 300000,
      samples: [], revision: 0, waiters: new Set() };
    const bytes = randomBytes(32);
    const id = bytes.toString("hex");
    this.sessions.set(id, session);
    this.devices.add(key);
    session.start = this.initialize(session);
    return id;
  }
  private async initialize(session: Session) {
    const signal = session.abort.signal;
    try {
      session.monitor = await this.monitor({ target: session.target, signal, onSample: reading => {
        if (signal.aborted || session.stopping) return;
        const sample = { time: reading.recordedAt, interval: reading.interval, fps: reading.fps };
        const last = session.samples.at(-1);
        const latest = Math.max(sample.time, last?.sample.time ?? sample.time);
        session.samples = session.samples.filter(entry => entry.sample.time >= latest - CPU_HISTORY_SECONDS && entry.sample.time !== sample.time);
        session.samples.push({ revision: ++session.revision, sample });
        session.samples.sort((a, b) => a.sample.time - b.sample.time);
        session.samples = session.samples.slice(-CPU_MAX_SAMPLES);
        this.status(session, "recording");
      } });
      if (signal.aborted) return;
      const failureHandling = session.monitor.closed.then(async error => {
        if (session.stopping) return;
        this.status(session, "failed", error.message);
        await session.monitor?.stop();
      });
      void failureHandling.catch(error => {
        const message = errorMessage(error);
        this.status(session, "failed", message);
      });
    } catch (error) {
      if (signal.aborted === false) {
        const message = errorMessage(error);
        this.status(session, "failed", message);
      }
    }
  }
  async read(id: string, after: number, waitMs = 1000): Promise<DisplayFpsBatch> {
    const session = this.sessions.get(id);
    if (session === undefined) throw new Error("This Display FPS session expired or closed.");
    session.expires = Date.now() + 300000;
    if (after >= session.revision && waitMs > 0 && session.stopping === undefined) {
      await new Promise<void>(resolve => {
        const done = () => { clearTimeout(timer); session.waiters.delete(done); resolve(); };
        const timer = setTimeout(done, waitMs);
        session.waiters.add(done);
      });
    }
    const entries = session.samples.filter(entry => entry.revision > after);
    const samples = entries.map(entry => entry.sample);
    return { cursor: session.revision, phase: session.phase, error: session.error, samples };
  }
  async closeSession(id: string) {
    const session = this.sessions.get(id);
    if (session === undefined) return;
    if (session.stopping) return session.stopping;
    this.status(session, "stopping");
    session.abort.abort();
    session.stopping = (async () => {
      try { await session.start; await session.monitor?.stop(); }
      finally {
        this.sessions.delete(id);
        const key = this.key(session.target);
        this.devices.delete(key);
      }
    })();
    return session.stopping;
  }
  async closeDevice(deviceId: string) {
    const pending: Promise<void>[] = [];
    for (const [id, session] of this.sessions) {
      if (session.target.deviceId !== deviceId) continue;
      const closing = this.closeSession(id);
      pending.push(closing);
    }
    await Promise.all(pending);
  }
  async close() {
    this.disposed = true;
    clearInterval(this.expiry);
    const pending: Promise<void>[] = [];
    for (const id of this.sessions.keys()) {
      const closing = this.closeSession(id);
      pending.push(closing);
    }
    await Promise.all(pending);
  }
}
