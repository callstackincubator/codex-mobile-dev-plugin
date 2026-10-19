import type { App } from "@modelcontextprotocol/ext-apps";
import type { SimulatorDevice } from "../shared/protocol.ts";
import type { CrashWatchTarget, LogBatch, StackedLog } from "../shared/logs.ts";
import { isExpiredLogSession, logKey } from "../shared/logs.ts";
import type { PanelContext } from "./model-context.ts";
import { elementStores } from "./element-store.ts";
import { ReconnectLoop, StopReconnectError } from "./reconnect.ts";
import { captureUiError, countUiEvent } from "./telemetry.ts";

type Snapshot = {
  crash?: StackedLog; deviceName: string; expanded: boolean; reportPending: boolean;
  attaching: boolean; attached: boolean; sending: boolean; error: string;
  canAttach: boolean; canSendMessage: boolean;
};

function crashTarget(device?: SimulatorDevice): CrashWatchTarget | undefined {
  if (!device || device.state !== "Booted") return;
  if (device.platform === "android") return { platform: "android", deviceId: device.udid };
  // Physical iPhones keep crash reports on the device.
  if (device.kind === "physical") return;
  return { platform: "ios", deviceId: device.udid };
}

/** Watches the panel device for crashes, independent of the Logs tool. */
export class CrashMonitor {
  private app?: App;
  private context?: PanelContext;
  private unsubscribeContext = () => {};
  private targetKey = "";
  private readonly loop = new ReconnectLoop([1000, 2000, 5000, 10000, 30000]);
  private readonly listeners = new Set<() => void>();
  private readonly visibilityWaiters = new Set<() => void>();
  private reportTimer?: ReturnType<typeof setTimeout>;
  private snapshot: Snapshot = { deviceName: "", expanded: false, reportPending: false, attaching: false, attached: false, sending: false, error: "", canAttach: false, canSendMessage: false };

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  private update(value: Partial<Snapshot>) {
    const next = { ...this.snapshot, ...value };
    const context = this.context;
    next.canAttach = !!context?.canAttach;
    next.canSendMessage = !!context?.canSendMessage;
    next.attached = !!next.crash && context?.attachedKey === logKey(next.crash);
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }

  connect(app: App, context: PanelContext) {
    this.app = app; this.context = context;
    this.unsubscribeContext();
    this.unsubscribeContext = context.subscribe(() => this.update({}));
    document.addEventListener("visibilitychange", this.visibilityChanged);
  }

  /** Watch this device while the panel is visible and its tools are available. */
  configure(device: SimulatorDevice | undefined, enabled: boolean) {
    const target = enabled && this.app ? crashTarget(device) : undefined;
    const key = target ? `${target.platform}:${target.deviceId}` : "";
    if (key === this.targetKey) return;
    this.targetKey = key;
    this.loop.stop();
    if (target) {
      // Keep a crash across brief pauses, but not after switching to another device.
      const stale = this.snapshot.crash !== undefined && this.snapshot.crash.deviceId !== target.deviceId;
      if (stale) clearTimeout(this.reportTimer);
      this.update({ deviceName: device?.name ?? "", ...(stale ? { crash: undefined, expanded: false, reportPending: false, error: "" } : {}) });
      this.loop.start(signal => this.watch(target, signal), () => countUiEvent("ui.crash.watch_retry"), () => {});
    }
  }

  dismiss() {
    if (!this.snapshot.crash) return;
    countUiEvent("ui.crash.dismissed");
    clearTimeout(this.reportTimer);
    this.update({ crash: undefined, expanded: false, reportPending: false, error: "" });
  }
  toggleDetails() { this.update({ expanded: !this.snapshot.expanded }); }

  async attach() {
    const { crash, attaching } = this.snapshot;
    if (!crash || attaching || !this.context?.canAttach) return;
    this.update({ attaching: true, error: "" });
    try { await this.context.attach(crash); countUiEvent("ui.crash.attached"); }
    catch (error) { captureUiError(error, "crash.attach"); this.update({ error: error instanceof Error ? error.message : String(error) }); }
    finally { this.update({ attaching: false }); }
  }

  async sendToChat() {
    const { crash, sending } = this.snapshot;
    if (!crash || sending || !this.context?.canSendMessage) return;
    this.update({ sending: true, error: "" });
    try { await this.context.sendLogToChat(crash); countUiEvent("ui.crash.sent_to_chat"); }
    catch (error) { captureUiError(error, "crash.send_to_chat"); this.update({ error: error instanceof Error ? error.message : String(error) }); }
    finally { this.update({ sending: false }); }
  }

