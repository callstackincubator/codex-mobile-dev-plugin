import { AppFlowPanel } from "./app-flow-panel.ts";
import { DeviceAppsStore } from "./device-apps.ts";
import type { HostAttachmentsSource, HostBridge } from "./host-bridge.ts";
import { LogsPanel } from "./logs-panel.ts";
import { PanelContext } from "./model-context.ts";
import { PerformancePanel } from "./performance-panel.ts";
import { StoragePanel } from "./storage-panel.ts";
import { markUiSurfaceReady, setUiSurface } from "./telemetry.ts";
import { TraceSiftPanel } from "./tracesift-panel.ts";
import { AppIntelligencePanel } from "./app-intelligence-panel.ts";

export const toolNames = ["logs", "performance", "storage", "app-intel", "tracesift", "app-flow"] as const;
export type ToolName = typeof toolNames[number];
export const isToolName = (value: unknown): value is ToolName => toolNames.includes(value as ToolName);

type Panels = { context: PanelContext; deviceApps: DeviceAppsStore; logs: LogsPanel; performance: PerformancePanel; storage: StoragePanel; "app-intel": AppIntelligencePanel; tracesift: TraceSiftPanel; "app-flow": AppFlowPanel };

/** The tool panels every host shows beside its devices; hosts only choose the selected tool and draw chrome. */
export class WorkspaceTools {
  readonly context: PanelContext;
  readonly deviceApps: DeviceAppsStore;
  readonly logs: LogsPanel;
  readonly performance: PerformancePanel;
  readonly storage: StoragePanel;
  readonly "app-intel": AppIntelligencePanel;
  readonly tracesift: TraceSiftPanel;
  readonly "app-flow": AppFlowPanel;

  /** Builds the panels against one host; `attachments` reads a host's composer attachments, if it has them. */
  static create(host: HostBridge, attachments?: HostAttachmentsSource) {
    const context = new PanelContext(host, attachments);
    const deviceApps = new DeviceAppsStore(host, document);
    return new WorkspaceTools({
      context, deviceApps,
      logs: new LogsPanel(host, context, deviceApps),
      performance: new PerformancePanel(host, deviceApps),
      storage: new StoragePanel(host, deviceApps),
      "app-intel": new AppIntelligencePanel(host),
      tracesift: new TraceSiftPanel(host, attachments),
      "app-flow": new AppFlowPanel(host),
    });
  }

  constructor(panels: Panels) {
    ({ context: this.context, deviceApps: this.deviceApps, logs: this.logs, performance: this.performance, storage: this.storage, "app-intel": this["app-intel"], tracesift: this.tracesift, "app-flow": this["app-flow"] } = panels);
  }

  panel(name: ToolName) { return this[name]; }

  /** Shows one tool and hides the others, which keep their state. */
  show(name: ToolName) {
    const startedAt = globalThis.performance.now();
    setUiSurface(name);
    this.hide(name);
    this[name].show();
    markUiSurfaceReady(startedAt);
  }

  /** Hides every tool, or every tool except `except`, without stopping their work. */
  hide(except?: ToolName) {
    for (const name of toolNames) if (name !== except) this[name].hide();
  }

  /** Closes every tool: stops reading logs and live performance capture. */
  close() {
    setUiSurface("simulator");
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
    this.deviceApps.dispose();
    this.storage.dispose();
    this.tracesift.dispose();
    this["app-intel"].dispose();
    await Promise.allSettled([this.logs.dispose(), this.performance.dispose(), this["app-flow"].dispose()]);
  }
}
