import type { HostBridge } from "./host-bridge.ts";
import { installedAppsSchema } from "@mobile-dev/shared/app-control.ts";
import type { InstalledApp } from "@mobile-dev/shared/app-control.ts";
import { storageClearSchema, storageFileSchema, storageLimits, storageSnapshotSchema, storageTableSchema } from "@mobile-dev/shared/app-storage.ts";
import type { StorageEntry, StorageFilePreview, StorageSnapshot, StorageStore, StorageTable } from "@mobile-dev/shared/app-storage.ts";
import type { SimulatorDevice } from "@mobile-dev/shared/protocol.ts";
import { errorMessage } from "@mobile-dev/shared/protocol.ts";
import type { DeviceAppsStore } from "./device-apps.ts";
import { appIcons } from "./app-icons.ts";
import { isSdkStore, storeTitle } from "./storage-labels.ts";
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
// A table or file opened from Browse. Only one is open at a time, and its data arrives after it opens.
type DetailLoad = { loading: boolean; error: string };
export type StorageTableView = DetailLoad & { kind: "table"; storeId: string; name: string; data?: StorageTable };
export type StorageFileView = DetailLoad & { kind: "file"; path: string; data?: StorageFilePreview };
export type StorageDetail = StorageTableView | StorageFileView;
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
  detail?: StorageDetail;
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
  // Whether the app listing in flight still applies; a listing for an older device or app is left to finish unused.
  private listing?: () => boolean;
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
    // A device that boots, reconnects, or stops starts over like a newly chosen one, keeping the app picked on it.
    const changed = deviceId !== this.state.deviceId || platform !== this.state.platform || (unsupported === "") !== (this.state.unsupported === "");
    if (!changed) {
      if (unsupported !== this.state.unsupported || device?.name !== this.state.deviceLabel) this.update({ unsupported, deviceLabel: device?.name ?? "" });
      return;
    }
    this.revision++;
    this.update({ platform, deviceId, deviceLabel: device?.name ?? "", unsupported, apps: [], bundleId: this.selections.get(`${platform}:${deviceId}`) ?? "", snapshot: undefined, changes: [], detail: undefined, watchingSince: undefined, busy: null, error: "", status: "" });
    if (this.state.open) void this.loadApps();
  }

  // Each open lists the apps again, so apps installed since the last open appear.
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

  openTable(storeId: string, name: string, offset = 0) {
    const previous = this.state.detail;
    // Paging keeps the current rows on screen until the next page arrives.
    const shown = previous?.kind === "table" && previous.storeId === storeId && previous.name === name ? previous.data : undefined;
    const detail: StorageTableView = { kind: "table", storeId, name, data: shown, loading: true, error: "" };
    return this.load(detail, "ui.storage.table", async bundleId => {
      const data = storageTableSchema.parse(await this.call("mobile_app_storage_table", { bundleId, store: storeId, table: name, offset, limit: storageLimits.tableRows }));
      return { ...detail, data, loading: false };
    });
  }

  openFile(path: string) {
    const detail: StorageFileView = { kind: "file", path, loading: true, error: "" };
    return this.load(detail, "ui.storage.file", async bundleId => {
      const data = storageFileSchema.parse(await this.call("mobile_app_storage_file", { bundleId, path }));
      return { ...detail, data, loading: false };
    });
  }

  closeDetail() { if (this.state.detail) this.update({ detail: undefined }); }

  // Opens a detail and fills in its data. A newer detail, including the next page of the same table, replaces this
  // one, so a slower earlier response is dropped.
  private async load(detail: StorageDetail, metric: string, fetch: (bundleId: string) => Promise<StorageDetail>) {
    const bundleId = this.state.bundleId;
    if (!this.ready() || !bundleId) return;
    const current = this.current();
    this.update({ detail });
    const open = () => current() && this.state.detail === detail;
    try {
      const loaded = await measureUiOperation(metric, "ui.storage.failure", () => fetch(bundleId));
      if (open()) this.update({ detail: loaded });
    } catch (error) {
      if (open()) this.update({ detail: { ...detail, loading: false, error: errorMessage(error) } });
    }
  }

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

  // Lists the installed apps, keeping the current list until the new one arrives. The selected app stays while it is
  // installed; otherwise the newest running app is picked. A listing already in flight is shared, and it runs beside a
  // read or action without taking over its busy state.
  async loadApps() {
    if (!this.ready() || this.listing?.()) return;
    const current = this.current();
    this.listing = current;
    const idle = () => this.state.busy === "apps" ? null : this.state.busy;
    this.update({ busy: this.state.busy ?? "apps", error: "" });
    try {
      const data = installedAppsSchema.parse(await measureUiOperation("ui.storage.list_apps", "ui.storage.failure", () => this.call("mobile_list_apps", {})));
      if (!current()) return;
      const installed = new Set(data.apps.map(app => app.bundleId));
      const bundleId = [this.state.bundleId, data.runningBundleIds[0]].find(id => id && installed.has(id)) ?? "";
      this.update({ apps: data.apps, busy: idle() });
      void appIcons.load((name, args) => this.call(name, args), this.state.platform, this.state.deviceId, data.apps.map(app => app.bundleId),
        { measure: work => measureUiOperation("ui.storage.icons", "ui.storage.failure", work) });
      if (bundleId !== this.state.bundleId || this.state.snapshot === undefined) this.selectApp(bundleId);
    } catch (error) {
      if (current()) this.update({ busy: idle(), error: errorMessage(error) });
    } finally {
      if (this.listing === current) this.listing = undefined;
    }
  }

  // Refresh lists the apps again, so newly installed ones appear, and reads the selected app again.
  async reload() { await Promise.all([this.loadApps(), this.refresh()]); }

  selectApp(bundleId: string) {
    if (bundleId !== this.state.bundleId) {
      this.revision++;
      this.selections.set(`${this.state.platform}:${this.state.deviceId}`, bundleId);
      this.update({ bundleId, snapshot: undefined, changes: [], detail: undefined, watchingSince: undefined, busy: null, error: "", status: "" });
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
    // The server confirms without echoing the store's name, so the panel names it from its own snapshot.
    const store = this.state.snapshot?.stores.find(item => item.id === storeId);
    const cleared = !storeId ? "all app data" : store ? storeTitle(store, bundleId) : "the store";
    await this.run(action, { status: "" }, async current => {
      storageClearSchema.parse(await measureUiOperation(`ui.storage.${action}`, "ui.storage.failure", () => this.call("mobile_clear_app_storage", storeId ? { bundleId, store: storeId } : { bundleId })));
      if (!current()) return;
      this.update({ busy: null, status: `Cleared ${cleared}. The app was stopped.` });
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
