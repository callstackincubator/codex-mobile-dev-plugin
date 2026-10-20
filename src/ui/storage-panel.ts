import type { App } from "@modelcontextprotocol/ext-apps";
import { installedAppsSchema } from "../shared/app-control.ts";
import type { InstalledApp } from "../shared/app-control.ts";
import { storageClearSchema, storageLimits, storageSnapshotSchema } from "../shared/app-storage.ts";
import type { StorageSnapshot } from "../shared/app-storage.ts";
import type { SimulatorDevice } from "../shared/protocol.ts";
import { errorMessage } from "../shared/protocol.ts";
import type { DeviceAppsStore } from "./device-apps.ts";
import { measureUiOperation, recordUiTiming, setUiGauge } from "./telemetry.ts";

export type StorageChange = "new" | "changed";
export type StorageAction = "apps" | "read" | "clear" | "reset" | "launch";
export type StorageState = {
  open: boolean;
  available: boolean;
  platform: "ios" | "android";
  deviceId: string;
  deviceLabel: string;
  // Why the selected device cannot be read, such as a physical iPhone or a stopped simulator.
  unsupported: string;
  apps: InstalledApp[];
  bundleId: string;
  snapshot?: StorageSnapshot;
  // Keyed by store ID, then entry key, against the first read of this app since it was picked.
  changes: ReadonlyMap<string, ReadonlyMap<string, StorageChange>>;
  busy: StorageAction | null;
  error: string;
  status: string;
};

// The panel shows long values in full up to this length; the tool truncates beyond it.
const panelValueLength = 4000;

export function diffSnapshots(baseline: StorageSnapshot | undefined, next: StorageSnapshot) {
  const changes = new Map<string, Map<string, StorageChange>>();
  if (baseline === undefined) return changes;
  const before = new Map(baseline.stores.map(store => [store.id, new Map(store.entries.map(entry => [entry.key, `${entry.type}\u0000${entry.value}`]))]));
  for (const store of next.stores) {
    const previous = before.get(store.id);
    const marks = new Map<string, StorageChange>();
    for (const entry of store.entries) {
      const value = previous?.get(entry.key);
      if (value === undefined) marks.set(entry.key, "new");
      else if (value !== `${entry.type}\u0000${entry.value}`) marks.set(entry.key, "changed");
    }
    if (marks.size > 0) changes.set(store.id, marks);
  }
  return changes;
}

export class StoragePanel {
  private readonly app: App;
  private readonly deviceApps: DeviceAppsStore;
  private readonly unsubscribe: () => void;
  private listeners = new Set<() => void>();
  private revision = 0;
  private baseline?: StorageSnapshot;
  private appsFor = "";
  private selections = new Map<string, string>();
  private state: StorageState = { open: false, available: false, platform: "ios", deviceId: "", deviceLabel: "", unsupported: "", apps: [], bundleId: "", changes: new Map(), busy: null, error: "", status: "" };

  constructor(app: App, deviceApps: DeviceAppsStore) {
    this.app = app;
    this.deviceApps = deviceApps;
    this.unsubscribe = deviceApps.subscribe(() => this.selectDevice(deviceApps.getSnapshot().device));
    this.selectDevice(deviceApps.getSnapshot().device);
  }

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  private update(patch: Partial<StorageState>) { this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener(); }

  // Results apply only while the device and app that started the work are still selected.
  private current() {
    const revision = this.revision;
    return () => revision === this.revision;
  }

  setAvailable(available: boolean) {
    this.update({ available });
    if (available && this.state.open) void this.loadApps();
  }

  private selectDevice(device?: SimulatorDevice) {
    const platform = device?.platform ?? "ios";
    const deviceId = device?.udid ?? "";
    const running = device !== undefined && (device.state === "Booted" || device.state === "connected");
    const unsupported = device === undefined ? "Choose a simulator or Android device."
      : platform === "ios" && device.kind === "physical" ? "Reading app data on a physical iPhone isn't supported yet. Use an iOS simulator."
      : running ? "" : `${device.name} isn't running.`;
    const changed = deviceId !== this.state.deviceId || platform !== this.state.platform;
    if (!changed) {
      if (unsupported !== this.state.unsupported || device?.name !== this.state.deviceLabel) this.update({ unsupported, deviceLabel: device?.name ?? "" });
      return;
    }
    this.revision++;
    this.baseline = undefined;
    this.appsFor = "";
    this.update({ platform, deviceId, deviceLabel: device?.name ?? "", unsupported, apps: [], bundleId: this.selections.get(`${platform}:${deviceId}`) ?? "", snapshot: undefined, changes: new Map(), busy: null, error: "", status: "" });
    if (this.state.open) void this.loadApps();
  }

