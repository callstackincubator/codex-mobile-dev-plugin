import type { App } from "@modelcontextprotocol/ext-apps";
import { recordUiTiming, setUiGauge } from "./telemetry.ts";
import { CPU_HISTORY_SECONDS, CPU_MAX_SAMPLES } from "../shared/cpu.ts";
import type { CpuApp, CpuBatch, CpuPhase, CpuSample, CpuTarget } from "../shared/cpu.ts";
import type { SimulatorDevice } from "../shared/protocol.ts";
import { errorMessage } from "../shared/protocol.ts";
import type { ThreadHistory, ThreadOrder } from "./performance/types.ts";
import { DisplayFpsPanel, initialFpsState } from "./display-fps-panel.ts";
import type { DisplayFpsState } from "./display-fps-panel.ts";

type Snapshot = DisplayFpsState & {
  open: boolean; available: boolean; discovering: boolean; monitoring: boolean;
  selectedLabel: string; platform: "ios" | "android"; bundleId: string; apps: CpuApp[]; samples: CpuSample[];
  threadHistory: ReadonlyMap<string, ThreadHistory>;
  threadOrder: ThreadOrder;
  phase: CpuPhase; error: string; sourceError: string;
  physical: boolean;
};
type Session = { id: string; abort: AbortController; closing?: Promise<void> };

export class PerformancePanel {
  private app: App;
  private fps: DisplayFpsPanel;
  private timeOrigin?: number;
  private simulator?: SimulatorDevice;
  private session?: Session;
  private enabled = false;
  private disposed = false;
  private epoch = 0;
  private discovery = 0;
  private nextThreadNumber = 1;
  private cleanup: Promise<void> = Promise.resolve();
  private running?: Promise<void>;
  private refresh?: ReturnType<typeof setInterval>;
  private selections = new Map<string, string>();
  private listeners = new Set<() => void>();
  private snapshot: Snapshot = { ...initialFpsState, physical: false, open: false, available: false, discovering: false, monitoring: false,
    selectedLabel: "Selected device", platform: "ios", bundleId: "", apps: [], samples: [], threadHistory: new Map(), threadOrder: "activity",
    phase: "idle", error: "", sourceError: "" };

