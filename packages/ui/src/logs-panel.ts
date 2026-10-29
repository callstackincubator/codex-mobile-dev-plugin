import type { HostBridge } from "./host-bridge.ts";
import type { SimulatorDevice } from "@mobile-dev/shared/protocol.ts";
import { logBatchSchema } from "@mobile-dev/shared/logs.ts";
import type { LogBatch, LogOptions, MetroTarget, NativeLogTarget } from "@mobile-dev/shared/logs.ts";
import { logSessionResultSchema, logSourcesResultSchema } from "@mobile-dev/shared/tool-results.ts";
import { LogList } from "./log-list.ts";
import type { PanelContext } from "./model-context.ts";
import { ReconnectLoop, StopReconnectError } from "./reconnect.ts";
import type { DeviceAppsStore } from "./device-apps.ts";
import type { DeviceApp, ForegroundApp } from "@mobile-dev/shared/device-apps.ts";
import { composeAppLogQuery, quoteLogQueryValue } from "./log-query.ts";
import { countUiEvent } from "./telemetry.ts";
import { errorMessage } from "@mobile-dev/shared/error-reporting.ts";
import { isDeviceActive, isPhysicalIos, sameDevice } from "@mobile-dev/shared/devices.ts";
import { Store } from "./store.ts";
import { callTool, ToolCallError } from "./tool-call.ts";
import type { ToolCallOptions, ToolCallParams } from "./tool-call.ts";
import { openCursorSession } from "./resource-session.ts";
import type { ResourceSession } from "./resource-session.ts";

function expiredSession(error: unknown) {
  return error instanceof Error && error.message.includes("This log session expired or closed.");
}

const initialState = {
  open: false, paused: false, available: false, settings: false, discovering: false,
  status: "Closed", statusMessage: "", error: "", sourceNotice: "", selectedLabel: "Selected device", selectedPlatform: "ios",
  native: "ios", metroUrl: "http://127.0.0.1:8081", target: "",
  android: [] as { id: string; name: string }[], metro: [] as MetroTarget[],
  followApp: true, hideSystemLogs: true, foregroundApp: null as ForegroundApp | null, appDiscoveryError: "",
};
export type LogsPanelState = typeof initialState;

export class LogsPanel extends Store<LogsPanelState> {
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
  private session?: ResourceSession;
  private metroUrl?: string;
  readonly list: LogList;
  private disposed = false;
  private discovery = 0;
  private pendingAppChange = false;
  private pendingSourceChange = false;
  private appliedApps?: readonly DeviceApp[];
  private appliedForeground?: ForegroundApp | null;
  private appClause = "";
  private userQuery = "";
  private readonly deviceApps: DeviceAppsStore;
  private readonly unsubscribeApps: () => void;

  private readonly app: HostBridge;
  constructor(app: HostBridge, context: PanelContext, deviceApps: DeviceAppsStore) {
    super(initialState);
    this.app = app;
    this.list = new LogList(context);
    this.deviceApps = deviceApps;
    this.unsubscribeApps = deviceApps.subscribe(() => this.appsChanged());
    this.appsChanged();
  }

