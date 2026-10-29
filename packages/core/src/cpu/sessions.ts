import { ExpectedOperationError } from "@mobile-dev/shared/error-reporting.ts";
import type { z } from "zod";
import type { CpuBatch, CpuSample, CpuTarget, MemoryMetric } from "@mobile-dev/shared/cpu.ts";
import { cpuTargetSchema } from "@mobile-dev/shared/cpu.ts";
import { runningDeviceApps } from "../device-apps/apps.ts";
import { CpuBuffer } from "./buffer.ts";
import { startCpuMonitor } from "./source.ts";
import type { CpuMonitorOptions } from "./source.ts";
import { androidCpuCollector } from "./android.ts";
import { CollectorSession, androidKind } from "../collector-session.ts";
import { SessionRegistry } from "../session-registry.ts";
import type { CpuMonitor } from "./monitor.ts";

type Session = { target: CpuTarget; buffer: CpuBuffer; collector: CollectorSession<CpuSample> };
type CpuSources = { apps: typeof runningDeviceApps; monitor: (options: CpuMonitorOptions) => Promise<CpuMonitor> };

export function createCpuSessions(root = new URL("./android-cpu/", import.meta.url)): CpuSessions {
  const collector = androidCpuCollector(root);
  const monitor = (options: CpuMonitorOptions) => startCpuMonitor(options, collector);
  const sessions = new CpuSessions({ apps: runningDeviceApps, monitor });
  return sessions;
}

export class CpuSessions {
  private readonly sessions = new SessionRegistry<Session>({
    limit: 8, name: "CPU session",
    limitMessage: "Too many CPU sessions. Close a performance panel and retry.",
    expiredMessage: "This CPU session expired or closed. Reconnect the performance panel.",
    key: ({ target }) => `${target.platform}:${target.deviceId}:${target.bundleId}`,
    duplicateMessage: "This app already has an active CPU monitor. Stop it in the other performance panel first.",
    deviceId: session => session.target.deviceId,
    stop: session => session.collector.stop(),
  });
  private readonly sources: CpuSources;

  constructor(sources: CpuSources) { this.sources = sources; }

  open(input: z.input<typeof cpuTargetSchema>): string {
    const target = cpuTargetSchema.parse(input);
    const memoryMetric: MemoryMetric = target.platform === "android" ? "rss" : "physical-footprint";
    const buffer = new CpuBuffer(memoryMetric);
    const kind = target.platform === "android" ? androidKind(target.deviceId) : target.kind ?? "simulator";
    const collector: CollectorSession<CpuSample> = new CollectorSession(buffer, {
      attach: signal => this.attach(target, buffer, collector, signal), readyOnAttach: true, abortOnStop: "before-attach",
      telemetry: { collector: "cpu", platform: target.platform, kind },
    });
    const id = this.sessions.add({ target, buffer, collector });
    collector.begin();
    return id;
  }

  private async attach(target: CpuTarget, buffer: CpuBuffer, collector: CollectorSession<CpuSample>, signal: AbortSignal) {
    const apps = await this.sources.apps(target.deviceId, signal, target.platform, target.kind);
    signal.throwIfAborted();
    const app = apps.find(candidate => candidate.bundleId === target.bundleId);
    if (app === undefined) throw new ExpectedOperationError("app_unavailable", "The selected app is no longer running. Open it on the selected device.");
    const startedAt = performance.now();
    buffer.timeOrigin = startedAt / 1000;
    return this.sources.monitor({ target, pid: app.pid, signal, onSample: reading => {
      if (collector.active === false) return;
      const now = performance.now();
      buffer.push({ time: (now - startedAt) / 1000, interval: reading.intervalUs / 1000000,
        cpuPercent: reading.cpuPercent, memoryBytes: reading.memoryBytes, threads: reading.threads });
    } });
  }

  async read(id: string, after: number, waitMs = 1000, signal?: AbortSignal): Promise<CpuBatch> {
    return this.sessions.get(id, { stopping: true }).buffer.read(after, waitMs, signal);
  }

  closeSession(id: string) { return this.sessions.closeSession(id); }
  closeDevice(deviceId: string) { return this.sessions.closeDevice(deviceId); }
  close() { return this.sessions.close(); }
}