  constructor(app: App) {
    this.app = app;
    this.fps = new DisplayFpsPanel(app, (fields, origin) => {
      if (origin !== undefined && this.timeOrigin === undefined) this.timeOrigin = origin;
      const samples = fields.fpsSamples;
      if (samples && this.timeOrigin !== undefined) {
        const offset = this.timeOrigin;
        const fpsSamples = samples.map(sample => ({ ...sample, time: sample.time - offset }));
        this.update({ ...fields, fpsSamples });
      } else this.update(fields);
    });
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  private update(fields: Partial<Snapshot>) { this.snapshot = { ...this.snapshot, ...fields }; for (const listener of this.listeners) listener(); }
  private resetHistory(fields: Partial<Snapshot>) {
    this.nextThreadNumber = 1;
    const threadHistory = new Map<string, ThreadHistory>();
    this.update({ ...fields, samples: [], threadHistory });
  }
  private failed(error: unknown) { this.update({ phase: "failed", monitoring: false, error: errorMessage(error) }); }
  private deviceKey(device: SimulatorDevice) { return `${device.platform ?? "ios"}:${device.udid}`; }

  setAvailable(available: boolean) {
    this.fps.setAvailable(available);
    this.update({ available });
    if (available && this.enabled) { void this.discover(); }
    if (available === false) void this.stop().catch(error => this.failed(error));
  }

  selectSimulator(simulator?: SimulatorDevice) {
    const changed = simulator?.udid !== this.simulator?.udid || simulator?.state !== this.simulator?.state || simulator?.platform !== this.simulator?.platform;
    this.simulator = simulator;
    this.update({ selectedLabel: simulator?.name ?? "Selected device", platform: simulator?.platform ?? "ios", physical: simulator?.kind === "physical" });
    if (changed === false) return;
    this.timeOrigin = undefined;
    this.fps.select(simulator);
    this.discovery++;
    let bundleId = "";
    if (simulator) {
      const key = this.deviceKey(simulator);
      bundleId = this.selections.get(key) ?? "";
    }
    this.resetHistory({ apps: [], bundleId, discovering: false, monitoring: false, sourceError: "", error: "",
      phase: "idle" });
    void this.stop().catch(error => this.failed(error));
    if (this.enabled) void this.discover();
  }

  show() {
    if (this.disposed) return;
    this.enabled = true;
    this.fps.show();
    this.update({ open: true });
    if (this.refresh === undefined) this.refresh = setInterval(() => { void this.discover(); }, 3000);
    void this.discover();
    if (this.snapshot.bundleId && this.running === undefined) this.restart();
  }

  hide() { this.update({ open: false }); }

  setThreadOrder(threadOrder: ThreadOrder) { this.update({ threadOrder }); }

  async disconnect() {
    this.enabled = false;
    this.discovery++;
    this.update({ discovering: false });
    clearInterval(this.refresh);
    this.refresh = undefined;
    try {
      const cpu = this.stop();
      const fps = this.fps.disconnect();
      await Promise.all([cpu, fps]);
      this.update({ monitoring: false, phase: "stopped" });
    }
    catch (error) { this.failed(error); }
  }

  selectApp(bundleId: string) {
    if (bundleId === this.snapshot.bundleId) return;
    if (this.simulator) {
      const key = this.deviceKey(this.simulator);
      this.selections.set(key, bundleId);
    }
    this.resetHistory({ bundleId, error: "" });
    this.restart();
  }

  retry() { this.restart(); }
  retryFps() { this.fps.retry(); }

  private async call(name: string, arguments_: Record<string, unknown>) {
    const result = await this.app.callServerTool({ name, arguments: arguments_ }, { timeout: 45000 });
    if (result.isError) {
      const messages = result.content.filter(item => item.type === "text");
      const message = messages.map(item => item.text).join("\n");
      throw new Error(message);
    }
    return result;
  }

  async discover() {
    if (this.disposed || this.snapshot.available === false || this.snapshot.discovering || this.enabled === false) return;
    const device = this.simulator;
    if (device === undefined || (device.state !== "Booted" && device.state !== "connected")) { this.update({ phase: "idle" }); return; }
    const discovery = ++this.discovery;
    this.update({ discovering: true });
    try {
      const platform = device.platform ?? "ios";
      const parameters: { deviceId: string; platform: string; kind?: "physical" } = { deviceId: device.udid, platform };
      if (platform === "ios" && device.kind === "physical") parameters.kind = "physical";
      const result = await this.call("mobile_performance_sources", parameters);
      if (this.disposed || discovery !== this.discovery) return;
      const running = result.structuredContent?.apps;
      if (Array.isArray(running) === false) throw new Error("The plugin did not return running apps.");
      const apps: CpuApp[] = running;
      const previous = this.snapshot.apps.find(app => app.bundleId === this.snapshot.bundleId);
      let bundleId = this.snapshot.bundleId;
      if (bundleId === "") {
        if (platform === "ios" && device.kind === "physical") {
          const foreground = apps.find(app => app.foreground === true);
          if (foreground) bundleId = foreground.bundleId;
        } else if (apps.length === 1) bundleId = apps[0].bundleId;
      }
      const key = this.deviceKey(device);
      this.selections.set(key, bundleId);
      const selected = apps.find(app => app.bundleId === bundleId);
      this.update({ apps, bundleId, sourceError: "" });
      if (selected && previous?.pid !== selected.pid) this.restart();
      if (bundleId && selected === undefined) {
        await this.stop();
        if (discovery === this.discovery) this.update({ phase: "idle", error: "", monitoring: false });
      }
    } catch (error) {
      if (this.disposed === false && discovery === this.discovery) this.update({ sourceError: errorMessage(error) });
    } finally {
      if (this.disposed === false && discovery === this.discovery) this.update({ discovering: false });
    }
  }

  private restart() {
    const stopping = this.stop();
    const epoch = this.epoch;
    const device = this.simulator;
    const bundleId = this.snapshot.bundleId;
    if (this.enabled === false || this.snapshot.available === false || device === undefined || (device.state !== "Booted" && device.state !== "connected") || bundleId === "") {
      void stopping.catch(error => this.failed(error));
      this.update({ monitoring: false });
      return;
    }
    this.resetHistory({ phase: "connecting", error: "", monitoring: true });
    const target: CpuTarget = { deviceId: device.udid, platform: device.platform ?? "ios", bundleId };
    if (target.platform === "ios" && device.kind === "physical") target.kind = "physical";
    this.running = this.receive(target, epoch, stopping).catch(error => {
      if (this.disposed === false && epoch === this.epoch) this.update({ phase: "failed", error: errorMessage(error), monitoring: false });
    });
  }

  private async receive(target: CpuTarget, epoch: number, stopping: Promise<void>) {
    await stopping;
    if (epoch !== this.epoch || this.disposed) return;
    const result = await this.call("mobile_cpu_session", { target });
    const id = result.structuredContent?.sessionId;
    const cpuUri = result.structuredContent?.cpuUri;
    if (typeof id !== "string" || typeof cpuUri !== "string") throw new Error("The plugin did not return a CPU session.");
    const session: Session = { id, abort: new AbortController() };
    if (epoch !== this.epoch || this.disposed) { await this.closeSession(session); return; }
    this.session = session;
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
        const combined = [...this.snapshot.samples, ...incoming];
        const latest = combined.at(-1)?.time ?? 0;
        const retained = combined.filter(sample => sample.time >= latest - CPU_HISTORY_SECONDS);
        const samples = retained.slice(-CPU_MAX_SAMPLES);
        const threadHistory = new Map<string, ThreadHistory>();
        for (const sample of samples) {
          for (const thread of sample.threads) {
            if (threadHistory.has(thread.id)) continue;
            let history = this.snapshot.threadHistory.get(thread.id);
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

  private closeSession(session: Session): Promise<void> {
    session.abort.abort();
    if (session.closing === undefined) session.closing = this.call("mobile_cpu_close", { sessionId: session.id }).then(() => {});
    if (this.session === session) this.session = undefined;
    return session.closing;
  }

  async stop() {
    this.epoch++;
    const session = this.session;
    const running = this.running;
    this.running = undefined;
    const previous = this.cleanup;
    const closing = session ? this.closeSession(session) : Promise.resolve();
    this.cleanup = Promise.all([previous, closing, running]).then(() => {});
    return this.cleanup;
  }

  async dispose() {
    this.disposed = true;
    this.discovery++;
    this.hide();
    await this.disconnect();
  }
}
