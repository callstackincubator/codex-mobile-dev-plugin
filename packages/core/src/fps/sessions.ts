import { displayFpsTargetSchema } from "@mobile-dev/shared/display-fps.ts";
import type { DisplayFpsBatch, DisplayFpsSample, DisplayFpsTarget } from "@mobile-dev/shared/display-fps.ts";
import { startDisplayFpsMonitor } from "./source.ts";
import { SampleBuffer } from "../cpu/buffer.ts";
import { CollectorSession, androidKind } from "../collector-session.ts";
import { SessionRegistry } from "../session-registry.ts";

type Session = { target: DisplayFpsTarget; collector: CollectorSession<DisplayFpsSample> };

export class DisplayFpsSessions {
  private readonly sessions = new SessionRegistry<Session>({
    limit: 8, name: "FPS",
    limitMessage: "Too many Display FPS sessions.",
    expiredMessage: "This Display FPS session expired or closed.",
    key: ({ target }) => `${target.platform}:${target.deviceId}`,
    duplicateMessage: "This device already has a Display FPS monitor. Stop it in the other panel first.",
    deviceId: session => session.target.deviceId,
    stop: session => session.collector.stop(),
  });
  private readonly monitor: typeof startDisplayFpsMonitor;

  constructor(monitor = startDisplayFpsMonitor) { this.monitor = monitor; }

  open(input: DisplayFpsTarget) {
    const target = displayFpsTargetSchema.parse(input);
    const buffer = new SampleBuffer<DisplayFpsSample>();
    const collector: CollectorSession<DisplayFpsSample> = new CollectorSession(buffer, {
      attach: signal => this.monitor({ target, signal, onSample: reading => {
        if (collector.active === false) return;
        const sample: DisplayFpsSample = { time: reading.recordedAt, interval: reading.interval, fps: reading.fps };
        if (reading.frameTimeline !== undefined) sample.frameTimeline = reading.frameTimeline;
        buffer.push(sample);
      } }),
      readyOnAttach: false, abortOnStop: "immediately",
      telemetry: { collector: "fps", platform: target.platform, kind: target.platform === "android" ? androidKind(target.deviceId) : "physical" },
    });
    const id = this.sessions.add({ target, collector });
    collector.begin();
    return id;
  }

  async read(id: string, after: number, waitMs = 1000, signal?: AbortSignal): Promise<DisplayFpsBatch> {
    const { buffer } = this.sessions.get(id, { stopping: true }).collector;
    const { cursor, samples } = await buffer.collect(after, waitMs, signal);
    return { cursor, phase: buffer.phase, error: buffer.error, samples };
  }

  closeSession(id: string) { return this.sessions.closeSession(id); }
  closeDevice(deviceId: string) { return this.sessions.closeDevice(deviceId); }
  close() { return this.sessions.close(); }
}
