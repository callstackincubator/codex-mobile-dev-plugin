import { z } from "zod";
import { appLanguageSchema, appLinksSchema, appPermissionsSchema, installedAppsSchema, platformPermissions } from "@mobile-dev/shared/app-control.ts";
import type { AppPermission, AppPermissionEntry, InstalledApp, PermissionState } from "@mobile-dev/shared/app-control.ts";
import { measureUiOperation } from "./telemetry.ts";
import { Store } from "./store.ts";
import { appIcons } from "./app-icons.ts";
import type { AppDevice } from "./device-apps.ts";
import { errorMessage } from "@mobile-dev/shared/error-reporting.ts";

export type AppToolAction = "list" | "icons" | "launch" | "stop" | "open_url" | "permission" | "push" | "language";
export type AppEntry = InstalledApp & { icon?: string };
export type AppSection = "permissions" | "language" | "push";
export type AppToolsState = {
  platform: "ios" | "android";
  deviceId: string;
  disabled: boolean;
  loading: boolean;
  apps: AppEntry[];
  runningBundleIds: string[];
  bundleId: string | null;
  // Null until the first app's permissions load; later switches keep the previous rows until the new ones arrive.
  permissions: AppPermissionEntry[] | null;
  links: string[];
  // Undefined while loading; null when the app follows the device language.
  language: string | null | undefined;
  busy: AppToolAction | null;
  error: string;
  status: string;
  recentUrls: string[];
  // The collapsible section left open, kept across panels so the one used most stays open.
  section: AppSection | null;
};

// localStorage can be missing or blocked in sandboxed hosts, so stored values are best effort.
function storedValue<T>(key: string, schema: z.ZodType<T>, fallback: T) {
  return {
    read(): T {
      try { return schema.safeParse(JSON.parse(globalThis.localStorage?.getItem(key) ?? "null")).data ?? fallback; }
      catch { return fallback; }
    },
    write(value: T) {
      try { globalThis.localStorage?.setItem(key, JSON.stringify(value)); }
      catch { /* Keep the in-memory value. */ }
    },
  };
}

const recentUrls = storedValue("mobile-dev:recent-urls:v1", z.array(z.string()).max(5), []);
const openSection = storedValue("mobile-dev:app-section:v1", z.enum(["permissions", "language", "push"]).nullable(), null);
const lastPicked = storedValue("mobile-dev:last-app:v1", z.record(z.string(), z.string()), {});
const deviceDefaults = { loading: false, apps: [], runningBundleIds: [], bundleId: null, permissions: null, links: [], language: undefined, busy: null, error: "", status: "" } satisfies Partial<AppToolsState>;

/** Calls an app tool on the panel's device and returns its structured content. */
export type AppToolCall = (name: string, args: Record<string, unknown>) => Promise<unknown>;
/** Lists a device's installed apps; the workspace shares one listing per device across its panels. */
export type InstalledAppsSource = (device: AppDevice) => Promise<unknown>;

export class AppToolsStore extends Store<AppToolsState> {
  private readonly call: AppToolCall;
  private readonly installedApps: InstalledAppsSource;
  private disposed = false;
  private revision = 0;
  // simctl cannot read privacy decisions, so iOS rows show what this panel last applied.
  private applied = new Map<string, PermissionState>();

  constructor(call: AppToolCall, installedApps: InstalledAppsSource = device => call("mobile_list_apps", device)) {
    super({ platform: "ios", deviceId: "", disabled: true, ...deviceDefaults, recentUrls: recentUrls.read(), section: openSection.read() });
    this.call = call;
    this.installedApps = installedApps;
  }

  configure(platform: "ios" | "android", deviceId: string, disabled: boolean) {
    if (deviceId === this.state.deviceId && platform === this.state.platform) {
      if (disabled !== this.state.disabled) this.update({ disabled });
      return;
    }
    this.revision++;
    this.applied.clear();
    this.update({ platform, deviceId, disabled, ...deviceDefaults });
  }