  toggle() {
    this.open = !this.open;
    this.controls();
    if (this.open) {
      this.restart();
    } else void this.stop();
  }
  show() {
    this.visible = true;
    if (this.open && this.pendingSourceChange) this.restart();
    else if (this.open && this.pendingAppChange) this.applyAppChange();
    for (const resolve of this.visibilityWaiters) resolve();
    if (this.open === false) this.toggle();
    else if (this.paused === false && this.loop.active === false) this.restart();
  }
  hide() { this.visible = false; this.reading?.abort(); }
  toggleSettings() { this.update({ settings: !this.state.settings }); }
  togglePause() { this.paused = !this.paused; this.controls(); if (this.paused) void this.stop(); else this.restart(); }
  configure(value: Partial<Pick<LogsPanelState, "native" | "metroUrl" | "target" | "followApp" | "hideSystemLogs">>) {
    const native = value.native ?? this.state.native;
    const followApp = native === "ios" ? value.followApp ?? this.state.followApp : false;
    const changedMode = followApp !== this.state.followApp;
    const changedSystemLogs = value.hideSystemLogs !== undefined && value.hideSystemLogs !== this.state.hideSystemLogs;
    this.update({ ...value, followApp });
    if (changedMode) {
      this.pendingAppChange = true;
      if (this.open && this.visible) this.applyAppChange();
    }
    if (changedSystemLogs || value.native !== undefined || value.target !== undefined) this.restart();
  }
  search(query: string) {
    const prefix = `${this.appClause} & (`;
    if (this.state.followApp && this.appClause && query === this.appClause) this.userQuery = "";
    else if (this.state.followApp && this.appClause && query.startsWith(prefix) && query.endsWith(")")) {
      this.userQuery = query.slice(prefix.length, -1);
    } else if (this.state.followApp && this.appClause && query.startsWith(`${this.appClause} `)) {
      const rest = query.slice(this.appClause.length);
      const suffix = rest.trimStart();
      if (suffix.startsWith("|")) {
        this.userQuery = query;
        this.appClause = "";
        this.update({ followApp: false });
      } else {
        const expression = suffix.startsWith("&") ? suffix.slice(1) : suffix;
        this.userQuery = expression.trimStart();
      }
    } else {
      this.userQuery = query;
      this.appClause = "";
      this.update({ followApp: false });
    }
    this.list.search(query);
  }
  connect() { this.restart(); }
  setAvailable(available: boolean) { this.available = available; this.controls(); if (this.open) this.restart(); }
  /** Opens the logs once, for pages that show tools beside the devices from the start. */
  openForSplitLayout() {
    if (!this.openedForSplitLayout) { this.openedForSplitLayout = true; this.show(); }
  }
  private appsChanged() {
    if (this.disposed) return;
    const source = this.deviceApps.getSnapshot();
    const simulator = source.device;
    const changed = !sameDevice(simulator, this.simulator);
    this.simulator = simulator;
    let foregroundApp = this.state.foregroundApp;
    if (source.ready) foregroundApp = source.foregroundApp;
    else if (changed || source.error) foregroundApp = null;
    const previous = this.state.foregroundApp;
    const appChanged = foregroundApp?.pid !== previous?.pid || foregroundApp?.bundleId !== previous?.bundleId;
    this.update({ foregroundApp, appDiscoveryError: source.error,
      selectedPlatform: simulator?.platform ?? "ios",
      selectedLabel: simulator ? `${simulator.platform === "android" ? "Android" : "iOS"} · ${simulator.name}` : "Selected device" });
    if (this.state.native !== "ios") return;
    if (changed) this.pendingSourceChange = true;
    if (changed || appChanged || source.apps !== this.appliedApps) {
      this.pendingAppChange = true;
      if (this.visible && this.open) {
        if (this.pendingSourceChange) this.restart();
        else this.applyAppChange();
      }
    }
  }
  private applyAppChange() {
    const source = this.deviceApps.getSnapshot();
    const selected = this.state.native === "ios";
    const apps = selected ? source.apps : [];
    const foreground = selected ? this.state.foregroundApp : null;
    this.list.setApps(apps, foreground);
    this.appliedApps = source.apps;
    let clause = "";
    if (this.state.followApp && selected && foreground) {
      if (foreground.bundleId) {
        const bundleId = quoteLogQueryValue(foreground.bundleId);
        clause = `app:${bundleId}`;
      } else if (foreground.pid != null) clause = `pid:${foreground.pid}`;
    }
    if (clause && (clause !== this.appClause || foreground?.pid !== this.appliedForeground?.pid)) countUiEvent("ui.logs.foreground_change");
    this.appliedForeground = foreground;
    this.appClause = clause;
    const query = composeAppLogQuery(clause, this.userQuery);
    const current = this.list.getSnapshot();
    if (query !== current.query) this.list.search(query);
    this.pendingAppChange = false;
  }
  private controls() {
    this.update({ open: this.open, paused: this.paused, available: this.available,
      ...(!this.open ? { status: "Closed" } : this.paused ? { status: "Paused" } : {}) });
  }
  private error(message = "") { this.update({ error: message }); }

  private options(): LogOptions | undefined {
    const options: LogOptions = {};
    const { native, target, metroUrl } = this.state;
    const selected = this.simulator;
    if (native === "ios" && selected && isDeviceActive(selected)) {
      if (selected.platform === "android") {
        options.native = { platform: "android", deviceId: selected.udid };
      } else {
        const nativeTarget: NativeLogTarget = isPhysicalIos(selected)
          ? { platform: "ios", deviceId: selected.udid, kind: "physical" }
          : { platform: "ios", deviceId: selected.udid };
        nativeTarget.hideSystemLogs = this.state.hideSystemLogs;
        options.native = nativeTarget;
      }
    } else if (native.startsWith("android:")) {
      options.native = { platform: "android", deviceId: native.slice(8) };
    }
    if (target && this.metroUrl) {
      if (metroUrl !== this.metroUrl) throw new Error("Find sources again after changing the Metro URL.");
      options.metro = { url: this.metroUrl, targetId: target };
    }
    return options.native || options.metro ? options : undefined;
  }

