import type { App } from "@modelcontextprotocol/ext-apps";
import type { SimulatorDevice } from "../shared/protocol.ts";
import type { LogBatch, LogOptions, MetroTarget, NativeLogTarget } from "../shared/logs.ts";
import { LogList } from "./log-list.ts";
import type { PanelContext } from "./model-context.ts";
import { ReconnectLoop, StopReconnectError } from "./reconnect.ts";
import type { DeviceAppsStore } from "./device-apps.ts";
import type { ForegroundApp } from "../shared/device-apps.ts";
import { countUiEvent } from "./telemetry.ts";

type Call = App["callServerTool"];

export class LogsPanel {
  private simulator?: SimulatorDevice;
  private open = false;
  private visible = true;
  private reading?: AbortController;
  private readonly visibilityWaiters = new Set<() => void>();
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
  private pendingAppChange = false;
  private readonly deviceApps: DeviceAppsStore;
  private readonly unsubscribeApps: () => void;
  private snapshot = {
    open: false, paused: false, available: false, settings: false, discovering: false,
    status: "Closed", statusMessage: "", error: "", sourceNotice: "", selectedLabel: "Selected device", selectedPlatform: "ios",
    native: "ios", process: "", metroUrl: "http://127.0.0.1:8081", target: "",
    android: [] as { id: string; name: string }[], metro: [] as MetroTarget[],
    followApp: true, hideSystemLogs: true, foregroundApp: null as ForegroundApp | null, appDiscoveryError: "",
  };

