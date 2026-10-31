import type { HostBridge } from "./host-bridge.ts";
import type { CpuPhase } from "@mobile-dev/shared/cpu.ts";
import { CPU_HISTORY_SECONDS, CPU_MAX_SAMPLES } from "@mobile-dev/shared/cpu.ts";
import { displayFpsBatchSchema } from "@mobile-dev/shared/display-fps.ts";
import type { DisplayFpsBatch, DisplayFpsSample, DisplayFpsTarget } from "@mobile-dev/shared/display-fps.ts";
import { displayFpsSessionResultSchema } from "@mobile-dev/shared/tool-results.ts";
import type { SimulatorDevice } from "@mobile-dev/shared/protocol.ts";
import { errorMessage } from "@mobile-dev/shared/error-reporting.ts";
import { isDeviceActive } from "@mobile-dev/shared/devices.ts";
import { callTool } from "./tool-call.ts";
import { CollectorSessions, openCursorSession } from "./resource-session.ts";

// Sessions that name a resource and its clock; one without them is closed again.
const fpsResource = displayFpsSessionResultSchema.pick({ fpsUri: true, timeOrigin: true });

export type DisplayFpsState = { fpsSamples: DisplayFpsSample[]; fpsPhase: CpuPhase; fpsError: string; fpsMonitoring: boolean; fpsSupported: boolean };
export const initialFpsState: DisplayFpsState = { fpsSamples: [], fpsPhase: "idle", fpsError: "", fpsMonitoring: false, fpsSupported: false };

export class DisplayFpsPanel {
  private app: HostBridge;
  private update: (state: Partial<DisplayFpsState>, origin?: number) => void;
  private device?: SimulatorDevice;
  private available = false;
  private enabled = false;
  private readonly sessions = new CollectorSessions();
  private samples: DisplayFpsSample[] = [];
  constructor(app: HostBridge, update: (state: Partial<DisplayFpsState>, origin?: number) => void) {
    this.app = app; this.update = update;
  }
  private stopSafely() {
    const stopped = this.stop();
    void stopped.catch(error => {
      const message = errorMessage(error);
      this.update({ fpsPhase: "failed", fpsError: message });
    });
    return stopped;
  }
  setAvailable(available: boolean) {
    this.available = available;
    if (available && this.enabled) this.start();
    if (available === false) {
      this.update({ fpsMonitoring: false, fpsPhase: "stopped" });
      this.stopSafely();
    }
  }
  select(device?: SimulatorDevice) {
    this.device = device;
    this.samples = [];
    const supported = device?.platform === "android" || device?.kind === "physical";
    this.update({ ...initialFpsState, fpsSupported: supported });
    const stopped = this.stopSafely();
    if (this.enabled) this.start(stopped);
  }
  show() { this.enabled = true; this.start(); }
  retry() { this.start(this.stopSafely()); }
  private start(cleanup = this.sessions.settled) {
    const device = this.device;
    if (this.sessions.running || this.enabled === false || this.available === false || device === undefined) return;
    if (device.kind === "simulator") return;
    if (!isDeviceActive(device)) return;
    const epoch = this.sessions.epoch;
    const target: DisplayFpsTarget = { platform: device.platform, deviceId: device.udid };
    this.update({ fpsPhase: "connecting", fpsError: "", fpsMonitoring: true });
    const receiving = this.receive(target, epoch, cleanup);
    this.sessions.running = receiving.catch(error => {
      if (epoch !== this.sessions.epoch) return;
      const message = errorMessage(error);
      this.update({ fpsPhase: "failed", fpsError: message, fpsMonitoring: false });
    });
  }
  private call(name: string, args: Record<string, unknown>) { return callTool(this.app, { name, arguments: args }, { timeout: 45000 }); }
  private async receive(target: DisplayFpsTarget, epoch: number, cleanup: Promise<void>) {
    if (!await this.sessions.prepare(epoch, cleanup)) return;
    await openCursorSession({
      app: this.app,
      open: async () => {
        const opened = (await this.call("mobile_display_fps_session", { target })).structuredContent;
        const id = opened?.sessionId;
        if (typeof id !== "string") throw new Error("The plugin did not return a Display FPS session.");
        const resource = fpsResource.safeParse(opened);
        return { id, uri: resource.data?.fpsUri ?? "", origin: resource.data?.timeOrigin };
      },
      close: id => this.call("mobile_display_fps_close", { sessionId: id }),
      closePolicy: "retry",
      opened: async (session, { origin }) => {
        const current = this.sessions.adopt(session, epoch);
        if (origin === undefined) {
          await session.close();
          throw new Error("The plugin did not return a Display FPS resource and clock.");
        }
        if (current) this.update({}, origin);
        return current;
      },
      active: () => epoch === this.sessions.epoch,
      schema: displayFpsBatchSchema,
      invalid: () => new Error("The plugin returned an invalid Display FPS batch."),
      cursor: batch => batch.cursor,
      timeout: 10000,
      onBatch: batch => this.accept(batch),
    });
  }
  private accept(batch: DisplayFpsBatch) {
    const updated = new Map<number, DisplayFpsSample>();
    for (const sample of this.samples) updated.set(sample.time, sample);
    for (const sample of batch.samples) updated.set(sample.time, sample);
    const ordered = Array.from(updated.values());
    ordered.sort((a, b) => a.time - b.time);
    const latest = ordered.at(-1)?.time ?? 0;
    const retained = ordered.filter(sample => sample.time >= latest - CPU_HISTORY_SECONDS);
    this.samples = retained.slice(-CPU_MAX_SAMPLES);
    this.update({ fpsSamples: this.samples, fpsPhase: batch.phase, fpsError: batch.error ?? "",
      fpsMonitoring: batch.phase === "connecting" || batch.phase === "recording" });
    if (batch.phase === "stopping") { this.update({ fpsPhase: "stopped" }); return false; }
    return batch.phase !== "failed" && batch.phase !== "stopped";
  }
  stop() { return this.sessions.stop(); }
  async disconnect() {
    this.enabled = false;
    this.update({ fpsMonitoring: false, fpsPhase: "stopped" });
    await this.stop();
  }
}