  private restart() {
    if (this.open && this.visible === false) { this.pendingSourceChange = true; return; }
    void this.stop();
    this.controls();
    if (this.disposed || !this.open) return;
    if (this.available === false) {
      if (this.pendingAppChange) this.applyAppChange();
      return;
    }
    this.pendingSourceChange = false;
    this.appliedForeground = null;
    this.list.clear();
    this.applyAppChange();
    if (this.paused) return;
    this.error();
    let options: LogOptions | undefined;
    try { options = this.options(); } catch (error) { this.error(String(error)); return; }
    if (!options) {
      this.update({ status: "Choose a source" });
      return;
    }
    const epoch = this.epoch;
    this.update({ status: "Connecting..." });
    this.loop.start(signal => this.receive(options!, epoch, signal), error => {
      this.update({ status: "Reconnecting..." });
      if (expiredSession(error)) {
        countUiEvent("ui.logs.session_expired");
        this.error();
      } else this.error(errorMessage(error));
    }, error => { this.update({ status: "Stopped" }); this.error(String(error)); });
  }

  // A failed log tool stops reconnecting, except a keep-alive for an expired session, which reopens it.
  private async call(params: ToolCallParams, options: ToolCallOptions) {
    try { return await callTool(this.app, params, options); }
    catch (error) {
      if (!(error instanceof ToolCallError) || (params.name === "mobile_logs_keep_alive" && expiredSession(error))) throw error;
      throw new StopReconnectError(error.message);
    }
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
    const active = () => epoch === this.epoch;
    let id = "";
    await openCursorSession({
      app: this.app,
      open: async () => {
        const result = await this.call({ name: "mobile_logs_session", arguments: { options } }, { timeout: 15000 });
        const session = logSessionResultSchema.safeParse(result._meta);
        if (!session.success) throw new StopReconnectError("The plugin did not return a log session.");
        return { id: session.data.sessionId, uri: session.data.logsUri };
      },
      close: sessionId => this.call({ name: "mobile_logs_close", arguments: { sessionId } }, { timeout: 5000 }),
      closePolicy: "ignore",
      signal,
      opened: session => {
        if (signal.aborted || !active()) return false;
        this.session = session;
        id = session.id;
      },
      active,
      // A hidden panel keeps its session alive without reading; hiding drops the read in flight.
      beforeRead: async () => {
        await this.waitUntilVisible(id, signal);
        const reading = new AbortController();
        this.reading = reading;
        return reading.signal;
      },
      schema: logBatchSchema,
      invalid: () => new Error("The plugin returned an invalid log batch."),
      cursor: batch => batch.cursor,
      timeout: 10000,
      onBatch: batch => this.accept(batch),
    });
  }

  private accept(batch: LogBatch) {
    this.loop.connected(); this.error();
    this.list.append(batch.entries, batch.dropped);
    this.update({ status: batch.statuses.map(status => `${status.source === "native" ? "Native" : "Metro"}: ${status.state}`).join(" · ") || "Connecting..." });
    const message = batch.statuses.map(status => status.message).filter(Boolean).join(" · ");
    this.update({ statusMessage: message });
    if (message) this.error(message);
  }

  async stop() {
    this.loop.stop(); this.epoch++;
    const session = this.session;
    this.session = undefined;
    await session?.close();
  }
  async dispose() { this.disposed = true; this.unsubscribeApps(); this.discovery++; this.open = false; this.available = false; this.controls(); this.close(); await this.stop(); }

  async discover() {
    if (!this.available || this.state.discovering || this.disposed) return;
    const discovery = ++this.discovery;
    this.update({ discovering: true });
    const url = this.state.metroUrl.trim();
    try {
      const result = await this.call({ name: "mobile_log_sources", arguments: url ? { metroUrl: url } : {} }, { timeout: 15000 });
      if (this.disposed || discovery !== this.discovery || url !== this.state.metroUrl.trim()) return;
      const previousNative = this.state.native;
      const previousTarget = this.state.target;
      const sources = logSourcesResultSchema.safeParse(result.structuredContent);
      if (!sources.success) throw new Error("The plugin returned invalid log sources.");
      const data = sources.data;
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