  private readonly app: App;
  constructor(app: App, context: PanelContext, deviceApps: DeviceAppsStore) {
    this.app = app;
    this.list = new LogList(context);
    this.deviceApps = deviceApps;
    this.unsubscribeApps = deviceApps.subscribe(() => this.appsChanged());
    this.appsChanged();
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  private update(value: Partial<typeof this.snapshot>) {
    this.snapshot = { ...this.snapshot, ...value };
    for (const listener of this.listeners) listener();
  }

  toggle() {
    this.open = !this.open;
    this.controls();
    if (this.open) {
      if (this.pendingAppChange) this.applyAppChange();
      else this.restart();
    } else void this.stop();
  }
  show() {
    this.visible = true;
    if (this.pendingAppChange && this.open) this.applyAppChange();
    for (const resolve of this.visibilityWaiters) resolve();
    if (this.open === false) this.toggle();
    else if (this.paused === false && this.loop.active === false) this.restart();
  }
  hide() { this.visible = false; this.reading?.abort(); }
  toggleSettings() { this.update({ settings: !this.snapshot.settings }); }
  togglePause() { this.paused = !this.paused; this.controls(); if (this.paused) void this.stop(); else this.restart(); }
  configure(value: Partial<Pick<typeof this.snapshot, "native" | "process" | "metroUrl" | "target" | "followApp" | "hideSystemLogs">>) {
    const native = value.native ?? this.snapshot.native;
    const manual = value.process !== undefined || native !== "ios";
    const followApp = manual ? false : value.followApp ?? this.snapshot.followApp;
    const changedMode = followApp !== this.snapshot.followApp;
    const changedSystemLogs = value.hideSystemLogs !== undefined && value.hideSystemLogs !== this.snapshot.hideSystemLogs;
    this.update({ ...value, followApp });
    if (changedMode || changedSystemLogs || value.native !== undefined || value.target !== undefined) this.restart();
  }
  connect() { this.restart(); }
  setAvailable(available: boolean) { this.available = available; this.controls(); if (this.open) this.restart(); }
  setLayout(split: boolean) {
    document.documentElement.dataset.layout = split ? "split" : "stacked";
    if (split && !this.openedForSplitLayout) { this.openedForSplitLayout = true; this.show(); }
  }
  private appsChanged() {
    if (this.disposed) return;
    const source = this.deviceApps.getSnapshot();
    const simulator = source.device;
    const changed = simulator?.udid !== this.simulator?.udid || simulator?.state !== this.simulator?.state
      || simulator?.kind !== this.simulator?.kind || simulator?.platform !== this.simulator?.platform;
    this.simulator = simulator;
    let foregroundApp = this.snapshot.foregroundApp;
    if (source.ready) foregroundApp = source.foregroundApp;
    else if (changed || source.error) foregroundApp = null;
    const previous = this.snapshot.foregroundApp;
    const appChanged = foregroundApp?.pid !== previous?.pid || foregroundApp?.bundleId !== previous?.bundleId;
    this.update({ foregroundApp, appDiscoveryError: source.error,
      selectedPlatform: simulator?.platform ?? "ios",
      selectedLabel: simulator ? `${simulator.platform === "android" ? "Android" : "iOS"} · ${simulator.name}` : "Selected device" });
    if (this.snapshot.native !== "ios") return;
    if (changed || (this.snapshot.followApp && appChanged)) {
      this.pendingAppChange = true;
      if (this.visible && this.open) this.applyAppChange();
    }
  }
  private applyAppChange() {
    if (this.snapshot.followApp && this.snapshot.foregroundApp) countUiEvent("ui.logs.foreground_change");
    this.restart();
  }
  private controls() {
    this.update({ open: this.open, paused: this.paused, available: this.available,
      ...(!this.open ? { status: "Closed" } : this.paused ? { status: "Paused" } : {}) });
  }
  private error(message = "") { this.update({ error: message }); }

  private options(): LogOptions | undefined {
    const options: LogOptions = {};
    const { native, target, metroUrl, followApp, foregroundApp } = this.snapshot;
    const process = this.snapshot.process.trim();
    const selected = this.simulator;
    const physicalIos = selected?.kind === "physical" && selected.platform === "ios";
    const ready = physicalIos ? selected.state === "connected" : selected?.state === "Booted";
    if (followApp && native === "ios" && foregroundApp === null) return;
    if (native === "ios" && selected && ready) {
      if (selected.platform === "android") {
        const packageName = followApp ? foregroundApp?.bundleId : process;
        if (followApp && !packageName) return;
        options.native = { platform: "android", deviceId: selected.udid, ...(packageName ? { packageName } : {}) };
      } else {
        const pid = foregroundApp?.pid;
        if (followApp && pid == null) return;
        const nativeTarget: NativeLogTarget = physicalIos
          ? { platform: "ios", deviceId: selected.udid, kind: "physical" }
          : { platform: "ios", deviceId: selected.udid };
        if (followApp && pid != null) nativeTarget.pid = pid;
        else if (process) nativeTarget.process = process;
        nativeTarget.hideSystemLogs = this.snapshot.hideSystemLogs;
        options.native = nativeTarget;
      }
    } else if (native.startsWith("android:")) {
      options.native = { platform: "android", deviceId: native.slice(8), ...(process ? { packageName: process } : {}) };
    }
    if (target && this.metroUrl) {
      if (metroUrl !== this.metroUrl) throw new Error("Find sources again after changing the Metro URL.");
      const metro = this.snapshot.metro.find(candidate => candidate.id === target);
      if (followApp === false || (foregroundApp?.bundleId && metro?.appId === foregroundApp.bundleId)) {
        options.metro = { url: this.metroUrl, targetId: target };
      }
    }
    return options.native || options.metro ? options : undefined;
  }

  private restart() {
    if (this.open && this.visible === false) { this.pendingAppChange = true; return; }
    void this.stop();
    this.controls();
    if (this.disposed || !this.open || !this.available) return;
    this.pendingAppChange = false;
    this.list.clear();
    if (this.paused) return;
    this.error();
    let options: LogOptions | undefined;
    try { options = this.options(); } catch (error) { this.error(String(error)); return; }
    if (!options) {
      const status = this.snapshot.followApp && this.snapshot.native === "ios" ? "Waiting for foreground app" : "Choose a source";
      this.update({ status });
      return;
    }
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

  private async waitUntilVisible(id: string, signal: AbortSignal) {
    while (this.visible === false && signal.aborted === false) {
      await new Promise<void>(resolve => {
        const done = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", done);
          this.visibilityWaiters.delete(done);
          resolve();
        };
        const timer = setTimeout(done, 60000);
        this.visibilityWaiters.add(done);
        signal.addEventListener("abort", done, { once: true });
        if (signal.aborted) done();
      });
      if (this.visible === false && signal.aborted === false) {
        await this.call({ name: "mobile_logs_keep_alive", arguments: { sessionId: id } }, { signal, timeout: 5000 });
      }
    }
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
        await this.waitUntilVisible(id, signal);
        if (signal.aborted || epoch !== this.epoch) return;
        uri.searchParams.set("after", String(after));
        const reading = new AbortController();
        this.reading = reading;
        const readSignal = AbortSignal.any([signal, reading.signal]);
        let resource: Awaited<ReturnType<App["readServerResource"]>>;
        try {
          resource = await this.app.readServerResource({ uri: uri.href }, { signal: readSignal, timeout: 10000 });
        } catch (error) {
          if (signal.aborted === false && reading.signal.aborted) continue;
          throw error;
        } finally {
          if (this.reading === reading) this.reading = undefined;
        }
        if (signal.aborted || epoch !== this.epoch) return;
        if (this.visible === false || reading.signal.aborted) continue;
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
  async dispose() { this.disposed = true; this.unsubscribeApps(); this.discovery++; this.open = false; this.available = false; this.controls(); await this.stop(); }

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