  get app(): AppEntry | undefined { return this.state.apps.find(app => app.bundleId === this.state.bundleId); }

  // Async results apply only while the device, and the app when given, are still the ones that started the work.
  private current(bundleId?: string) {
    const revision = this.revision;
    return () => revision === this.revision && (bundleId === undefined || bundleId === this.state.bundleId);
  }

  private tool(name: string, args: Record<string, unknown> = {}) {
    if (this.disposed) return Promise.reject(new Error("This host cannot call the plugin's app tools."));
    return this.call(name, { platform: this.state.platform, deviceId: this.state.deviceId, ...args });
  }

  private measure<T>(action: AppToolAction, work: () => Promise<T>) { return measureUiOperation(`ui.app_tools.${action}`, "ui.app_tools.failure", work); }

  async load() {
    if (this.disposed || this.state.disabled || this.state.loading) return;
    const current = this.current();
    this.update({ loading: true, error: "" });
    try {
      const data = installedAppsSchema.parse(await this.measure("list", () => this.installedApps({ platform: this.state.platform, deviceId: this.state.deviceId })));
      if (!current()) return;
      const installed = new Set(data.apps.map(app => app.bundleId));
      // The foreground or newest running app, then the current selection, then the app last picked on this device.
      const preferred = [data.runningBundleIds[0], this.state.bundleId, lastPicked.read()[this.state.deviceId]].find(bundleId => bundleId && installed.has(bundleId));
      this.update({ apps: this.withDetails(data.apps), runningBundleIds: data.runningBundleIds, ...this.switchTo(preferred ?? data.apps[0]?.bundleId ?? null) });
      void this.loadSelected();
      void this.loadDetails();
    } catch (error) {
      if (current()) this.update({ error: errorMessage(error) });
    } finally {
      if (current()) this.update({ loading: false });
    }
  }

  select(bundleId: string) {
    if (bundleId === this.state.bundleId) return;
    lastPicked.write({ ...lastPicked.read(), [this.state.deviceId]: bundleId });
    this.update({ ...this.switchTo(bundleId), error: "", status: "" });
    void this.loadSelected();
  }

  // Picking an app in the panel means "show me this app", so it launches right away.
  open(bundleId: string) {
    this.select(bundleId);
    return this.launch();
  }

  // Keep the previous rows and suggestions until the new app's arrive, so the popover keeps its height.
  private switchTo(bundleId: string | null): Partial<AppToolsState> {
    if (bundleId === this.state.bundleId) return {};
    return { bundleId, language: undefined, permissions: this.state.permissions && this.withApplied(this.state.permissions.map(entry => ({ ...entry, state: null })), bundleId) };
  }

  private withApplied(entries: AppPermissionEntry[], bundleId = this.state.bundleId): AppPermissionEntry[] {
    return entries.map(entry => ({ ...entry, state: entry.state ?? this.applied.get(`${bundleId}:${entry.permission}`) ?? null }));
  }

  private withDetails(apps: InstalledApp[]): AppEntry[] { return apps.map(app => ({ ...app, ...appIcons.get(this.state.platform, this.state.deviceId, app.bundleId) })); }

  private async loadSelected() {
    const bundleId = this.state.bundleId;
    if (!bundleId) return;
    const current = this.current(bundleId);
    const [permissions, links, language] = await Promise.allSettled([
      this.tool("mobile_app_permissions", { bundleId }).then(data => appPermissionsSchema.parse(data).permissions),
      this.tool("mobile_app_links", { bundleId }).then(data => appLinksSchema.parse(data).links),
      this.tool("mobile_app_language", { bundleId }).then(data => appLanguageSchema.parse(data).language),
    ]);
    if (!current()) return;
    // Suggestions and the language are optional, so only a permission failure is shown.
    this.update({
      links: links.status === "fulfilled" ? links.value : [],
      // Older Android releases have no per-app language; the section then offers only the device language.
      language: language.status === "fulfilled" ? language.value : null,
      ...(permissions.status === "fulfilled" ? { permissions: this.withApplied(permissions.value) } : { error: errorMessage(permissions.reason) }),
    });
  }

