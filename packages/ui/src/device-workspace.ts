import type { PanelTarget } from "@mobile-dev/shared/panel-target.ts";
import type { DeviceLayout } from "./device-layout.ts";
import type { HostBridge } from "./host-bridge.ts";
import { createSimulatorPanel } from "./simulator-panel.ts";
import { setUiTelemetryContext } from "./telemetry.ts";
import { WorkspaceDevices } from "./workspace-devices.ts";
import type { WorkspaceTools } from "./workspace-tools.ts";

type Platform = "ios" | "android";

/**
 * The iOS and Android device panels of one workspace, shared by every host.
 * The host renders `SimulatorView` for each of `panels`, and owns the chrome that
 * changes the layout.
 */
export class DeviceWorkspace {
  readonly panels: readonly [ReturnType<typeof createSimulatorPanel>, ReturnType<typeof createSimulatorPanel>];
  private readonly tools: Pick<WorkspaceTools, "context" | "deviceApps">;
  private readonly devices: WorkspaceDevices;
  private readonly connectionFailed: (error: unknown) => void;
  private activePlatform: Platform = "ios";

  constructor(app: HostBridge, tools: Pick<WorkspaceTools, "context" | "deviceApps">, options: {
    /** A layout chosen for the user, such as after the host opens a device. */
    onAutomaticLayout: (layout: DeviceLayout) => void;
    connectionFailed: (error: unknown) => void;
  }) {
    this.tools = tools;
    this.connectionFailed = options.connectionFailed;
    const create = (platform: Platform) => createSimulatorPanel(app, platform, tools.context, (_device, active) => {
      if (active) this.activePlatform = platform;
      this.updateSelection();
    });
    this.panels = [create("ios"), create("android")];
    this.devices = new WorkspaceDevices(this.panels, layout => {
      this.changeLayout(layout);
      options.onAutomaticLayout(layout);
    });
  }

  updateSelection() {
    const visible = this.panels.filter(panel => panel.visible);
    const active = visible.find(panel => panel.platform === this.activePlatform) ?? visible[0];
    const selected = active?.selected;
    setUiTelemetryContext({ device_platform: selected?.platform, device_kind: selected?.kind });
    this.tools.context.selectSimulators(visible.flatMap(panel => panel.selected ? [panel.selected] : []), selected);
    this.tools.deviceApps.selectDevice(selected);
    for (const panel of this.panels) panel.setActive(panel === active);
  }

  changeLayout(layout: DeviceLayout, manual = false) {
    if (manual) this.devices.selectLayout();
    setUiTelemetryContext({ layout });
    if (layout === "ios" || layout === "android") this.activePlatform = layout;
    for (const panel of this.panels) panel.setVisible(layout === "both" || layout === panel.platform);
    requestAnimationFrame(() => { for (const panel of this.panels) if (panel.visible) panel.fitScreen(); });
    this.updateSelection();
    if (manual) {
      for (const panel of this.panels) {
        if (panel.visible) void panel.resume().catch(this.connectionFailed);
      }
    }
  }

  /** Opens the devices a tool call or host intent names. */
  open(target: PanelTarget) { return this.devices.open(target); }
  setAvailable(available: boolean) { return this.devices.setAvailable(available); }
  notice(message: string) { for (const panel of this.panels) panel.notice(message); }
  /** Refits the screens and controls after the host's size or theme changes. */
  refit() { for (const panel of this.panels) { panel.fitScreen(); panel.controls(); } }

  async dispose() {
    this.devices.dispose();
    await Promise.allSettled(this.panels.map(panel => panel.dispose()));
  }
}
