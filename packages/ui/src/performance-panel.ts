import type { HostBridge } from "./host-bridge.ts";
import { recordUiTiming, setUiGauge } from "./telemetry.ts";
import { CPU_HISTORY_SECONDS, CPU_MAX_SAMPLES, cpuBatchSchema } from "@mobile-dev/shared/cpu.ts";
import type { DeviceApp } from "@mobile-dev/shared/device-apps.ts";
import type { CpuBatch, CpuPhase, CpuSample, CpuTarget } from "@mobile-dev/shared/cpu.ts";
import type { SimulatorDevice } from "@mobile-dev/shared/protocol.ts";
import type { ThreadHistory, ThreadOrder } from "./components/performance/types.ts";
import { DisplayFpsPanel, initialFpsState } from "./display-fps-panel.ts";
import type { DisplayFpsState } from "./display-fps-panel.ts";
import type { AppDevice, DeviceAppsStore } from "./device-apps.ts";
import { errorMessage } from "@mobile-dev/shared/error-reporting.ts";
import { isDeviceActive, isPhysicalIos, sameDevice } from "@mobile-dev/shared/devices.ts";
import { Store } from "./store.ts";
import { callTool } from "./tool-call.ts";
import { CollectorSessions, openCursorSession } from "./resource-session.ts";
import { cpuSessionResultSchema } from "@mobile-dev/shared/tool-results.ts";

const appDevice = (device: SimulatorDevice): AppDevice => ({ platform: device.platform, deviceId: device.udid });
// The session and the resource its batches come from; the target it echoes is not needed.
const cpuSession = cpuSessionResultSchema.pick({ sessionId: true, cpuUri: true });

type Snapshot = DisplayFpsState & {
  open: boolean; available: boolean; discovering: boolean; monitoring: boolean;
  selectedLabel: string; platform: "ios" | "android"; bundleId: string; apps: DeviceApp[]; samples: CpuSample[];
  threadHistory: ReadonlyMap<string, ThreadHistory>;
  threadOrder: ThreadOrder;
  phase: CpuPhase; error: string; sourceError: string;
  physical: boolean;
  /** CPU or FPS monitoring is running. */
  running: boolean;
  /** The phase the tool shows: FPS's while it records or when CPU monitoring is off, otherwise CPU's. */
  displayPhase: CpuPhase;
};

export class PerformancePanel extends Store<Snapshot> {
  private app: HostBridge;
  private fps: DisplayFpsPanel;
  private timeOrigin?: number;
  private simulator?: SimulatorDevice;
  private enabled = false;
  private disposed = false;
  private readonly sessions = new CollectorSessions();
  private readonly deviceApps: DeviceAppsStore;
  private readonly unsubscribeApps: () => void;
  private nextThreadNumber = 1;

  constructor(app: HostBridge, deviceApps: DeviceAppsStore) {
    super({ ...initialFpsState, physical: false, open: false, available: false, discovering: false, monitoring: false,
      selectedLabel: "Selected device", platform: "ios", bundleId: "", apps: [], samples: [], threadHistory: new Map(), threadOrder: "activity",
      phase: "idle", error: "", sourceError: "", running: false, displayPhase: "idle" });
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
  protected update(fields: Partial<Snapshot>) {
    const next = { ...this.state, ...fields };
    let displayPhase = next.phase;
    if (next.fpsPhase === "recording") displayPhase = "recording";
    else if ((next.fpsPhase === "connecting" || next.fpsPhase === "failed") && next.monitoring === false) displayPhase = next.fpsPhase;
    this.set({ ...next, running: next.monitoring || next.fpsMonitoring, displayPhase });
  }
  private resetHistory(fields: Partial<Snapshot>) {
    this.nextThreadNumber = 1;
    const threadHistory = new Map<string, ThreadHistory>();
    this.update({ ...fields, samples: [], threadHistory });
  }
  private failed(error: unknown) { this.update({ phase: "failed", monitoring: false, error: errorMessage(error) }); }

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
    // The app picked on this device, else the foreground app once discovery reports it.
    const bundleId = simulator ? this.deviceApps.pickedApp("performance", appDevice(simulator)) ?? "" : "";
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
    if (this.state.bundleId && this.sessions.running === undefined) this.restart();
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
    if (this.simulator) this.deviceApps.pickApp("performance", appDevice(this.simulator), bundleId);
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
    this.deviceApps.pickApp("performance", appDevice(device), bundleId);
    const selected = apps.find(app => app.bundleId === bundleId);
    this.update({ apps, bundleId });
    if (selected && previous?.pid !== selected.pid) this.restart();
    if (bundleId && selected === undefined) {
      const epoch = this.sessions.epoch + 1;
      void this.stop().then(() => {
        if (this.disposed === false && epoch === this.sessions.epoch) this.update({ phase: "idle", error: "", monitoring: false });
      }).catch(error => this.failed(error));
    }
  }

  private restart() {
    const stopping = this.stop();
    const epoch = this.sessions.epoch;
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
    this.sessions.running = this.receive(target, epoch, stopping).catch(error => {
      if (this.disposed === false && epoch === this.sessions.epoch) this.update({ phase: "failed", error: errorMessage(error), monitoring: false });
    });
  }

  private async receive(target: CpuTarget, epoch: number, stopping: Promise<void>) {
    if (!await this.sessions.prepare(epoch, stopping) || this.disposed) return;
    await openCursorSession({
      app: this.app,
      open: async () => {
        const opened = cpuSession.safeParse((await this.call("mobile_cpu_session", { target })).structuredContent);
        if (!opened.success) throw new Error("The plugin did not return a CPU session.");
        return { id: opened.data.sessionId, uri: opened.data.cpuUri };
      },
      close: id => this.call("mobile_cpu_close", { sessionId: id }),
      closePolicy: "retry",
      opened: session => this.sessions.adopt(session, epoch) && !this.disposed,
      active: () => epoch === this.sessions.epoch,
      schema: cpuBatchSchema,
      invalid: () => new Error("The plugin returned an invalid CPU batch."),
      cursor: batch => batch.cursor,
      timeout: 10000,
      onBatch: (batch, arrivedAt) => this.accept(batch, arrivedAt),
    });
  }

  private accept(batch: CpuBatch, arrivedAt: number) {
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
    // Measured from the batch's arrival, so parsing and validating it count as processing.
    recordUiTiming("ui.performance.process_batch", performance.now() - arrivedAt);
    setUiGauge("ui.performance.retained_samples", samples.length);
    setUiGauge("ui.performance.threads", threadHistory.size);
  }

  stop() { return this.sessions.stop(); }

  async dispose() {
    this.disposed = true;
    this.unsubscribeApps();
    this.hide();
    await this.disconnect();
    this.close();
  }
}
