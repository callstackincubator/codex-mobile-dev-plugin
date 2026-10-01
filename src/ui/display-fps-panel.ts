import type { App } from "@modelcontextprotocol/ext-apps";
import type { CpuPhase } from "../shared/cpu.ts";
import { CPU_HISTORY_SECONDS, CPU_MAX_SAMPLES } from "../shared/cpu.ts";
import type { DisplayFpsBatch, DisplayFpsSample, DisplayFpsTarget } from "../shared/display-fps.ts";
import type { SimulatorDevice } from "../shared/protocol.ts";
import { errorMessage } from "../shared/protocol.ts";

export type DisplayFpsState = { fpsSamples: DisplayFpsSample[]; fpsPhase: CpuPhase; fpsError: string; fpsMonitoring: boolean; fpsSupported: boolean };
type Session = { id: string; abort: AbortController; closing?: Promise<void> };
export const initialFpsState: DisplayFpsState = { fpsSamples: [], fpsPhase: "idle", fpsError: "", fpsMonitoring: false, fpsSupported: false };

export class DisplayFpsPanel {
  private app: App;
  private update: (state: Partial<DisplayFpsState>, origin?: number) => void;
  private device?: SimulatorDevice;
  private available = false;
  private enabled = false;
  private epoch = 0;
  private session?: Session;
  private running?: Promise<void>;
  private cleanup: Promise<void> = Promise.resolve();
  private samples: DisplayFpsSample[] = [];
  constructor(app: App, update: (state: Partial<DisplayFpsState>, origin?: number) => void) {
    this.app = app; this.update = update;
  }
  private stopSafely() {
    const stopped = this.stop();
    void stopped.catch(error => {
      const message = errorMessage(error);
      this.update({ fpsPhase: "failed", fpsError: message });
    });
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
    this.stopSafely();
    if (this.enabled) this.start();
  }
  show() { this.enabled = true; this.start(); }
  retry() { this.stopSafely(); this.start(); }
  private start() {
    const device = this.device;
    if (this.running || this.enabled === false || this.available === false || device === undefined) return;
    const platform = device.platform ?? "ios";
    if (platform === "ios" && device.kind !== "physical") return;
    if (device.state !== "Booted" && device.state !== "connected") return;
    const epoch = this.epoch;
    const target: DisplayFpsTarget = { platform, deviceId: device.udid };
    this.update({ fpsPhase: "connecting", fpsError: "", fpsMonitoring: true });
    const receiving = this.receive(target, epoch, this.cleanup);
    this.running = receiving.catch(error => {
      if (epoch !== this.epoch) return;
      const message = errorMessage(error);
      this.update({ fpsPhase: "failed", fpsError: message, fpsMonitoring: false });
    });
  }
  private async call(name: string, args: Record<string, unknown>) {
    const result = await this.app.callServerTool({ name, arguments: args }, { timeout: 45000 });
    if (result.isError) {
      const messages = result.content.filter(item => item.type === "text");
      const texts = messages.map(item => item.text);
      const message = texts.join("\n");
      throw new Error(message);
    }
    return result;
  }
  private async receive(target: DisplayFpsTarget, epoch: number, cleanup: Promise<void>) {
    await cleanup;
    if (epoch !== this.epoch) return;
    const opened = await this.call("mobile_display_fps_session", { target });
    const id = opened.structuredContent?.sessionId;
    const fpsUri = opened.structuredContent?.fpsUri;
    const origin = opened.structuredContent?.timeOrigin;
    if (typeof id !== "string") throw new Error("The plugin did not return a Display FPS session.");
    const session: Session = { id, abort: new AbortController() };
    if (typeof fpsUri !== "string" || typeof origin !== "number") {
      await this.closeSession(session);
      throw new Error("The plugin did not return a Display FPS resource and clock.");
    }
    if (epoch !== this.epoch) { await this.closeSession(session); return; }
    this.session = session;
    this.update({}, origin);
    const uri = new URL(fpsUri);
    let after = 0;
    try {
      while (epoch === this.epoch && session.abort.signal.aborted === false) {
        const cursor = String(after);
        uri.searchParams.set("after", cursor);
        const resource = await this.app.readServerResource({ uri: uri.href }, { signal: session.abort.signal, timeout: 10000 });
        if (epoch !== this.epoch || session.abort.signal.aborted) return;
        const content = resource.contents.find(item => item.mimeType === "application/json" && "text" in item);
        if (content === undefined || ("text" in content) === false) throw new Error("The plugin returned an invalid Display FPS batch.");
        const batch: DisplayFpsBatch = JSON.parse(content.text);
        after = batch.cursor;
        const updated = new Map<number, DisplayFpsSample>();
        for (const sample of this.samples) updated.set(sample.time, sample);
        for (const sample of batch.samples) updated.set(sample.time, sample);
        const values = updated.values();
        const ordered = Array.from(values);
        ordered.sort((a, b) => a.time - b.time);
        const latest = ordered.at(-1)?.time ?? 0;
        const retained = ordered.filter(sample => sample.time >= latest - CPU_HISTORY_SECONDS);
        this.samples = retained.slice(-CPU_MAX_SAMPLES);
        this.update({ fpsSamples: this.samples, fpsPhase: batch.phase, fpsError: batch.error ?? "",
          fpsMonitoring: batch.phase === "connecting" || batch.phase === "recording" });
        if (batch.phase === "stopping") { this.update({ fpsPhase: "stopped" }); return; }
        if (batch.phase === "failed" || batch.phase === "stopped") return;
      }
    } finally { await this.closeSession(session); }
  }
  private closeSession(session: Session) {
    session.abort.abort();
    if (session.closing === undefined) {
      const closing = this.call("mobile_display_fps_close", { sessionId: session.id });
      session.closing = closing.then(() => {});
    }
    if (this.session === session) this.session = undefined;
    return session.closing;
  }
  stop() {
    this.epoch++;
    const session = this.session;
    const running = this.running;
    this.running = undefined;
    const closing = session ? this.closeSession(session) : Promise.resolve();
    const finishing = Promise.all([this.cleanup, closing, running]);
    this.cleanup = finishing.then(() => {});
    return this.cleanup;
  }
  async disconnect() {
    this.enabled = false;
    this.update({ fpsMonitoring: false, fpsPhase: "stopped" });
    await this.stop();
  }
}
