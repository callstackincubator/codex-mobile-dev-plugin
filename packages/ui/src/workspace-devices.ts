import { panelTargetPlatform } from "@mobile-dev/shared/panel-target.ts";
import type { PanelTarget } from "@mobile-dev/shared/panel-target.ts";
import { activeDeviceLayout } from "./device-layout.ts";
import type { DeviceLayout } from "./device-layout.ts";
import type { createSimulatorPanel } from "./simulator-panel.ts";

type SimulatorPanel = ReturnType<typeof createSimulatorPanel>;

export class WorkspaceDevices {
  private readonly panels: readonly [SimulatorPanel, SimulatorPanel];
  private readonly onLayout: (layout: DeviceLayout) => void;
  private target?: PanelTarget;
  private available = false;
  private loading?: Promise<void>;
  private disposed = false;
  private manualLayout = false;

  constructor(panels: readonly [SimulatorPanel, SimulatorPanel], onLayout: (layout: DeviceLayout) => void) {
    this.panels = panels;
    this.onLayout = onLayout;
  }

  open(target: PanelTarget): Promise<void> {
    if (this.target !== undefined || this.disposed) return Promise.resolve();
    this.target = target;
    if (this.manualLayout === false) {
      for (const panel of this.panels) panel.setOpeningTarget(target);
      const platform = panelTargetPlatform(target);
      if (platform !== undefined) this.onLayout(platform);
    }
    return this.load();
  }

  setAvailable(available: boolean): Promise<void> {
    this.available = available;
    for (const panel of this.panels) panel.setAvailable(available);
    return this.load();
  }

  selectLayout() {
    this.manualLayout = true;
    for (const panel of this.panels) panel.setOpeningTarget(undefined);
  }

  dispose() { this.disposed = true; }

  private load(): Promise<void> {
    if (this.available === false || this.target === undefined || this.disposed) return Promise.resolve();
    this.loading ??= this.loadPanels();
    return this.loading;
  }

  private async loadPanels() {
    const [ios, android] = this.panels;
    const iosLoad = ios.load();
    const androidLoad = android.load();
    await Promise.all([iosLoad, androidLoad]);
    if (this.disposed || this.manualLayout) return;
    const target = this.target!;
    let layout: DeviceLayout | undefined = panelTargetPlatform(target);
    if (layout === undefined) layout = activeDeviceLayout(ios.selected, android.selected);
    if (layout === "none" && (target.kind !== undefined || target.deviceId !== undefined)) {
      layout = ios.selected ? "ios" : android.selected ? "android" : "both";
    }
    this.onLayout(layout);
  }
}
