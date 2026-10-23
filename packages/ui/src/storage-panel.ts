import type { HostBridge } from "./host-bridge.ts";
import { installedAppsSchema } from "@mobile-dev/shared/app-control.ts";
import type { InstalledApp } from "@mobile-dev/shared/app-control.ts";
import { storageClearSchema, storageLimits, storageSnapshotSchema, storageTableSchema } from "@mobile-dev/shared/app-storage.ts";
import type { StorageEntry, StorageSnapshot, StorageStore, StorageTable } from "@mobile-dev/shared/app-storage.ts";
import type { SimulatorDevice } from "@mobile-dev/shared/protocol.ts";
import { errorMessage } from "@mobile-dev/shared/protocol.ts";
import type { DeviceAppsStore } from "./device-apps.ts";
import { appIcons } from "./app-icons.ts";
import { isSdkStore } from "./storage-labels.ts";
import { measureUiOperation, recordUiTiming, setUiGauge } from "./telemetry.ts";

export type StorageAction = "apps" | "read" | "clear" | "reset" | "launch";
export type StorageTab = "browse" | "changes";
export type StorageChangeKind = "added" | "changed" | "removed";
// One key that differed between two reads, kept in the Changes feed.
export type StorageChangeEvent = {
  id: number;
  at: number;
  store: Pick<StorageStore, "id" | "kind" | "name" | "path">;
  sdk: boolean;
  key: string;
  change: StorageChangeKind;
  before?: StorageEntry;
  after?: StorageEntry;
};
export type StorageTableView = { storeId: string; name: string; data?: StorageTable; loading: boolean; error: string };
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
  tab: StorageTab;
  // Newest first, from the first read of this app until the feed is cleared.
  changes: readonly StorageChangeEvent[];
  // SDK stores (analytics, crash reporting) write often, so their changes are hidden unless asked for.
  showSdkChanges: boolean;
  // The database table open in Browse, page by page.
  table?: StorageTableView;
  watchingSince?: number;
  busy: StorageAction | null;
  error: string;
  status: string;
};

// The panel shows long values in full up to this length; the tool truncates beyond it.
const panelValueLength = 4000;
// While the Changes tab is visible, storage is read again on this interval.
export const changesPollMs = 5000;
const maxChanges = 500;

const same = (a: StorageEntry, b: StorageEntry) => a.type === b.type && a.value === b.value;

// Listing apps runs alongside other work; anything else blocks further reads and actions.
export const isWorking = (state: StorageState) => state.busy !== null && state.busy !== "apps";
// The changes the feed shows, honoring the SDK toggle.
export const shownChanges = (state: StorageState) => state.showSdkChanges ? state.changes : state.changes.filter(event => !event.sdk);

// Keys added, changed, or removed between two reads. Stores that were capped skip removals,
// since a key past the cap is not missing.
export function diffSnapshots(previous: StorageSnapshot, next: StorageSnapshot): Omit<StorageChangeEvent, "id">[] {
  const events: Omit<StorageChangeEvent, "id">[] = [];
  const before = new Map(previous.stores.map(store => [store.id, store]));
  const after = new Map(next.stores.map(store => [store.id, store]));
  const event = (store: StorageStore, key: string, change: StorageChangeKind, old?: StorageEntry, value?: StorageEntry) =>
    events.push({ at: next.readAt, store: { id: store.id, kind: store.kind, name: store.name, path: store.path }, sdk: isSdkStore(store), key, change, before: old, after: value });
  for (const store of next.stores) {
    const old = before.get(store.id);
    if (store.status !== "ok" || (old && old.status !== "ok")) continue;
    const oldEntries = new Map(old?.entries.map(entry => [entry.key, entry]));
    for (const entry of store.entries) {
      const previousEntry = oldEntries.get(entry.key);
      if (previousEntry === undefined) event(store, entry.key, "added", undefined, entry);
      else if (!same(previousEntry, entry)) event(store, entry.key, "changed", previousEntry, entry);
    }
    if (old === undefined || old.entries.length < old.entryCount || store.entries.length < store.entryCount) continue;
    const keys = new Set(store.entries.map(entry => entry.key));
    for (const entry of old.entries) if (!keys.has(entry.key)) event(store, entry.key, "removed", entry);
  }
  for (const store of previous.stores) {
    if (after.has(store.id) || store.status !== "ok") continue;
    for (const entry of store.entries) event(store, entry.key, "removed", entry);
  }
  return events;
}

