import type { App } from "@modelcontextprotocol/ext-apps";
import type { SimulatorDevice } from "../shared/protocol.ts";
import type { LogBatch, LogOptions, MetroTarget } from "../shared/logs.ts";
import { LogList } from "./log-list.ts";
import type { PanelContext } from "./model-context.ts";
import { ReconnectLoop, StopReconnectError } from "./reconnect.ts";

function element<T extends HTMLElement = HTMLElement>(id: string): T { return document.getElementById(id) as T; }
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
  private readonly list: LogList;
  private readonly native = element<HTMLSelectElement>("logs-native");
  private readonly target = element<HTMLSelectElement>("logs-metro-target");
  private readonly app: App;

  constructor(app: App, context: PanelContext) {
    this.app = app;
    this.list = new LogList(context);
    element("logs-toggle").addEventListener("click", () => { this.open = !this.open; this.controls(); if (this.open) this.restart(); else void this.stop(); });
    element("logs-settings-toggle").addEventListener("click", () => {
      const settings = element("logs-settings"); settings.hidden = !settings.hidden;
      element("logs-settings-toggle").setAttribute("aria-expanded", String(!settings.hidden));
    });
    element("logs-discover").addEventListener("click", () => { void this.discover(); });
    element("logs-apply").addEventListener("click", () => this.restart());
    element("logs-clear").addEventListener("click", () => this.list.clear());
    element("logs-pause").addEventListener("click", () => { this.paused = !this.paused; this.controls(); if (this.paused) void this.stop(); else this.restart(); });
    this.native.addEventListener("change", () => this.restart());
    this.target.addEventListener("change", () => this.restart());
  }

  show() {
    if (this.open) return;
    this.open = true;
    this.controls();
    this.restart();
  }

  setAvailable(available: boolean) { this.available = available; this.controls(); if (this.open) this.restart(); }
  setLayout(split: boolean) {
    document.documentElement.dataset.layout = split ? "split" : "stacked";
    if (split && !this.openedForSplitLayout) {
      this.openedForSplitLayout = true;
      this.open = true;
      this.restart();
    }
  }
  selectSimulator(simulator?: SimulatorDevice) {
    const changed = simulator?.udid !== this.simulator?.udid || simulator?.state !== this.simulator?.state;
    this.simulator = simulator;
    this.native.options[0].textContent = simulator ? `iOS · ${simulator.name}` : "Selected simulator";
    if (changed && this.open && this.native.value === "ios") this.restart();
  }

  private controls() {
    element("logs-drawer").dataset.open = String(this.open);
    element("logs-toggle").setAttribute("aria-expanded", String(this.open));
    element("logs-body").hidden = !this.open;
    for (const id of ["logs-pause", "logs-clear", "logs-settings-toggle"]) element(id).hidden = !this.open;
    element("logs-pause").textContent = this.paused ? "Resume" : "Pause";
    element<HTMLButtonElement>("logs-apply").disabled = !this.available;
    element<HTMLButtonElement>("logs-discover").disabled = !this.available;
    element<HTMLInputElement>("logs-process").placeholder = this.native.value.startsWith("android:") ? "com.example.app · empty for all" : "Executable name · empty for all";
    if (!this.open) element("logs-status").textContent = "Closed";
    else if (this.paused) element("logs-status").textContent = "Paused";
  }

  private error(message = "") { element("logs-error").textContent = message; element("logs-error").hidden = !message; }

  private options(): LogOptions | undefined {
    const options: LogOptions = {};
    const process = element<HTMLInputElement>("logs-process").value.trim();
    if (this.native.value === "ios" && this.simulator?.state === "Booted") {
      options.native = { platform: "ios", deviceId: this.simulator.udid, ...(process ? { process } : {}) };
    } else if (this.native.value.startsWith("android:")) {
      options.native = { platform: "android", deviceId: this.native.value.slice(8), ...(process ? { packageName: process } : {}) };
    }
    if (this.target.value && this.metroUrl) {
      if (element<HTMLInputElement>("logs-metro-url").value !== this.metroUrl) throw new Error("Find sources again after changing the Metro URL.");
      options.metro = { url: this.metroUrl, targetId: this.target.value };
    }
    return options.native || options.metro ? options : undefined;
  }

  private restart() {
    void this.stop();
    this.controls();
    if (!this.open || this.paused || !this.available) return;
    this.error();
    let options: LogOptions | undefined;
    try { options = this.options(); } catch (error) { this.error(String(error)); return; }
    if (!options) { element("logs-status").textContent = "Choose a source"; return; }
    this.list.clear();
    const epoch = this.epoch;
    element("logs-status").textContent = "Connecting…";
    this.loop.start(signal => this.receive(options!, epoch, signal), error => {
      element("logs-status").textContent = "Reconnecting…"; this.error(error instanceof Error ? error.message : String(error));
    }, error => { element("logs-status").textContent = "Stopped"; this.error(String(error)); });
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
        element("logs-status").textContent = batch.statuses.map(status => `${status.source === "native" ? "Native" : "Metro"}: ${status.state}`).join(" · ") || "Connecting…";
        const message = batch.statuses.map(status => status.message).filter(Boolean).join(" · ");
        element("logs-status").title = message;
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
  async dispose() { this.open = false; this.available = false; this.controls(); await this.stop(); }

  private async discover() {
    const button = element<HTMLButtonElement>("logs-discover"); button.disabled = true;
    const url = element<HTMLInputElement>("logs-metro-url").value.trim();
    try {
      const result = await this.call({ name: "mobile_log_sources", arguments: url ? { metroUrl: url } : {} }, { timeout: 15000 });
      const data = result.structuredContent as { android: { id: string; name: string }[]; metro: MetroTarget[]; errors: string[] };
      const previousNative = this.native.value; const previousTarget = this.target.value;
      for (const option of [...this.native.options].slice(2)) option.remove();
      for (const device of data.android) this.native.add(new Option(`Android · ${device.name}`, `android:${device.id}`));
      this.native.value = [...this.native.options].some(option => option.value === previousNative) ? previousNative : "none";
      this.target.replaceChildren(new Option("None", ""));
      for (const target of data.metro) this.target.add(new Option(`${target.appId ?? target.title}${target.deviceName ? ` · ${target.deviceName}` : ""} · ${target.id}`, target.id));
      if (this.metroUrl === url && data.metro.some(target => target.id === previousTarget)) this.target.value = previousTarget;
      this.metroUrl = url;
      element("logs-source-notice").textContent = data.errors.join(" · ") || `Found ${data.android.length} Android devices and ${data.metro.length} Metro apps.`;
      this.restart();
    } catch (error) { element("logs-source-notice").textContent = String(error); }
    finally { button.disabled = false; }
  }
}