  // Icons arrive batch by batch through the shared cache, so devices with many apps show the first ones sooner.
  private async loadDetails() {
    const current = this.current();
    await appIcons.load((name, args) => this.tool(name, args), this.state.platform, this.state.deviceId, this.state.apps.map(app => app.bundleId), {
      measure: work => this.measure("icons", work),
      onBatch: () => { if (current()) this.update({ apps: this.withDetails(this.state.apps) }); },
    });
  }

  private async run(action: AppToolAction, describe: (app: AppEntry) => string, work: (app: AppEntry, current: () => boolean) => Promise<void>) {
    const app = this.app;
    if (!app || this.disposed || this.state.disabled || this.state.busy) return;
    const current = this.current();
    this.update({ busy: action, error: "", status: "" });
    try {
      await this.measure(action, () => work(app, current));
      if (current()) this.update({ status: describe(app) });
    } catch (error) {
      if (current()) this.update({ error: errorMessage(error) });
    } finally {
      if (current()) this.update({ busy: null });
    }
  }

  private markRunning(bundleId: string, running: boolean) {
    const others = this.state.runningBundleIds.filter(id => id !== bundleId);
    this.update({ runningBundleIds: running ? [bundleId, ...others] : others });
  }

  launch() {
    return this.run("launch", app => `Relaunched ${app.name}.`, async (app, current) => {
      await this.tool("mobile_launch_app", { bundleId: app.bundleId });
      if (current()) this.markRunning(app.bundleId, true);
    });
  }

  stop() {
    return this.run("stop", app => `Stopped ${app.name}.`, async (app, current) => {
      await this.tool("mobile_stop_app", { bundleId: app.bundleId });
      if (current()) this.markRunning(app.bundleId, false);
    });
  }

  openUrl(input: string) {
    const url = input.trim();
    if (!url) return Promise.resolve();
    return this.run("open_url", () => "Opened URL.", async () => {
      await this.tool("mobile_open_url", { url });
      const urls = [url, ...this.state.recentUrls.filter(entry => entry !== url)].slice(0, 5);
      recentUrls.write(urls);
      this.update({ recentUrls: urls });
    });
  }

  setPermission(permission: AppPermission | "all", state: PermissionState) {
    return this.run("permission", () => permission === "all" ? "Reset all permissions." : `Updated ${permission} permission.`, async (app, current) => {
      const { permissions } = appPermissionsSchema.parse(await this.tool("mobile_set_app_permission", { bundleId: app.bundleId, permission, state }));
      // A result that lands after a device switch belongs to the previous device.
      if (!current()) return;
      for (const entry of permission === "all" ? platformPermissions[this.state.platform] : [permission]) this.applied.set(`${app.bundleId}:${entry}`, state);
      if (app.bundleId === this.state.bundleId) this.update({ permissions: this.withApplied(permissions) });
    });
  }

  // Apps read their language at launch, so the server relaunches the app after changing it.
  setLanguage(language: string | null) {
    return this.run("language", app => `Relaunched ${app.name}${language ? ` in ${language}` : " in the device language"}.`, async (app, current) => {
      const result = appLanguageSchema.parse(await this.tool("mobile_set_app_language", { bundleId: app.bundleId, language }));
      if (!current()) return;
      this.markRunning(app.bundleId, true);
      if (app.bundleId === this.state.bundleId) this.update({ language: result.language });
    });
  }

  setSection(section: AppSection | null) {
    openSection.write(section);
    this.update({ section });
  }

  push(payload: Record<string, unknown>) {
    return this.run("push", app => `Sent notification to ${app.name}.`, async app => {
      await this.tool("mobile_send_push", { bundleId: app.bundleId, payload });
    });
  }

  dispose() { this.disposed = true; this.configure(this.state.platform, "", true); this.close(); }
}
