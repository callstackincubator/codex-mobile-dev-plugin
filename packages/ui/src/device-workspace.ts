import type { PanelTarget } from "@mobile-dev/shared/panel-target.ts";
import type { DeviceLayout } from "./device-layout.ts";
import type { HostBridge } from "./host-bridge.ts";
import { createSimulatorPanel } from "./simulator-panel.ts";
import { setUiTelemetryContext } from "./telemetry.ts";
import { WorkspaceDevices } from "./workspace-devices.ts";
import type { WorkspaceTools } from "./workspace-tools.ts";

type Platform = "ios" | "android";

const showsPlatform = (layout: DeviceLayout, platform: Platform) => layout === "both" || layout === platform;

/**
 * The iOS and Android device panels of one workspace, shared by every host.
 * The host renders `SimulatorView` for each of `panels`. The layout lives in
 * `WorkspaceTools`, whose snapshot the host's chrome renders; this applies it to
 * the device panels and chooses layouts for the user.
 */
export class DeviceWorkspace {
  readonly panels: readonly [ReturnType<typeof createSimulatorPanel>, ReturnType<typeof createSimulatorPanel>];
  private readonly tools: Pick<WorkspaceTools, "context" | "deviceApps" | "subscribe" | "getSnapshot" | "setLayout">;
  private readonly devices: WorkspaceDevices;
  private readonly connectionFailed: (error: unknown) => void;
  private readonly unsubscribe: () => void;
  private activePlatform: Platform = "ios";
  private layout: DeviceLayout;
  private manual: boolean;

  constructor(app: HostBridge, tools: Pick<WorkspaceTools, "context" | "deviceApps" | "subscribe" | "getSnapshot" | "setLayout">, options: {
    connectionFailed: (error: unknown) => void;
  }) {
    this.tools = tools;
    this.connectionFailed = options.connectionFailed;
    const create = (platform: Platform) => createSimulatorPanel(app, platform, tools, (_device, active) => {
      if (active) this.activePlatform = platform;
      this.updateSelection();
    });
    this.panels = [create("ios"), create("android")];
    this.devices = new WorkspaceDevices(this.panels, layout => tools.setLayout(layout));
    ({ layout: this.layout, manual: this.manual } = tools.getSnapshot());
    this.unsubscribe = tools.subscribe(() => this.layoutChanged());
    this.applyLayout(false);
  }

  private layoutChanged() {
    const { layout, manual } = this.tools.getSnapshot();
    if (layout === this.layout && manual === this.manual) return;
    const chosen = manual && !this.manual;
    this.layout = layout;
    this.manual = manual;
    if (chosen) this.devices.selectLayout();
    this.applyLayout(manual);
  }

  private visiblePanels() { return this.panels.filter(panel => showsPlatform(this.layout, panel.platform)); }

  updateSelection() {
    const visible = this.visiblePanels();
    const active = visible.find(panel => panel.platform === this.activePlatform) ?? visible[0];
    const selected = active?.selected;
    setUiTelemetryContext({ device_platform: selected?.platform, device_kind: selected?.kind });
    this.tools.context.selectSimulators(visible.flatMap(panel => panel.selected ? [panel.selected] : []), selected);
    this.tools.deviceApps.selectDevice(selected);
    for (const panel of this.panels) panel.setActive(panel === active);
  }

  // `SimulatorView` renders each panel's `hidden` from the same layout.
  private applyLayout(manual: boolean) {
    const layout = this.layout;
    setUiTelemetryContext({ layout });
    if (layout === "ios" || layout === "android") this.activePlatform = layout;
    // Only a shown panel polls for devices.
    for (const panel of this.panels) panel.setVisible(showsPlatform(layout, panel.platform));
    requestAnimationFrame(() => { for (const panel of this.visiblePanels()) panel.fitScreen(); });
    this.updateSelection();
    if (manual) {
      for (const panel of this.visiblePanels()) void panel.resume().catch(this.connectionFailed);
    }
  }

  /** Opens the devices a tool call or host intent names. */
  open(target: PanelTarget) { return this.devices.open(target); }
  setAvailable(available: boolean) { return this.devices.setAvailable(available); }
  notice(message: string) { for (const panel of this.panels) panel.notice(message); }
  /** Refits the screens and controls after the host's size or theme changes. */
  refit() { for (const panel of this.panels) { panel.fitScreen(); panel.controls(); } }

  async dispose() {
    this.unsubscribe();
    this.devices.dispose();
    await Promise.allSettled(this.panels.map(panel => panel.dispose()));
  }
}
