import { randomBytes } from "node:crypto";
import type { z } from "zod";
import type { CpuBatch, CpuTarget } from "../../shared/cpu.ts";
import { cpuTargetSchema } from "../../shared/cpu.ts";
import { errorMessage } from "../../shared/protocol.ts";
import { runningCpuApps } from "./apps.ts";
import { CpuBuffer } from "./buffer.ts";
import { startCpuMonitor } from "./source.ts";
import type { CpuMonitorOptions } from "./source.ts";
import { loadAndroidCollector } from "./android.ts";
import type { CpuMonitor } from "./monitor.ts";

type Session = {
  target: CpuTarget;
  buffer: CpuBuffer;
  abort: AbortController;
  expires: number;
  start?: Promise<void>;
  monitor?: CpuMonitor;
  stopping?: Promise<void>;
};
type CpuSources = { apps: typeof runningCpuApps; monitor: (options: CpuMonitorOptions) => Promise<CpuMonitor> };

export async function createCpuSessions(root = new URL("./android-cpu/", import.meta.url)): Promise<CpuSessions> {
  const collector = await loadAndroidCollector(root);
  const monitor = (options: CpuMonitorOptions) => startCpuMonitor(options, collector);
  const sessions = new CpuSessions({ apps: runningCpuApps, monitor });
  return sessions;
}

export class CpuSessions {
  private sessions = new Map<string, Session>();
  private targets = new Map<string, Session>();
  private closing = new Set<Promise<void>>();
  private disposed = false;
  private expiry: NodeJS.Timeout;
  private sources: CpuSources;

  constructor(sources: CpuSources) {
    this.sources = sources;
    this.expiry = setInterval(() => {
      for (const [id, session] of this.sessions) {
        if (session.expires < Date.now()) void this.closeSession(id).catch(error => console.error("CPU session cleanup:", error));
      }
    }, 10000);
    this.expiry.unref();
  }

  private key(target: CpuTarget) { return `${target.platform}:${target.deviceId}:${target.bundleId}`; }

  open(input: z.input<typeof cpuTargetSchema>): string {
    const target = cpuTargetSchema.parse(input);
    if (this.disposed) throw new Error("The plugin server has closed.");
    if (this.sessions.size >= 8) throw new Error("Too many CPU sessions. Close a performance panel and retry.");
    const key = this.key(target);
    if (this.targets.has(key)) throw new Error("This app already has an active CPU monitor. Stop it in the other performance panel first.");
    const session: Session = { target, buffer: new CpuBuffer(), abort: new AbortController(), expires: Date.now() + 300000 };
    const bytes = randomBytes(32);
    const id = bytes.toString("hex");
    this.sessions.set(id, session);
    this.targets.set(key, session);
    session.start = this.initialize(session);
    return id;
  }

  private async initialize(session: Session) {
    const signal = session.abort.signal;
    try {
      const apps = await this.sources.apps(session.target.deviceId, signal, session.target.platform);
      signal.throwIfAborted();
      const app = apps.find(candidate => candidate.bundleId === session.target.bundleId);
      if (app === undefined) throw new Error("The selected app is no longer running. Open it on the selected device.");
      const startedAt = performance.now();
      session.monitor = await this.sources.monitor({ target: session.target, pid: app.pid, signal, onSample: reading => {
        if (signal.aborted || session.stopping) return;
        const now = performance.now();
        session.buffer.push({ time: (now - startedAt) / 1000, interval: reading.intervalUs / 1000000,
          cpuPercent: reading.cpuPercent, threads: reading.threads });
      } });
      if (signal.aborted || session.stopping) return;
      session.buffer.status("recording");
      void session.monitor.closed.then(async error => {
        if (session.stopping) return;
        session.buffer.status("failed", error.message);
        try { await session.monitor?.stop(); }
        catch (cleanupError) { session.buffer.status("failed", errorMessage(cleanupError)); }
      });
    } catch (error) {
      if (signal.aborted === false) session.buffer.status("failed", errorMessage(error));
    }
  }

  async read(id: string, after: number, waitMs = 1000): Promise<CpuBatch> {
    const session = this.sessions.get(id);
    if (session === undefined) throw new Error("This CPU session expired or closed. Reconnect the performance panel.");
    session.expires = Date.now() + 300000;
    return session.buffer.read(after, waitMs);
  }

  async closeSession(id: string) {
    const session = this.sessions.get(id);
    if (session === undefined) return;
    if (session.stopping) return session.stopping;
    session.buffer.status("stopping");
    session.buffer.close();
    if (session.monitor === undefined) session.abort.abort();
    session.stopping = (async () => {
      try { await session.start; await session.monitor?.stop(); }
      finally {
        session.abort.abort();
        this.sessions.delete(id);
        const key = this.key(session.target);
        this.targets.delete(key);
      }
    })();
    this.closing.add(session.stopping);
    try { await session.stopping; }
    finally { this.closing.delete(session.stopping); }
  }

  async closeDevice(deviceId: string) {
    const ids = [...this.sessions].filter(([, session]) => session.target.deviceId === deviceId);
    await Promise.all(ids.map(([id]) => this.closeSession(id)));
  }

  async close() {
    this.disposed = true;
    clearInterval(this.expiry);
    const ids = [...this.sessions.keys()];
    const results = await Promise.allSettled(ids.map(id => this.closeSession(id)));
    await Promise.allSettled(this.closing);
    const failed = results.find(result => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  }
}
