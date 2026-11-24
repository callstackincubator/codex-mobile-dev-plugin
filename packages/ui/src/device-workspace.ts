import { panelTargetPlatform, type PanelTarget } from "@mobile-dev/shared/panel-target.ts";
import type { SimulatorDevice } from "@mobile-dev/shared/protocol.ts";
import { initialPanelDevice, isDeviceActive } from "./device-layout.ts";
import { DeviceInventory, platforms, type Platform } from "./device-inventory.ts";
import type { HostBridge } from "./host-bridge.ts";
import { createSimulatorPanel } from "./simulator-panel.ts";
import { setUiGauge, setUiTelemetryContext } from "./telemetry.ts";
import type { WorkspaceTools } from "./workspace-tools.ts";

export type DevicePane = { key: number; beside?: number; platform: Platform; last: SimulatorDevice; device?: SimulatorDevice };
type Snapshot = { panes: DevicePane[]; visible: number[]; active?: number; available: boolean; message: string; stopping?: string };

/** A stopped AVD has an avd: ID and acquires a serial while running. Keep the same screen across that transition. */
export function resolvePaneDevice(devices: SimulatorDevice[], last: SimulatorDevice, platform: Platform) {
  const match = devices.find(device => device.udid === last.udid);
  if (match || platform !== "android" || last.kind === "physical") return match;
  const stoppedId = `avd:${last.name}`;
  if (last.udid === stoppedId) return devices.find(device => device.kind !== "physical" && device.name === last.name && device.state === "Booted");
  return devices.find(device => device.udid === stoppedId);
}

export class DeviceWorkspace {
  readonly inventory: Record<Platform, DeviceInventory>;
  private readonly app: HostBridge;
  private readonly tools: Pick<WorkspaceTools, "context" | "deviceApps">;
  private panels = new Map<number, ReturnType<typeof createSimulatorPanel>>();
  private listeners = new Set<() => void>();
  private closing = new Set<Promise<void>>();
  private state: Snapshot = { panes: [], visible: [], available: false, message: "" };
  private opening?: PanelTarget;
  private opened = false;
  private pickerOpen = false;
  private initialRead = false;
  private disposed = false;
  private nextKey = 0;
  private bootOnMount = new Set<number>();
  private timer?: ReturnType<typeof setInterval>;

  constructor(app: HostBridge, tools: Pick<WorkspaceTools, "context" | "deviceApps">) {
    this.app = app;
    this.tools = tools;
    this.inventory = { ios: new DeviceInventory(app, "ios"), android: new DeviceInventory(app, "android") };
    for (const platform of platforms) this.inventory[platform].subscribe(() => this.inventoryChanged(platform));
  }

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private update(patch: Partial<Snapshot>) {
    this.state = { ...this.state, ...patch };
    if (patch.visible) {
      for (const [key, panel] of this.panels) {
        const visible = patch.visible.includes(key);
        panel.setVisible(visible);
      }
    }
    for (const listener of this.listeners) listener();
  }

  private publishSelection() {
    const { panes, active, visible } = this.state;
    const displayed = panes.filter(item => visible.includes(item.key));
    const pane = panes.find(item => item.key === active);
    const device = pane?.device;
    const ios = displayed.some(item => item.platform === "ios");
    const android = displayed.some(item => item.platform === "android");
    const layout = ios && android ? "both" : ios ? "ios" : android ? "android" : "none";
    const kind = device?.kind ?? (pane?.platform === "android" ? "emulator" : "simulator");
    const single = displayed.length === 1 && device !== undefined;
    setUiTelemetryContext({ layout, device_platform: single ? pane?.platform : undefined, device_kind: single ? kind : undefined });
    setUiGauge("ui.devices.visible", displayed.length);
    const selected = displayed.flatMap(item => item.device ? [item.device] : []);
    this.tools.context.selectSimulators(selected, device);
    this.tools.deviceApps.selectDevice(device);
  }

  private inventoryChanged(platform: Platform) {
    if (this.disposed) return;
    const inventory = this.inventory[platform];
    const devices = inventory.status?.devices ?? [];
    const panes = this.state.panes.map(pane => {
      if (pane.platform !== platform) return pane;
      const device = resolvePaneDevice(devices, pane.last, platform);
      this.panels.get(pane.key)?.acceptDevice(device);
      return { ...pane, device, last: device ?? pane.last };
    });
    this.update({ panes });
    if (this.initialRead) this.applyOpening();
    this.publishSelection();
  }

  private applyOpening() {
    if (this.opening === undefined) return;
    for (const platform of platforms) {
      const inventory = this.inventory[platform];
      const device = initialPanelDevice(inventory.status?.devices ?? [], platform, undefined, this.opening);
      if (device) {
        this.opening = undefined;
        this.add(platform, device, false);
        return;
      }
    }
    const target = this.opening;
    let message: string | undefined;
    if (target.deviceId || target.platform || target.kind) {
      const platform = panelTargetPlatform(target);
      const label = platform === "ios" ? "iOS device" : platform === "android" ? "Android device" : "device";
      message = `Requested ${label} unavailable. Connect it or choose another device.`;
    } else if (this.inventory.ios.status?.localIosSupported === false) {
      const android = this.inventory.android;
      message = android.status?.setupHint || android.error;
    }
    if (message && message !== this.state.message) this.notice(message);
  }

