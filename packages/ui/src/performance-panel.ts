import type { HostBridge } from "./host-bridge.ts";
import { recordUiTiming, setUiGauge } from "./telemetry.ts";
import { CPU_HISTORY_SECONDS, CPU_MAX_SAMPLES } from "@mobile-dev/shared/cpu.ts";
import type { DeviceApp } from "@mobile-dev/shared/device-apps.ts";
import type { CpuBatch, CpuPhase, CpuSample, CpuTarget } from "@mobile-dev/shared/cpu.ts";
import type { SimulatorDevice } from "@mobile-dev/shared/protocol.ts";
import type { ThreadHistory, ThreadOrder } from "./performance/types.ts";
import { DisplayFpsPanel, initialFpsState } from "./display-fps-panel.ts";
import type { DisplayFpsState } from "./display-fps-panel.ts";
import type { DeviceAppsStore } from "./device-apps.ts";
import { errorMessage } from "@mobile-dev/shared/error-reporting.ts";
import { isDeviceActive, isPhysicalIos, sameDevice } from "@mobile-dev/shared/devices.ts";
import { Store } from "./store.ts";
import { callTool } from "./tool-call.ts";

type Snapshot = DisplayFpsState & {
  open: boolean; available: boolean; discovering: boolean; monitoring: boolean;
  selectedLabel: string; platform: "ios" | "android"; bundleId: string; apps: DeviceApp[]; samples: CpuSample[];
  threadHistory: ReadonlyMap<string, ThreadHistory>;
  threadOrder: ThreadOrder;
  phase: CpuPhase; error: string; sourceError: string;
  physical: boolean;
};
type Session = { id: string; abort: AbortController; closing?: Promise<void> };

export class PerformancePanel extends Store<Snapshot> {
  private app: HostBridge;
  private fps: DisplayFpsPanel;
  private timeOrigin?: number;
  private simulator?: SimulatorDevice;
  private session?: Session;
  private enabled = false;
  private disposed = false;
  private epoch = 0;
  private readonly deviceApps: DeviceAppsStore;
  private readonly unsubscribeApps: () => void;
  private nextThreadNumber = 1;
  private cleanup: Promise<void> = Promise.resolve();
  private running?: Promise<void>;
  private selections = new Map<string, string>();

  constructor(app: HostBridge, deviceApps: DeviceAppsStore) {
    super({ ...initialFpsState, physical: false, open: false, available: false, discovering: false, monitoring: false,
      selectedLabel: "Selected device", platform: "ios", bundleId: "", apps: [], samples: [], threadHistory: new Map(), threadOrder: "activity",
      phase: "idle", error: "", sourceError: "" });
    this.app = app;
    this.deviceApps = deviceApps;
    this.fps = new DisplayFpsPanel(app, (fields, origin) => {
      if (origin !== undefined && this.timeOrigin === undefined) this.timeOrigin = origin;
      const samples = fields.fpsSamples;
      if (samples && this.timeOrigin !== undefined) {
        const offset = this.timeOrigin;
        const fpsSamples = samples.map(sample => ({ ...sample, time: sample.time - offset }));
        this.update({ ...fields, fpsSamples });
      } else this.update(fields);
    });
    this.unsubscribeApps = deviceApps.subscribe(() => this.appsChanged());
    this.appsChanged();
  }
  private resetHistory(fields: Partial<Snapshot>) {
    this.nextThreadNumber = 1;
    const threadHistory = new Map<string, ThreadHistory>();
    this.update({ ...fields, samples: [], threadHistory });
  }
  private failed(error: unknown) { this.update({ phase: "failed", monitoring: false, error: errorMessage(error) }); }
  private deviceKey(device: SimulatorDevice) { return `${device.platform}:${device.udid}`; }

  setAvailable(available: boolean) {
    this.fps.setAvailable(available);
    this.update({ available });
    if (available && this.enabled) this.appsChanged();
    if (available === false) void this.stop().catch(error => this.failed(error));
  }