export class StoragePanel {
  private readonly app: HostBridge;
  private readonly deviceApps: DeviceAppsStore;
  private readonly unsubscribe: () => void;
  private listeners = new Set<() => void>();
  private revision = 0;
  private nextChange = 1;
  private poll?: ReturnType<typeof setInterval>;
  private appsFor = "";
  private selections = new Map<string, string>();
  private state: StorageState = { open: false, available: false, platform: "ios", deviceId: "", deviceLabel: "", unsupported: "", apps: [], bundleId: "", tab: "browse", changes: [], showSdkChanges: false, busy: null, error: "", status: "" };

  constructor(app: HostBridge, deviceApps: DeviceAppsStore) {
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
    this.appsFor = "";
    this.update({ platform, deviceId, deviceLabel: device?.name ?? "", unsupported, apps: [], bundleId: this.selections.get(`${platform}:${deviceId}`) ?? "", snapshot: undefined, changes: [], table: undefined, watchingSince: undefined, busy: null, error: "", status: "" });
    if (this.state.open) void this.loadApps();
  }

  show() {
    this.update({ open: true });
    void this.loadApps();
    this.schedule();
  }

  hide() { this.update({ open: false }); this.schedule(); }

  setTab(tab: StorageTab) {
    if (tab === this.state.tab) return;
    this.update({ tab });
    this.schedule();
    if (tab === "changes") void this.refresh();
  }

  setShowSdkChanges(showSdkChanges: boolean) { this.update({ showSdkChanges }); }

  async openTable(storeId: string, name: string, offset = 0) {
    const bundleId = this.state.bundleId;
    if (!this.ready() || !bundleId) return;
    const current = this.current();
    const previous = this.state.table;
    const isOpen = (table?: StorageTableView) => table?.storeId === storeId && table.name === name;
    // Paging keeps the current rows on screen until the next page arrives.
    const table: StorageTableView = { storeId, name, data: isOpen(previous) ? previous?.data : undefined, loading: true, error: "" };
    this.update({ table });
    const stillOpen = () => current() && isOpen(this.state.table);
    try {
      const data = storageTableSchema.parse(await measureUiOperation("ui.storage.table", "ui.storage.failure",
        () => this.call("mobile_app_storage_table", { bundleId, store: storeId, table: name, offset, limit: storageLimits.tableRows })));
      if (stillOpen()) this.update({ table: { ...table, data, loading: false } });
    } catch (error) {
      if (stillOpen()) this.update({ table: { ...table, loading: false, error: errorMessage(error) } });
    }
  }

  closeTable() { if (this.state.table) this.update({ table: undefined }); }

  clearChanges() { this.update({ changes: [], watchingSince: this.state.snapshot?.readAt }); }

  // Only the visible Changes tab re-reads storage; Browse refreshes on request.
  private schedule() {
    const watching = this.state.open && this.state.tab === "changes";
    if (watching && this.poll === undefined) {
      this.poll = setInterval(() => {
        if (document.visibilityState !== "hidden" && this.state.busy === null) void this.refresh();
      }, changesPollMs);
    } else if (!watching && this.poll !== undefined) {
      clearInterval(this.poll);
      this.poll = undefined;
    }
  }

  private async call(name: string, args: Record<string, unknown>) {
    const result = await this.app.callServerTool({ name, arguments: { platform: this.state.platform, deviceId: this.state.deviceId, ...args } }, { timeout: 60000 });
    if (result.isError) throw new Error(result.content.filter(item => item.type === "text").map(item => item.text).join("\n") || "The plugin could not read app storage.");
    return result.structuredContent;
  }

  private ready() { return this.state.available && this.state.unsupported === "" && this.state.deviceId !== ""; }

  // One operation on the selected device and app. Its results and errors apply only while that selection lasts.
  private async run(busy: StorageAction, start: Partial<StorageState>, work: (current: () => boolean) => Promise<void>) {
    const current = this.current();
    this.update({ busy, error: "", ...start });
    try { await work(current); }
    catch (error) { if (current()) this.update({ busy: null, error: errorMessage(error) }); }
  }