  private add(platform: Platform, device: SimulatorDevice, boot: boolean, beside = this.state.active) {
    const key = ++this.nextKey;
    if (boot && device.kind !== "physical" && device.state === "Shutdown") this.bootOnMount.add(key);
    const panes = [...this.state.panes, { key, beside, platform, last: device, device }];
    const visible = [...this.state.visible, key];
    this.update({ panes, visible, active: key, message: "" });
    this.publishSelection();
  }

  async open(target: PanelTarget) {
    if (this.opened || this.disposed) return;
    this.opened = true;
    this.opening = target;
    await this.initialize();
  }

  async setAvailable(available: boolean) {
    this.update({ available });
    for (const panel of this.panels.values()) panel.setAvailable(available);
    await this.initialize();
  }

  private async initialize() {
    if (!this.opened || !this.state.available || this.disposed || this.timer !== undefined) return;
    this.timer = setInterval(() => {
      if (document.visibilityState === "hidden" || !this.state.available) return;
      for (const platform of platforms) {
        if (this.pickerOpen || this.opening || this.state.panes.some(pane => pane.platform === platform)) void this.inventory[platform].refresh();
      }
    }, 3000);
    await Promise.all(platforms.map(platform => this.inventory[platform].refresh()));
    if (this.disposed) return;
    this.initialRead = true;
    this.applyOpening();
    this.publishSelection();
  }

  setPickerOpen(open: boolean) {
    this.pickerOpen = open;
    if (open && this.state.available) for (const platform of platforms) void this.inventory[platform].refresh();
  }

  toggle(platform: Platform, device: SimulatorDevice, beside?: number) {
    this.opened = true;
    this.opening = undefined;
    void this.initialize();
    const pane = this.state.panes.find(item => item.platform === platform && item.last.udid === device.udid);
    if (pane) this.remove(pane.key);
    else this.add(platform, device, true, beside);
  }

  remove(key: number) {
    this.bootOnMount.delete(key);
    const panes = this.state.panes.filter(pane => pane.key !== key);
    const active = this.state.active === key ? panes.at(-1)?.key : this.state.active;
    const visible = this.state.visible.filter(item => item !== key);
    this.update({ panes, visible, active });
    this.publishSelection();
  }

  clear() {
    this.opened = true;
    this.opening = undefined;
    this.bootOnMount.clear();
    void this.initialize();
    this.update({ panes: [], visible: [], active: undefined, message: "" });
    this.publishSelection();
  }

  activate(key: number) {
    if (key === this.state.active) return;
    this.update({ active: key });
    this.publishSelection();
  }

  focusPlatform(platform: Platform): boolean {
    const { panes, visible, active } = this.state;
    const matches = panes.filter(pane => pane.platform === platform && pane.device && visible.includes(pane.key));
    const pane = matches.find(item => item.key === active) ?? matches[0];
    if (!pane) return false;
    this.activate(pane.key);
    return true;
  }

  showDevice(platform: Platform, deviceId: string): boolean {
    const { panes } = this.state;
    if (panes.length === 0) return false;
    const device = this.inventory[platform].status?.devices.find(item => item.udid === deviceId);
    if (!device || !isDeviceActive(device)) return false;
    const pane = panes.find(item => item.platform === platform && item.device?.udid === deviceId);
    if (pane) this.activate(pane.key);
    else this.add(platform, device, false);
    return true;
  }

  setDockSelection(visible: number[], active: number) {
    const current = this.state.visible;
    if (active === this.state.active && visible.length === current.length && visible.every(key => current.includes(key))) return;
    this.update({ visible, active });
    this.publishSelection();
  }

  mount(key: number, root: HTMLElement) {
    const pane = this.state.panes.find(item => item.key === key);
    if (!pane || this.disposed) return;
    const panel = createSimulatorPanel(this.app, root, this.inventory[pane.platform], this.tools.context, () => this.activate(key));
    this.panels.set(key, panel);
    const visible = this.state.visible.includes(key);
    panel.setVisible(visible);
    panel.setAvailable(this.state.available);
    panel.acceptDevice(pane.device);
    if (this.bootOnMount.delete(key)) void panel.start();
    return () => {
      this.panels.delete(key);
      const closing = panel.dispose();
      this.closing.add(closing);
      void closing.finally(() => this.closing.delete(closing));
    };
  }

  async stop(platform: Platform, device: SimulatorDevice) {
    const inventory = this.inventory[platform];
    const option = inventory.items.find(item => item.value === device.udid);
    if (this.state.stopping || !option?.canStop) return;
    this.update({ stopping: device.udid });
    try {
      const pane = this.state.panes.find(item => item.platform === platform && item.device?.udid === device.udid);
      const panel = pane && this.panels.get(pane.key);
      if (panel) await panel.stop();
      else await inventory.power(device, false);
    } finally { this.update({ stopping: undefined }); }
  }

  notice(message: string) {
    this.update({ message });
    for (const panel of this.panels.values()) panel.notice(message);
  }
  refit() { for (const panel of this.panels.values()) { panel.fitScreen(); panel.controls(); } }

  async dispose() {
    this.disposed = true;
    clearInterval(this.timer);
    const closing = [...this.panels.values()].map(panel => panel.dispose());
    await Promise.allSettled([...closing, ...this.closing]);
  }
}