  private selectSimulator(simulator?: SimulatorDevice) {
    const changed = !sameDevice(simulator, this.simulator);
    this.simulator = simulator;
    this.update({ selectedLabel: simulator?.name ?? "Selected device", platform: simulator?.platform ?? "ios", physical: simulator?.kind === "physical" });
    if (changed === false) return;
    this.timeOrigin = undefined;
    this.fps.select(simulator);
    let bundleId = "";
    if (simulator) {
      const key = this.deviceKey(simulator);
      bundleId = this.selections.get(key) ?? "";
    }
    this.resetHistory({ apps: [], bundleId, discovering: false, monitoring: false, sourceError: "", error: "",
      phase: "idle" });
    void this.stop().catch(error => this.failed(error));
  }

  show() {
    if (this.disposed) return;
    this.enabled = true;
    this.fps.show();
    this.update({ open: true });
    this.appsChanged();
    if (this.state.bundleId && this.running === undefined) this.restart();
  }

  hide() { this.update({ open: false }); }

  refreshApps() { return this.deviceApps.refresh(); }

  setThreadOrder(threadOrder: ThreadOrder) { this.update({ threadOrder }); }

  async disconnect() {
    this.enabled = false;
    this.update({ discovering: false });
    try {
      const cpu = this.stop();
      const fps = this.fps.disconnect();
      await Promise.all([cpu, fps]);
      this.update({ monitoring: false, phase: "stopped" });
    }
    catch (error) { this.failed(error); }
  }

  selectApp(bundleId: string) {
    if (bundleId === this.state.bundleId) return;
    if (this.simulator) {
      const key = this.deviceKey(this.simulator);
      this.selections.set(key, bundleId);
    }
    this.resetHistory({ bundleId, error: "" });
    this.restart();
  }

  retry() { this.restart(); }
  retryFps() { this.fps.retry(); }

  private call(name: string, arguments_: Record<string, unknown>) { return callTool(this.app, { name, arguments: arguments_ }, { timeout: 45000 }); }

  private appsChanged() {
    if (this.disposed) return;
    const source = this.deviceApps.getSnapshot();
    this.selectSimulator(source.device);
    if (this.enabled === false || this.state.available === false) return;
    this.update({ discovering: source.discovering, sourceError: source.error });
    if (source.ready === false || source.discovering) return;
    const device = source.device;
    if (device === undefined) return;
    const apps = source.apps;
    const previous = this.state.apps.find(app => app.bundleId === this.state.bundleId);
    let bundleId = this.state.bundleId;
    if (bundleId === "") {
      const foreground = apps.find(app => app.foreground === true);
      if (foreground) bundleId = foreground.bundleId;
    }
    const key = this.deviceKey(device);
    this.selections.set(key, bundleId);
    const selected = apps.find(app => app.bundleId === bundleId);
    this.update({ apps, bundleId });
    if (selected && previous?.pid !== selected.pid) this.restart();
    if (bundleId && selected === undefined) {
      const epoch = this.epoch + 1;
      void this.stop().then(() => {
        if (this.disposed === false && epoch === this.epoch) this.update({ phase: "idle", error: "", monitoring: false });
      }).catch(error => this.failed(error));
    }
  }

  private restart() {
    const stopping = this.stop();
    const epoch = this.epoch;
    const device = this.simulator;
    const bundleId = this.state.bundleId;
    if (this.enabled === false || this.state.available === false || device === undefined || !isDeviceActive(device) || bundleId === "") {
      void stopping.catch(error => this.failed(error));
      this.update({ monitoring: false });
      return;
    }
    this.resetHistory({ phase: "connecting", error: "", monitoring: true });
    const target: CpuTarget = { deviceId: device.udid, platform: device.platform, bundleId };
    if (isPhysicalIos(device)) target.kind = "physical";
    this.running = this.receive(target, epoch, stopping).catch(error => {
      if (this.disposed === false && epoch === this.epoch) this.update({ phase: "failed", error: errorMessage(error), monitoring: false });
    });
  }

