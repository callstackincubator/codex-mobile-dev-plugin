import { appIconsSchema, appLinksSchema, appPermissionsSchema, installedAppsSchema, platformPermissions } from "../shared/app-control.ts";
import type { AppPermission, AppPermissionEntry, InstalledApp, PermissionState } from "../shared/app-control.ts";
import { countUiEvent, getUiTelemetryAttributes, recordUiTiming } from "./telemetry.ts";

export type AppToolAction = "list" | "icons" | "launch" | "stop" | "open_url" | "permission" | "push";
export type AppToolsState = {
  platform: "ios" | "android";
  deviceId: string;
  disabled: boolean;
  loading: boolean;
  apps: InstalledApp[];
  icons: Record<string, string>;
  foregroundBundleId: string | null;
  runningBundleIds: string[];
  bundleId: string | null;
  permissions: AppPermissionEntry[];
  permissionsReady: boolean;
  links: string[];
  busy: string;
  error: string;
  status: string;
  recentUrls: string[];
};

const recentKey = "mobile-dev:recent-urls:v1";
const lastAppKey = "mobile-dev:last-app:v1";
function lastApps(): Record<string, string> {
  try {
    const value: unknown = JSON.parse(globalThis.localStorage?.getItem(lastAppKey) ?? "{}");
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, string> : {};
  } catch { return {}; }
}
function storedUrls(): string[] {
  try {
    const value: unknown = JSON.parse(globalThis.localStorage?.getItem(recentKey) ?? "[]");
    return Array.isArray(value) ? value.filter((url): url is string => typeof url === "string").slice(0, 5) : [];
  } catch { return []; }
}

export class AppToolsStore {
  private state: AppToolsState = { platform: "ios", deviceId: "", disabled: true, loading: false, apps: [], icons: {}, foregroundBundleId: null, runningBundleIds: [], bundleId: null, permissions: [], permissionsReady: false, links: [], busy: "", error: "", status: "", recentUrls: storedUrls() };
  private listeners = new Set<() => void>();
  private revision = 0;
  // simctl cannot read privacy decisions, so iOS rows show what this panel last applied.
  private applied = new Map<string, PermissionState>();
  // Icons are fetched once per app and device; the server caches extracted icons across panels.
  private iconRequests = new Set<string>();
  private labels = new Map<string, string>();
  call?: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  private update(patch: Partial<AppToolsState>) { this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener(); }

  configure(platform: "ios" | "android", deviceId: string, disabled: boolean) {
    if (deviceId !== this.state.deviceId || platform !== this.state.platform) {
      this.revision++;
      this.applied.clear();
      this.iconRequests.clear();
      this.labels.clear();
      this.update({ platform, deviceId, disabled, loading: false, apps: [], icons: {}, foregroundBundleId: null, runningBundleIds: [], bundleId: null, permissions: [], permissionsReady: false, links: [], busy: "", error: "", status: "" });
    } else if (disabled !== this.state.disabled) this.update({ disabled });
  }

  get app(): InstalledApp | undefined { return this.state.apps.find(app => app.bundleId === this.state.bundleId); }
  private target() { return { platform: this.state.platform, deviceId: this.state.deviceId }; }

  // Results that finish after a surface or device change are not attributed to the new context.
  private async measure<T>(action: AppToolAction, work: () => Promise<T>): Promise<T> {
    const startedAt = performance.now();
    const context = getUiTelemetryAttributes();
    try { return await work(); }
    catch (error) { if (getUiTelemetryAttributes() === context) countUiEvent("ui.app_tools.failure"); throw error; }
    finally { if (getUiTelemetryAttributes() === context) recordUiTiming(`ui.app_tools.${action}`, performance.now() - startedAt); }
  }