  show() {
    this.update({ open: true });
    void this.loadApps();
  }

  hide() { this.update({ open: false }); }

  private async call(name: string, args: Record<string, unknown>) {
    const result = await this.app.callServerTool({ name, arguments: { platform: this.state.platform, deviceId: this.state.deviceId, ...args } }, { timeout: 60000 });
    if (result.isError) throw new Error(result.content.filter(item => item.type === "text").map(item => item.text).join("\n") || "The plugin could not read app storage.");
    return result.structuredContent;
  }

  private ready() { return this.state.available && this.state.unsupported === "" && this.state.deviceId !== ""; }

  async loadApps(force = false) {
    if (!this.ready() || this.state.busy === "apps") return;
    const key = `${this.state.platform}:${this.state.deviceId}`;
    if (!force && this.appsFor === key) return;
    const current = this.current();
    this.update({ busy: "apps", error: "" });
    try {
      const data = installedAppsSchema.parse(await measureUiOperation("ui.storage.list_apps", "ui.storage.failure", () => this.call("mobile_list_apps", {})));
      if (!current()) return;
      this.appsFor = key;
      const installed = new Set(data.apps.map(app => app.bundleId));
      const bundleId = [this.state.bundleId, data.runningBundleIds[0]].find(id => id && installed.has(id)) ?? "";
      this.update({ apps: data.apps, busy: null });
      if (bundleId !== this.state.bundleId || this.state.snapshot === undefined) this.selectApp(bundleId);
    } catch (error) {
      if (current()) this.update({ busy: null, error: errorMessage(error) });
    }
  }

  selectApp(bundleId: string) {
    if (bundleId !== this.state.bundleId) {
      this.revision++;
      this.baseline = undefined;
      this.selections.set(`${this.state.platform}:${this.state.deviceId}`, bundleId);
      this.update({ bundleId, snapshot: undefined, changes: new Map(), busy: null, error: "", status: "" });
    }
    if (bundleId) void this.refresh();
  }

  async refresh() {
    const bundleId = this.state.bundleId;
    if (!this.ready() || !bundleId || (this.state.busy && this.state.busy !== "apps")) return;
    const current = this.current();
    this.update({ busy: "read", error: "" });
    try {
      const data = await measureUiOperation("ui.storage.read", "ui.storage.failure", () => this.call("mobile_app_storage", { bundleId, entries: storageLimits.maxEntries, valueLength: panelValueLength }));
      if (!current()) return;
      const startedAt = performance.now();
      const snapshot = storageSnapshotSchema.parse(data);
      const changes = diffSnapshots(this.baseline, snapshot);
      this.baseline ??= snapshot;
      recordUiTiming("ui.storage.process", performance.now() - startedAt);
      setUiGauge("ui.storage.stores", snapshot.stores.length);
      setUiGauge("ui.storage.entries", snapshot.stores.reduce((total, store) => total + store.entries.length, 0));
      this.update({ snapshot, changes, busy: null });
    } catch (error) {
      if (current()) this.update({ busy: null, error: errorMessage(error) });
    }
  }

  // Clearing stops the app; the panel then reads again and starts change tracking over.
  async clear(storeId?: string) {
    const bundleId = this.state.bundleId;
    if (!this.ready() || !bundleId || this.state.busy) return;
    const action = storeId ? "clear" : "reset";
    const current = this.current();
    this.update({ busy: action, error: "", status: "" });
    try {
      const result = storageClearSchema.parse(await measureUiOperation(`ui.storage.${action}`, "ui.storage.failure", () => this.call("mobile_clear_app_storage", storeId ? { bundleId, store: storeId } : { bundleId })));
      if (!current()) return;
      this.baseline = undefined;
      this.update({ busy: null, status: result.cleared === "all" ? "Cleared all app data. The app was stopped." : `Cleared ${result.cleared}. The app was stopped.` });
      await this.refresh();
    } catch (error) {
      if (current()) this.update({ busy: null, error: errorMessage(error) });
    }
  }

  async launch() {
    const bundleId = this.state.bundleId;
    if (!this.ready() || !bundleId || this.state.busy) return;
    const current = this.current();
    this.update({ busy: "launch", error: "", status: "" });
    try {
      await measureUiOperation("ui.storage.launch", "ui.storage.failure", () => this.call("mobile_launch_app", { bundleId }));
      if (current()) this.update({ busy: null, status: "Launched the app." });
    } catch (error) {
      if (current()) this.update({ busy: null, error: errorMessage(error) });
    }
  }

  dispose() {
    this.revision++;
    this.unsubscribe();
    this.listeners.clear();
  }
}
