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
  /**
   * The layout this chose for the user, so an unresolved one can still be finished.
   *
   * The automatic layout used to be decided exactly once, from the **first** device list. A list
   * that came back before the backend had found anything — which is the ordinary case, since the
   * opening tool starts the backend — resolved to "none", both panels stayed hidden, and nothing
   * ever looked again: the user had a booted simulator, an empty workspace, a platform selector
   * reading "Platforms", and a panel telling them to boot a simulator. Discovery finds the device
   * a moment later and the panels select it, so what was missing was somebody asking again.
   */
  private reported?: DeviceLayout;

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
      if (platform !== undefined) this.report(platform);
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

  /**
   * Finishes an automatic layout that resolved to "none", once a panel has a device to show.
   *
   * Called whenever a panel's selection changes, which is what device discovery does when it finds
   * the simulator the first list missed. It only ever turns "none" into a platform: a layout that
   * resolved to something, and any layout the user chose themselves, are left exactly as they are.
   */
  settleLayout() {
    // An unresolved layout is one that was never reported, or was reported as "none".
    if (this.disposed || this.manualLayout) return;
    if (this.reported !== undefined && this.reported !== "none") return;
    const [ios, android] = this.panels;
    const layout = activeDeviceLayout(ios.selected, android.selected);
    if (layout !== "none") this.report(layout);
  }

  private report(layout: DeviceLayout) {
    this.reported = layout;
    this.onLayout(layout);
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
    this.report(layout);
  }
}
