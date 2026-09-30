import type { App } from "@modelcontextprotocol/ext-apps";
import type { SimulatorDevice } from "../shared/protocol.ts";
import type { LogBatch, LogOptions, MetroTarget } from "../shared/logs.ts";
import { LogList } from "./log-list.ts";
import type { PanelContext } from "./model-context.ts";
import { ReconnectLoop, StopReconnectError } from "./reconnect.ts";

type Call = App["callServerTool"];

export class LogsPanel {
  private simulator?: SimulatorDevice;
  private open = false;
  private paused = false;
  private openedForSplitLayout = false;
  private available = false;
  private epoch = 0;
  private readonly loop = new ReconnectLoop();
  private session?: { id: string; epoch: number; closing?: Promise<void> };
  private metroUrl?: string;
  readonly list: LogList;
  private readonly listeners = new Set<() => void>();
  private disposed = false;
  private discovery = 0;
  private snapshot = {
    open: false, paused: false, available: false, settings: false, discovering: false,
    status: "Closed", statusMessage: "", error: "", sourceNotice: "", selectedLabel: "Selected simulator",
    native: "ios", process: "", metroUrl: "http://127.0.0.1:8081", target: "",
    android: [] as { id: string; name: string }[], metro: [] as MetroTarget[],
  };

  private readonly app: App;
  constructor(app: App, context: PanelContext) { this.app = app; this.list = new LogList(context); }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  private update(value: Partial<typeof this.snapshot>) {
    this.snapshot = { ...this.snapshot, ...value };
    for (const listener of this.listeners) listener();
  }

  toggle() {
    this.open = !this.open;
    this.controls();
    if (this.open) this.restart(); else void this.stop();
  }
  show() { if (!this.open) this.toggle(); }
  toggleSettings() { this.update({ settings: !this.snapshot.settings }); }
  togglePause() { this.paused = !this.paused; this.controls(); if (this.paused) void this.stop(); else this.restart(); }
  configure(value: Partial<Pick<typeof this.snapshot, "native" | "process" | "metroUrl" | "target">>) {
    this.update(value);
    if (value.native !== undefined || value.target !== undefined) this.restart();
  }
  connect() { this.restart(); }
  setAvailable(available: boolean) { this.available = available; this.controls(); if (this.open) this.restart(); }
  setLayout(split: boolean) {
    document.documentElement.dataset.layout = split ? "split" : "stacked";
    if (split && !this.openedForSplitLayout) { this.openedForSplitLayout = true; this.show(); }
  }
  selectSimulator(simulator?: SimulatorDevice) {
    const changed = simulator?.udid !== this.simulator?.udid || simulator?.state !== this.simulator?.state;
    this.simulator = simulator;
    this.update({ selectedLabel: simulator ? `${simulator.platform === "android" ? "Android" : "iOS"} · ${simulator.name}` : "Selected simulator" });
    if (changed && this.open && this.snapshot.native === "ios") this.restart();
  }
  private controls() {
    this.update({ open: this.open, paused: this.paused, available: this.available,
      ...(!this.open ? { status: "Closed" } : this.paused ? { status: "Paused" } : {}) });
  }
  private error(message = "") { this.update({ error: message }); }

  private options(): LogOptions | undefined {
    const options: LogOptions = {};
    const { native, target, metroUrl } = this.snapshot;
    const process = this.snapshot.process.trim();
    if (native === "ios" && this.simulator?.state === "Booted") {
      options.native = this.simulator.platform === "android"
        ? { platform: "android", deviceId: this.simulator.udid, ...(process ? { packageName: process } : {}) }
        : { platform: "ios", deviceId: this.simulator.udid, ...(process ? { process } : {}) };
    } else if (native.startsWith("android:")) {
      options.native = { platform: "android", deviceId: native.slice(8), ...(process ? { packageName: process } : {}) };
    }
    if (target && this.metroUrl) {
      if (metroUrl !== this.metroUrl) throw new Error("Find sources again after changing the Metro URL.");
      options.metro = { url: this.metroUrl, targetId: target };
    }
    return options.native || options.metro ? options : undefined;
  }

