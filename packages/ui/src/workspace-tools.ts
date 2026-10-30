import { DeviceAppsStore } from "./device-apps.ts";
import type { DeviceLayout } from "./device-layout.ts";
import type { HostAttachmentsSource, HostBridge } from "./host-bridge.ts";
import { LogsPanel } from "./logs-panel.ts";
import { PanelContext } from "./model-context.ts";
import { PerformancePanel } from "./performance-panel.ts";
import { StoragePanel } from "./storage-panel.ts";
import { markUiSurfaceReady, setUiSurface } from "./telemetry.ts";
import { TraceSiftPanel } from "./tracesift-panel.ts";

export const toolNames = ["logs", "performance", "storage", "tracesift"] as const;
export type ToolName = typeof toolNames[number];
export const isToolName = (value: unknown): value is ToolName => toolNames.includes(value as ToolName);

type Panels = { context: PanelContext; deviceApps: DeviceAppsStore; logs: LogsPanel; performance: PerformancePanel; storage: StoragePanel; tracesift: TraceSiftPanel };

/** What the workspace shows: the visible device platforms and the selected tool. */
export type WorkspaceSnapshot = {
  layout: DeviceLayout;
  /** The user chose the layout, so layouts chosen for them no longer apply. */
  manual: boolean;
  tool: ToolName;
  /** The selected tool is open; a saved recording counts as the performance tool. */
  open: boolean;
  savedRecordingVisible: boolean;
};

/** The tool panels every host shows beside its devices; hosts only choose the selected tool and draw chrome. */
export class WorkspaceTools {
  readonly context: PanelContext;
  readonly deviceApps: DeviceAppsStore;
  readonly logs: LogsPanel;
  readonly performance: PerformancePanel;
  readonly storage: StoragePanel;
  readonly tracesift: TraceSiftPanel;
  private snapshot: WorkspaceSnapshot = { layout: "none", manual: false, tool: "logs", open: false, savedRecordingVisible: false };
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribePanels: (() => void)[];

  /** Builds the panels against one host; `attachments` reads a host's composer attachments, if it has them. */
  static create(host: HostBridge, attachments?: HostAttachmentsSource) {
    const context = new PanelContext(host, attachments);
    const deviceApps = new DeviceAppsStore(host, document);
    return new WorkspaceTools({
      context, deviceApps,
      logs: new LogsPanel(host, context, deviceApps),
      performance: new PerformancePanel(host, deviceApps),
      storage: new StoragePanel(host, deviceApps),
      tracesift: new TraceSiftPanel(host, attachments),
    });
  }

  constructor(panels: Panels) {
    ({ context: this.context, deviceApps: this.deviceApps, logs: this.logs, performance: this.performance, storage: this.storage, tracesift: this.tracesift } = panels);
    this.unsubscribePanels = toolNames.map(name => this[name].subscribe(() => this.update({})));
  }

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;

  private update(fields: Partial<WorkspaceSnapshot>) {
    const next = { ...this.snapshot, ...fields };
    next.open = next.savedRecordingVisible || this[next.tool].getSnapshot().open;
    const previous = this.snapshot;
    if ((Object.keys(next) as (keyof WorkspaceSnapshot)[]).every(key => next[key] === previous[key])) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }

  /**
   * Shows `layout`'s device platforms. A layout chosen for the user, such as after the
   * host opens a device, applies only until the user picks one.
   */
  setLayout(layout: DeviceLayout, { manual = false }: { manual?: boolean } = {}) {
    if (manual === false && this.snapshot.manual) return;
    this.update({ layout, manual: this.snapshot.manual || manual });
  }

  panel(name: ToolName) { return this[name]; }

  /** Shows one tool and hides the others, which keep their state. */
  show(name: ToolName) {
    const startedAt = globalThis.performance.now();
    setUiSurface(name);
    this.hide(name);
    this[name].show();
    this.update({ tool: name, savedRecordingVisible: false });
    markUiSurfaceReady(startedAt);
  }

  /** Closes `name` when it is the open tool, and shows it otherwise. */
  toggle(name: ToolName) {
    if (name === this.snapshot.tool && this.snapshot.open) this.close();
    else this.show(name);
  }

  /** Shows a saved recording in the performance tool's place and gives it the whole workspace. */
  showSavedRecording() {
    this.update({ tool: "performance", savedRecordingVisible: true });
    this.setLayout("none", { manual: true });
    this.hide();
  }

  /** Leaves a saved recording for live performance. */
  showLivePerformance() {
    this.update({ savedRecordingVisible: false });
    this.performance.show();
  }

  /** Hides every tool, or every tool except `except`, without stopping their work. */
  hide(except?: ToolName) {
    for (const name of toolNames) if (name !== except) this[name].hide();
  }

  /** Closes every tool: stops reading logs and live performance capture. */
  close() {
    setUiSurface("simulator");
    this.update({ savedRecordingVisible: false });
    if (this.logs.getSnapshot().open) this.logs.toggle();
    this.hide("logs");
    void this.performance.disconnect();
  }

  setAvailable(available: boolean) {
    for (const name of toolNames) this[name].setAvailable(available);
    this.deviceApps.setAvailable(available);
  }

  /** Applies a theme or host change to the panels that render host-dependent content. */
  hostChanged() {
    this.context.hostChanged();
    this.tracesift.hostChanged();
    this.context.resume();
  }

  async dispose() {
    for (const unsubscribe of this.unsubscribePanels) unsubscribe();
    this.deviceApps.dispose();
    this.storage.dispose();
    this.tracesift.dispose();
    await Promise.allSettled([this.logs.dispose(), this.performance.dispose()]);
  }
}