  // Opening the panel follows the foreground app; otherwise keep the last app, which may have crashed.
  async load() {
    if (!this.call || this.state.disabled || this.state.loading) return;
    const revision = this.revision;
    const call = this.call;
    this.update({ loading: true, error: "" });
    try {
      const data = installedAppsSchema.parse(await this.measure("list", () => call("mobile_list_apps", this.target())));
      if (revision !== this.revision) return;
      const installed = (candidate: string | null | undefined) => candidate && data.apps.some(app => app.bundleId === candidate) ? candidate : null;
      // Foreground detection can fail, so fall back to the newest running app, then the app last picked on this device.
      const bundleId = data.foregroundBundleId ?? installed(data.runningBundleIds[0]) ?? installed(this.state.bundleId) ?? installed(lastApps()[this.state.deviceId]) ?? data.apps[0]?.bundleId ?? null;
      this.update({ apps: this.labeled(data.apps), foregroundBundleId: data.foregroundBundleId, runningBundleIds: data.runningBundleIds, ...this.switchTo(bundleId) });
      void this.loadPermissions();
      void this.loadLinks();
      void this.loadIcons();
    } catch (error) {
      if (revision === this.revision) this.update({ error: message(error) });
    } finally {
      if (revision === this.revision) this.update({ loading: false });
    }
  }

  select(bundleId: string) {
    if (bundleId === this.state.bundleId) return;
    try { globalThis.localStorage?.setItem(lastAppKey, JSON.stringify({ ...lastApps(), [this.state.deviceId]: bundleId })); } catch { /* Storage can be unavailable in sandboxed hosts. */ }
    this.update({ ...this.switchTo(bundleId), error: "", status: "" });
    void this.loadPermissions();
    void this.loadLinks();
  }

  // Keep the previous app's rows and suggestions until the new app's arrive, so the popover does not collapse and regrow.
  private switchTo(bundleId: string | null): Partial<AppToolsState> {
    if (bundleId === this.state.bundleId) return {};
    return { bundleId, permissions: this.state.permissions.map(entry => ({ ...entry, state: this.applied.get(`${bundleId}:${entry.permission}`) ?? null })) };
  }

  // Picking an app in the panel means "show me this app", so it launches right away.
  open(bundleId: string) {
    this.select(bundleId);
    return this.launch();
  }

  private states(entries: AppPermissionEntry[]): AppPermissionEntry[] {
    return entries.map(entry => ({ ...entry, state: entry.state ?? this.applied.get(`${this.state.bundleId}:${entry.permission}`) ?? null }));
  }

  // Android lists packages; app labels arrive with the icons.
  private labeled(apps: InstalledApp[]) {
    return apps.map(app => ({ ...app, name: app.name === app.bundleId ? this.labels.get(app.bundleId) ?? app.name : app.name }));
  }

  private async loadIcons() {
    const bundleIds = this.state.apps.map(app => app.bundleId).filter(bundleId => !this.iconRequests.has(bundleId));
    if (!this.call || bundleIds.length === 0) return;
    for (const bundleId of bundleIds) this.iconRequests.add(bundleId);
    const revision = this.revision;
    const call = this.call;
    try {
      const data = appIconsSchema.parse(await this.measure("icons", () => call("mobile_app_icons", { ...this.target(), bundleIds })));
      if (revision !== this.revision) return;
      const icons = { ...this.state.icons };
      for (const [bundleId, entry] of Object.entries(data.apps)) {
        if (entry.icon) icons[bundleId] = entry.icon;
        if (entry.name) this.labels.set(bundleId, entry.name);
      }
      this.update({ icons, apps: this.labeled(this.state.apps) });
    } catch {
      // Initials remain; allow another attempt the next time the panel opens.
      if (revision === this.revision) for (const bundleId of bundleIds) this.iconRequests.delete(bundleId);
    }
  }

  // Suggestions are optional, so a failed read leaves the recent URLs on their own.
  private async loadLinks() {
    const bundleId = this.state.bundleId;
    if (!this.call || !bundleId) return;
    const revision = this.revision;
    try {
      const data = appLinksSchema.parse(await this.call("mobile_app_links", { ...this.target(), bundleId }));
      if (revision === this.revision && bundleId === this.state.bundleId) this.update({ links: data.links });
    } catch {
      if (revision === this.revision && bundleId === this.state.bundleId) this.update({ links: [] });
    }
  }