  dispose() {
    this.loop.stop();
    clearTimeout(this.reportTimer);
    this.targetKey = "";
    this.unsubscribeContext();
    document.removeEventListener("visibilitychange", this.visibilityChanged);
    this.visibilityChanged();
  }

  private show(crash: StackedLog) {
    const previous = this.snapshot.crash;
    // iOS reports a crash at exit, then again with the stack once its crash report is written.
    const sameProcess = previous !== undefined && crash.pid !== undefined && previous.pid === crash.pid && previous.appId === crash.appId;
    if (sameProcess && !crash.stack) return;
    clearTimeout(this.reportTimer);
    const reportPending = crash.origin === "ios" && !crash.stack;
    if (reportPending) {
      this.reportTimer = setTimeout(() => this.update({ reportPending: false }), 60000);
    }
    if (sameProcess) {
      countUiEvent("ui.crash.report_attached");
      const wasAttached = this.snapshot.attached;
      const merged = { ...crash, count: previous.count, lastTimestamp: previous.lastTimestamp };
      this.update({ crash: merged, reportPending, error: "" });
      // Swap an early attachment for the version with the stack.
      if (wasAttached) void this.attach();
      return;
    }
    countUiEvent("ui.crash.toast_shown");
    const repeated = previous !== undefined && previous.appId !== undefined && previous.appId === crash.appId;
    this.update({ crash: repeated ? { ...crash, count: previous.count + 1 } : crash, expanded: false, reportPending, error: "" });
  }

  private visibilityChanged = () => {
    if (document.visibilityState === "hidden") return;
    for (const resolve of this.visibilityWaiters) resolve();
    this.visibilityWaiters.clear();
  };

  // A hidden panel keeps its session alive so crashes buffer until it is visible again.
  private async waitUntilVisible(id: string, signal: AbortSignal) {
    while (document.visibilityState === "hidden" && !signal.aborted) {
      await new Promise<void>(resolve => {
        const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); this.visibilityWaiters.delete(done); resolve(); };
        const timer = setTimeout(done, 60000);
        this.visibilityWaiters.add(done);
        signal.addEventListener("abort", done, { once: true });
      });
      if (document.visibilityState === "hidden" && !signal.aborted) {
        await this.call({ name: "mobile_logs_keep_alive", arguments: { sessionId: id } }, { signal, timeout: 5000 });
      }
    }
  }

  private async call(...args: Parameters<App["callServerTool"]>) {
    const result = await this.app!.callServerTool(...args);
    if (result.isError) {
      const message = result.content.filter(item => item.type === "text").map(item => item.text).join("\n");
      // Expired sessions reopen through the retry loop; other failures wait for a new device.
      if (isExpiredLogSession(message)) throw new Error(message);
      throw new StopReconnectError(message);
    }
    return result;
  }

  private async watch(target: CrashWatchTarget, signal: AbortSignal) {
    const result = await this.call({ name: "mobile_crashes_session", arguments: { target } }, { signal, timeout: 15000 });
    const id = result._meta?.sessionId; const logsUri = result._meta?.logsUri;
    if (typeof id !== "string" || typeof logsUri !== "string") throw new StopReconnectError("The plugin did not return a crash session.");
    const uri = new URL(logsUri);
    let after = 0;
    try {
      while (!signal.aborted) {
        await this.waitUntilVisible(id, signal);
        if (signal.aborted) return;
        uri.searchParams.set("after", String(after));
        const resource = await this.app!.readServerResource({ uri: uri.href }, { signal, timeout: 30000 });
        const content = resource.contents.find(item => item.mimeType === "application/json" && "text" in item);
        if (!content || !("text" in content)) throw new Error("The plugin returned an invalid crash batch.");
        const batch = JSON.parse(content.text) as LogBatch;
        after = batch.cursor;
        this.loop.connected();
        let crash: LogBatch["entries"][number] | undefined;
        for (const entry of batch.entries) if (entry.kind === "crash") crash = entry;
        if (crash && !signal.aborted) this.show({ ...crash, count: 1, lastTimestamp: crash.timestamp });
      }
    } finally {
      void this.app!.callServerTool({ name: "mobile_logs_close", arguments: { sessionId: id } }, { timeout: 5000 }).catch(() => {});
    }
  }
}

const stores = elementStores(() => new CrashMonitor());
export const bindCrashMonitor = stores.bind;
export const getCrashMonitor = stores.get;