  private async receive(target: CpuTarget, epoch: number, stopping: Promise<void>) {
    await stopping;
    if (epoch === this.epoch && this.session) await this.closeSession(this.session);
    if (epoch !== this.epoch || this.disposed) return;
    const result = await this.call("mobile_cpu_session", { target });
    const id = result.structuredContent?.sessionId;
    const cpuUri = result.structuredContent?.cpuUri;
    if (typeof id !== "string" || typeof cpuUri !== "string") throw new Error("The plugin did not return a CPU session.");
    const session: Session = { id, abort: new AbortController() };
    this.session = session;
    if (epoch !== this.epoch || this.disposed) { await this.closeSession(session); return; }
    const uri = new URL(cpuUri);
    let after = 0;
    try {
      while (epoch === this.epoch && session.abort.signal.aborted === false) {
        uri.searchParams.set("after", String(after));
        const resource = await this.app.readServerResource({ uri: uri.href }, { signal: session.abort.signal, timeout: 10000 });
        if (epoch !== this.epoch || session.abort.signal.aborted) return;
        const content = resource.contents.find(item => item.mimeType === "application/json" && "text" in item);
        if (content === undefined || !("text" in content)) throw new Error("The plugin returned an invalid CPU batch.");
        const processingStartedAt = performance.now();
        const batch: CpuBatch = JSON.parse(content.text);
        after = batch.cursor;
        if (batch.timeOrigin !== undefined && this.timeOrigin === undefined) this.timeOrigin = batch.timeOrigin;
        const offset = batch.timeOrigin === undefined ? 0 : batch.timeOrigin - (this.timeOrigin ?? batch.timeOrigin);
        const incoming = batch.samples.map(sample => ({ ...sample, time: sample.time + offset }));
        const combined = [...this.state.samples, ...incoming];
        const latest = combined.at(-1)?.time ?? 0;
        const retained = combined.filter(sample => sample.time >= latest - CPU_HISTORY_SECONDS);
        const samples = retained.slice(-CPU_MAX_SAMPLES);
        const threadHistory = new Map<string, ThreadHistory>();
        for (const sample of samples) {
          for (const thread of sample.threads) {
            if (threadHistory.has(thread.id)) continue;
            let history = this.state.threadHistory.get(thread.id);
            if (history === undefined) history = { number: this.nextThreadNumber++, peakCpuPercent: 0 };
            threadHistory.set(thread.id, history);
          }
        }
        for (const sample of batch.samples) {
          for (const thread of sample.threads) {
            const history = threadHistory.get(thread.id);
            if (history && thread.cpuPercent !== null && thread.cpuPercent > history.peakCpuPercent) {
              threadHistory.set(thread.id, { ...history, peakCpuPercent: thread.cpuPercent });
            }
          }
        }
        this.update({ samples, threadHistory, phase: batch.phase, error: batch.error ?? "", monitoring: batch.phase === "connecting" || batch.phase === "recording" });
        const processingElapsed = performance.now() - processingStartedAt;
        recordUiTiming("ui.performance.process_batch", processingElapsed);
        setUiGauge("ui.performance.retained_samples", samples.length);
        setUiGauge("ui.performance.threads", threadHistory.size);
      }
    } finally { await this.closeSession(session); }
  }

  // A session stays current until its close succeeds, so a failed close is retried before another session opens.
  private closeSession(session: Session): Promise<void> {
    session.abort.abort();
    session.closing ??= this.call("mobile_cpu_close", { sessionId: session.id }).then(() => {
      if (this.session === session) this.session = undefined;
    }, error => {
      session.closing = undefined;
      throw error;
    });
    return session.closing;
  }

  async stop() {
    this.epoch++;
    const session = this.session;
    const running = this.running;
    this.running = undefined;
    const closing = session ? this.closeSession(session) : Promise.resolve();
    const settled = Promise.allSettled([this.cleanup, closing, running]);
    this.cleanup = settled.then(() => {});
    await settled;
    return closing;
  }

  async dispose() {
    this.disposed = true;
    this.unsubscribeApps();
    this.hide();
    await this.disconnect();
    this.close();
  }
}