  private restart() {
    void this.stop();
    this.controls();
    if (this.disposed || !this.open || this.paused || !this.available) return;
    this.error();
    let options: LogOptions | undefined;
    try { options = this.options(); } catch (error) { this.error(String(error)); return; }
    if (!options) { this.update({ status: "Choose a source" }); return; }
    this.list.clear();
    const epoch = this.epoch;
    this.update({ status: "Connecting..." });
    this.loop.start(signal => this.receive(options!, epoch, signal), error => {
      this.update({ status: "Reconnecting..." }); this.error(error instanceof Error ? error.message : String(error));
    }, error => { this.update({ status: "Stopped" }); this.error(String(error)); });
  }

  private async call(...args: Parameters<Call>) {
    const result = await this.app.callServerTool(...args);
    if (result.isError) throw new StopReconnectError(result.content.filter(item => item.type === "text").map(item => item.text).join("\n"));
    return result;
  }

  private async receive(options: LogOptions, epoch: number, signal: AbortSignal) {
    const result = await this.call({ name: "mobile_logs_session", arguments: { options } }, { timeout: 15000 });
    const id = result._meta?.sessionId; const logsUri = result._meta?.logsUri;
    if (typeof id !== "string" || typeof logsUri !== "string") throw new StopReconnectError("The plugin did not return a log session.");
    const session = { id, epoch };
    if (signal.aborted || epoch !== this.epoch) { await this.closeSession(session); return; }
    this.session = session;
    const uri = new URL(logsUri);
    let after = 0;
    try {
      while (!signal.aborted && epoch === this.epoch) {
        uri.searchParams.set("after", String(after));
        const resource = await this.app.readServerResource({ uri: uri.href }, { signal, timeout: 10000 });
        if (signal.aborted || epoch !== this.epoch) return;
        const content = resource.contents.find(item => item.mimeType === "application/json" && "text" in item);
        if (!content || !("text" in content)) throw new Error("The plugin returned an invalid log batch.");
        const batch = JSON.parse(content.text) as LogBatch;
        after = batch.cursor;
        this.loop.connected(); this.error();
        this.list.append(batch.entries, batch.dropped);
        this.update({ status: batch.statuses.map(status => `${status.source === "native" ? "Native" : "Metro"}: ${status.state}`).join(" · ") || "Connecting..." });
        const message = batch.statuses.map(status => status.message).filter(Boolean).join(" · ");
        this.update({ statusMessage: message });
        if (message) this.error(message);
      }
    } finally { await this.closeSession(session); }
  }

  private closeSession(session: NonNullable<LogsPanel["session"]>): Promise<void> {
    session.closing ??= this.call({ name: "mobile_logs_close", arguments: { sessionId: session.id } }, { timeout: 5000 }).then(() => {}, () => {});
    if (this.session === session) this.session = undefined;
    return session.closing;
  }

  async stop() { this.loop.stop(); this.epoch++; if (this.session) await this.closeSession(this.session); }
  async dispose() { this.disposed = true; this.discovery++; this.open = false; this.available = false; this.controls(); await this.stop(); }

  async discover() {
    if (!this.available || this.snapshot.discovering || this.disposed) return;
    const discovery = ++this.discovery;
    this.update({ discovering: true });
    const url = this.snapshot.metroUrl.trim();
    try {
      const result = await this.call({ name: "mobile_log_sources", arguments: url ? { metroUrl: url } : {} }, { timeout: 15000 });
      if (this.disposed || discovery !== this.discovery || url !== this.snapshot.metroUrl.trim()) return;
      const previousNative = this.snapshot.native;
      const previousTarget = this.snapshot.target;
      const data = result.structuredContent as { android: { id: string; name: string }[]; metro: MetroTarget[]; errors: string[] };
      const native = previousNative === "ios" || previousNative === "none" || data.android.some(device => `android:${device.id}` === previousNative) ? previousNative : "none";
      const target = this.metroUrl === url && data.metro.some(target => target.id === previousTarget) ? previousTarget : "";
      this.metroUrl = url;
      this.update({ android: data.android, metro: data.metro, native, target, metroUrl: url,
        sourceNotice: data.errors.join(" · ") || `Found ${data.android.length} Android devices and ${data.metro.length} Metro apps.` });
      this.restart();
    } catch (error) { if (!this.disposed) this.update({ sourceNotice: String(error) }); }
    finally { if (!this.disposed && discovery === this.discovery) this.update({ discovering: false }); }
  }
}