  private async loadPermissions() {
    const bundleId = this.state.bundleId;
    if (!this.call || !bundleId) return;
    const revision = this.revision;
    try {
      const data = appPermissionsSchema.parse(await this.call("mobile_app_permissions", { ...this.target(), bundleId }));
      if (revision === this.revision && bundleId === this.state.bundleId) this.update({ permissions: this.states(data.permissions), permissionsReady: true });
    } catch (error) {
      if (revision === this.revision && bundleId === this.state.bundleId) this.update({ error: message(error) });
    }
  }

  private async run(action: AppToolAction, key: string, status: string, work: (call: NonNullable<AppToolsStore["call"]>, current: () => boolean) => Promise<void>) {
    if (!this.call || this.state.disabled || this.state.busy) return;
    const revision = this.revision;
    const call = this.call;
    this.update({ busy: key, error: "", status: "" });
    try {
      await this.measure(action, () => work(call, () => revision === this.revision));
      if (revision === this.revision) this.update({ status });
    } catch (error) {
      if (revision === this.revision) this.update({ error: message(error) });
    } finally {
      if (revision === this.revision) this.update({ busy: "" });
    }
  }

  launch() {
    const app = this.app;
    if (!app) return Promise.resolve();
    return this.run("launch", "launch", `Relaunched ${app.name}.`, async (call, current) => {
      await call("mobile_launch_app", { ...this.target(), bundleId: app.bundleId });
      if (current()) this.update({ foregroundBundleId: app.bundleId, runningBundleIds: [app.bundleId, ...this.state.runningBundleIds.filter(id => id !== app.bundleId)] });
    });
  }

  stop() {
    const app = this.app;
    if (!app) return Promise.resolve();
    return this.run("stop", "stop", `Stopped ${app.name}.`, async (call, current) => {
      await call("mobile_stop_app", { ...this.target(), bundleId: app.bundleId });
      if (current()) this.update({ foregroundBundleId: this.state.foregroundBundleId === app.bundleId ? null : this.state.foregroundBundleId, runningBundleIds: this.state.runningBundleIds.filter(id => id !== app.bundleId) });
    });
  }

  openUrl(input: string) {
    const url = input.trim();
    if (!url) return Promise.resolve();
    return this.run("open_url", "open_url", "Opened URL.", async call => {
      await call("mobile_open_url", { ...this.target(), url });
      const recentUrls = [url, ...this.state.recentUrls.filter(entry => entry !== url)].slice(0, 5);
      try { globalThis.localStorage?.setItem(recentKey, JSON.stringify(recentUrls)); } catch { /* Storage can be unavailable in sandboxed hosts. */ }
      this.update({ recentUrls });
    });
  }

  setPermission(permission: AppPermission | "all", state: PermissionState) {
    const app = this.app;
    if (!app) return Promise.resolve();
    const label = permission === "all" ? "Reset all permissions." : `Updated ${permission} permission.`;
    return this.run("permission", `permission:${permission}`, label, async (call, current) => {
      const data = appPermissionsSchema.parse(await call("mobile_set_app_permission", { ...this.target(), bundleId: app.bundleId, permission, state }));
      const changed = permission === "all" ? platformPermissions[this.state.platform] : [permission];
      for (const entry of changed) this.applied.set(`${app.bundleId}:${entry}`, state);
      if (!current() || app.bundleId !== this.state.bundleId) return;
      const updated = new Map(this.states(data.permissions).map(entry => [entry.permission, entry]));
      this.update({ permissions: this.state.permissions.map(entry => updated.get(entry.permission) ?? (changed.includes(entry.permission) ? { ...entry, state } : entry)) });
    });
  }

  push(payload: Record<string, unknown>) {
    const app = this.app;
    if (!app) return Promise.resolve();
    return this.run("push", "push", `Sent notification to ${app.name}.`, async call => {
      await call("mobile_send_push", { ...this.target(), bundleId: app.bundleId, payload });
    });
  }

  dispose() { this.call = undefined; this.configure(this.state.platform, "", true); }
}

function message(error: unknown) { return error instanceof Error ? error.message : String(error); }

const stores = new WeakMap<HTMLElement, AppToolsStore>();
export function bindAppTools(element: HTMLElement, store: AppToolsStore) { stores.set(element, store); }
export function getAppTools(element: HTMLElement) {
  let store = stores.get(element);
  if (!store) { store = new AppToolsStore(); stores.set(element, store); }
  return store;
}