  async loadApps(force = false) {
    if (!this.ready() || this.state.busy === "apps") return;
    const key = `${this.state.platform}:${this.state.deviceId}`;
    if (!force && this.appsFor === key) return;
    await this.run("apps", {}, async current => {
      const data = installedAppsSchema.parse(await measureUiOperation("ui.storage.list_apps", "ui.storage.failure", () => this.call("mobile_list_apps", {})));
      if (!current()) return;
      this.appsFor = key;
      const installed = new Set(data.apps.map(app => app.bundleId));
      const bundleId = [this.state.bundleId, data.runningBundleIds[0]].find(id => id && installed.has(id)) ?? "";
      this.update({ apps: data.apps, busy: null });
      void appIcons.load((name, args) => this.call(name, args), this.state.platform, this.state.deviceId, data.apps.map(app => app.bundleId),
        { measure: work => measureUiOperation("ui.storage.icons", "ui.storage.failure", work) });
      if (bundleId !== this.state.bundleId || this.state.snapshot === undefined) this.selectApp(bundleId);
    });
  }

  selectApp(bundleId: string) {
    if (bundleId !== this.state.bundleId) {
      this.revision++;
      this.selections.set(`${this.state.platform}:${this.state.deviceId}`, bundleId);
      this.update({ bundleId, snapshot: undefined, changes: [], table: undefined, watchingSince: undefined, busy: null, error: "", status: "" });
    }
    if (bundleId) void this.refresh();
  }

  async refresh() {
    const bundleId = this.state.bundleId;
    if (!this.ready() || !bundleId || isWorking(this.state)) return;
    await this.run("read", {}, async current => {
      const data = await measureUiOperation("ui.storage.read", "ui.storage.failure", () => this.call("mobile_app_storage", { bundleId, entries: storageLimits.maxEntries, valueLength: panelValueLength }));
      if (!current()) return;
      const startedAt = performance.now();
      const snapshot = storageSnapshotSchema.parse(data);
      const previous = this.state.snapshot;
      const found = previous ? diffSnapshots(previous, snapshot).map(event => ({ ...event, id: this.nextChange++ })) : [];
      const changes = found.length > 0 ? [...found.reverse(), ...this.state.changes].slice(0, maxChanges) : this.state.changes;
      recordUiTiming("ui.storage.process", performance.now() - startedAt);
      setUiGauge("ui.storage.stores", snapshot.stores.length);
      setUiGauge("ui.storage.entries", snapshot.stores.reduce((total, store) => total + store.entries.length, 0));
      this.update({ snapshot, changes, watchingSince: this.state.watchingSince ?? snapshot.readAt, busy: null });
    });
  }

  // Clearing stops the app; the next read records the cleared keys as removed.
  async clear(storeId?: string) {
    const bundleId = this.state.bundleId;
    if (!this.ready() || !bundleId || this.state.busy) return;
    const action = storeId ? "clear" : "reset";
    await this.run(action, { status: "" }, async current => {
      const result = storageClearSchema.parse(await measureUiOperation(`ui.storage.${action}`, "ui.storage.failure", () => this.call("mobile_clear_app_storage", storeId ? { bundleId, store: storeId } : { bundleId })));
      if (!current()) return;
      this.update({ busy: null, status: result.cleared === "all" ? "Cleared all app data. The app was stopped." : `Cleared ${result.cleared}. The app was stopped.` });
      await this.refresh();
    });
  }

  async launch() {
    const bundleId = this.state.bundleId;
    if (!this.ready() || !bundleId || this.state.busy) return;
    await this.run("launch", { status: "" }, async current => {
      await measureUiOperation("ui.storage.launch", "ui.storage.failure", () => this.call("mobile_launch_app", { bundleId }));
      if (current()) this.update({ busy: null, status: "Launched the app." });
    });
  }

  dispose() {
    this.revision++;
    if (this.poll !== undefined) clearInterval(this.poll);
    this.poll = undefined;
    this.unsubscribe();
    this.listeners.clear();
  }
}
