import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import * as Sentry from "@sentry/node";
import { compareReleaseVersions, PLUGIN_STORE_ID, releaseVersionSchema, STORE_MIGRATION_VERSION } from "../shared/plugin-updates.ts";
import type { PluginUpdate } from "../shared/plugin-updates.ts";
import { PLUGIN_VERSION } from "@mobile-dev/shared/version.ts";
import { ExpectedOperationError } from "@mobile-dev/shared/error-reporting.ts";
import { captureServerError } from "@mobile-dev/core/telemetry.ts";
import { resolveTelemetryEnvironment } from "@mobile-dev/core/telemetry-environment.ts";
import { codexCliResolver, createCodexRunner, PluginUpdateError, readPluginStore, STORE_MARKETPLACE, storeSummarySchema } from "./codex-cli.ts";
import type { ReadStore, RunCodex, StorePlugin, UpdateFailure } from "./codex-cli.ts";

export function recordPluginUpdate(operation: "check" | "migrate", outcome: "disabled" | "unavailable" | "current" | "available" | "migration" | "migrated" | "failed", duration: number) {
  if (process.env.MOBILE_DEV_TELEMETRY === "off") return;
  const attributes = { component: "server", operation, outcome };
  Sentry.metrics.count("plugin.update.operations", 1, { attributes });
  Sentry.metrics.gauge("plugin.update.duration", duration, { unit: "millisecond", attributes });
}

const repositories = ["callstackincubator/codex-mobile-dev-plugin", "callstackincubator/mobile-dev"];
const githubPlugin = "mobile-dev@mobile-dev";
const checkIntervalMs = 60 * 60 * 1000;
const failedCheckIntervalMs = 15 * 60 * 1000;
// The cache file keeps the flat format older releases read, so downgrades keep working. A failed
// check after a good one keeps that result and adds failedAt, which older releases ignore.
const cacheSchema = z.object({
  source: z.literal(PLUGIN_STORE_ID), checkedAt: z.number().nonnegative(), latestVersion: releaseVersionSchema.optional(),
  githubConfigured: z.boolean(), storeInstalled: z.boolean(), migratedVersion: releaseVersionSchema.optional(),
  failedAt: z.number().nonnegative().optional(),
});
const manifestSchema = z.object({ name: z.literal("mobile-dev"), version: releaseVersionSchema });
const marketplaceSourceSchema = z.object({ sourceType: z.string(), source: z.string() }).optional();
const pluginSchema = z.object({
  pluginId: z.string(), name: z.string(), marketplaceName: z.string(), version: z.string().nullable(),
  installed: z.boolean(), enabled: z.boolean(), source: z.object({ source: z.string(), id: z.string().nullish() }), marketplaceSource: marketplaceSourceSchema,
});
const pluginsSchema = z.object({ installed: z.array(pluginSchema), available: z.array(pluginSchema) });
const marketplaceSchema = z.object({ marketplaces: z.array(z.object({ name: z.string(), marketplaceSource: marketplaceSourceSchema })) });
const removedSchema = z.object({ pluginId: z.string() });
const removedMarketplaceSchema = z.object({ marketplaceName: z.string() });
type StoredCache = z.infer<typeof cacheSchema>;
type Check = { checkedAt: number; latestVersion: string; githubConfigured: boolean; storeInstalled: boolean };
type KnownCache = { state: "checked" } & Check | { state: "migrated"; migratedVersion: string } & Check;
// A failed check keeps the previous result to show until a later check succeeds.
type Cache = { state: "unchecked" } | { state: "failed"; checkedAt: number; previous?: KnownCache } | KnownCache;
type SavedCache = Exclude<Cache, { state: "unchecked" }>;
type Catalog = z.infer<typeof pluginsSchema> & { store: StorePlugin };
type MigrationStep = "catalog" | "remove-plugin" | "remove-marketplace" | "verify" | "save";

function updateFailure(error: unknown): UpdateFailure | "unknown" {
  if (error instanceof PluginUpdateError) return error.failure;
  if (error instanceof z.ZodError) return "invalid-response";
  return "unknown";
}

function isReleaseRepository(source: string): boolean {
  return repositories.some(repository => source === `https://github.com/${repository}` || source === `https://github.com/${repository}.git`
    || source === `git@github.com:${repository}.git` || source === `ssh://git@github.com/${repository}.git`);
}

function hasGithubRelease(plugins: Catalog["installed"]): boolean {
  return plugins.some(plugin => {
    const source = plugin.marketplaceSource;
    return plugin.pluginId === githubPlugin && source?.sourceType === "git" && isReleaseRepository(source.source);
  });
}

function githubConfigured(catalog: Catalog): boolean {
  return hasGithubRelease([...catalog.installed, ...catalog.available]);
}

function knownCache(cache: Cache): KnownCache | undefined {
  if (cache.state === "unchecked") return undefined;
  return cache.state === "failed" ? cache.previous : cache;
}

function fromStored(stored: StoredCache): SavedCache {
  const { checkedAt, latestVersion, githubConfigured, storeInstalled, migratedVersion, failedAt } = stored;
  if (failedAt !== undefined) {
    const previous = fromStored({ ...stored, failedAt: undefined });
    return { state: "failed", checkedAt: failedAt, previous: knownCache(previous) };
  }
  if (migratedVersion !== undefined) return { state: "migrated", migratedVersion, checkedAt, latestVersion: latestVersion ?? migratedVersion, githubConfigured, storeInstalled };
  if (latestVersion === undefined) return { state: "failed", checkedAt };
  return { state: "checked", checkedAt, latestVersion, githubConfigured, storeInstalled };
}

function toStored(cache: SavedCache): StoredCache {
  const source = PLUGIN_STORE_ID;
  if (cache.state === "failed") {
    if (cache.previous === undefined) return { source, checkedAt: cache.checkedAt, githubConfigured: false, storeInstalled: false };
    return { ...toStored(cache.previous), failedAt: cache.checkedAt };
  }
  const { checkedAt, latestVersion, githubConfigured, storeInstalled } = cache;
  const migratedVersion = cache.state === "migrated" ? cache.migratedVersion : undefined;
  return { source, checkedAt, latestVersion, githubConfigured, storeInstalled, migratedVersion };
}

export class PluginUpdates {
  private readonly enabled: boolean;
  private readonly currentVersion: string;
  private readonly profile: string;
  private readonly runningGithub: boolean;
  private readonly cachePath: string;
  private readonly run: RunCodex;
  private readonly readStore: ReadStore;
  private readonly now: () => number;
  private checking?: Promise<PluginUpdate>;
  private migrating?: Promise<PluginUpdate>;
  // This process's latest result, used while the cache file holds an older one, such as after a failed save.
  private last?: SavedCache;
  private readonly abort = new AbortController();

  constructor(options: { enabled?: boolean; currentVersion?: string; profile?: string; pluginRoot?: string; run?: RunCodex; readStore?: ReadStore; now?: () => number } = {}) {
    this.enabled = options.enabled ?? resolveTelemetryEnvironment() === "release";
    this.currentVersion = options.currentVersion ?? PLUGIN_VERSION;
    const home = homedir();
    const defaultProfile = join(home, ".codex");
    this.profile = options.profile ?? process.env.CODEX_HOME ?? defaultProfile;
    const modulePath = fileURLToPath(import.meta.url);
    const moduleDirectory = dirname(modulePath);
    const pluginRoot = options.pluginRoot ?? dirname(moduleDirectory);
    const pluginParent = dirname(pluginRoot);
    const githubCache = join("plugins", "cache", "mobile-dev", "mobile-dev");
    this.runningGithub = pluginParent.endsWith(githubCache);
    this.cachePath = join(this.profile, "mobile-dev", "updates.json");
    const codex = { resolveCli: codexCliResolver(this.profile), signal: this.abort.signal };
    this.run = options.run ?? createCodexRunner(this.profile, codex);
    this.readStore = options.readStore ?? (() => readPluginStore(this.profile, codex));
    this.now = options.now ?? Date.now;
  }

  /** Whether a store release can replace this build: the migration release or later, and not older. */
  private isMigrationTarget(version: string): boolean {
    return compareReleaseVersions(version, STORE_MIGRATION_VERSION) >= 0 && compareReleaseVersions(version, this.currentVersion) >= 0;
  }

  private status(cache: Cache): PluginUpdate {
    const currentVersion = this.currentVersion;
    switch (cache.state) {
      case "unchecked": return { status: "unavailable", currentVersion };
      case "failed": return cache.previous === undefined ? { status: "unavailable", currentVersion } : this.status(cache.previous);
      case "migrated":
        if (this.runningGithub) return { status: "migrated", currentVersion, latestVersion: cache.migratedVersion, storeInstalled: true };
        return this.checkedStatus(cache);
      case "checked": return this.checkedStatus(cache);
    }
  }

  private checkedStatus(check: Check): PluginUpdate {
    const latest = check.latestVersion;
    if (check.githubConfigured && this.isMigrationTarget(latest)) {
      return { status: "migration", currentVersion: this.currentVersion, latestVersion: latest, storeInstalled: check.storeInstalled };
    }
    const newer = compareReleaseVersions(latest, this.currentVersion) > 0;
    return { status: newer ? "available" : "current", currentVersion: this.currentVersion, latestVersion: latest };
  }

  private isFresh(cache: Cache): boolean {
    if (cache.state === "unchecked" || cache.checkedAt <= 0) return false;
    const age = this.now() - cache.checkedAt;
    const interval = cache.state === "failed" ? failedCheckIntervalMs : checkIntervalMs;
    return age >= 0 && age < interval;
  }

  private async readCache(): Promise<Cache> {
    try {
      const text = await readFile(this.cachePath, "utf8");
      const data: unknown = JSON.parse(text);
      const stored = cacheSchema.parse(data);
      return fromStored(stored);
    } catch { return { state: "unchecked" }; }
  }

  private async loadCache(): Promise<Cache> {
    const stored = await this.readCache();
    const last = this.last;
    if (last === undefined || stored.state !== "unchecked" && stored.checkedAt >= last.checkedAt) return stored;
    return last;
  }

  private async saveCache(cache: SavedCache) {
    const directory = dirname(this.cachePath);
    const id = randomUUID();
    const temporary = `${this.cachePath}.${id}.tmp`;
    try {
      await mkdir(directory, { recursive: true });
      const stored = toStored(cache);
      const text = JSON.stringify(stored);
      await writeFile(temporary, text, { mode: 0o600 });
      await rename(temporary, this.cachePath);
    } catch {
      throw new PluginUpdateError("Could not save the update status. Check free disk space and try again.", "cache-write");
    } finally { await rm(temporary, { force: true }); }
  }

  private async catalog(): Promise<Catalog> {
    const plugins = this.run(["plugin", "list", "--available", "--json"]);
    const store = this.readStore();
    const results = await Promise.all([plugins, store]);
    const catalog = pluginsSchema.parse(results[0]);
    const summary = storeSummarySchema.parse(results[1]);
    return { ...catalog, store: summary };
  }

  private async storeInstalled(catalog: Catalog): Promise<boolean> {
    const entry = catalog.store;
    const version = entry.localVersion;
    if (entry.installed === false || entry.enabled === false || version === null) return false;
    if (this.isMigrationTarget(version) === false) return false;
    const path = join(this.profile, "plugins/cache", STORE_MARKETPLACE, "mobile-dev", version, ".codex-plugin/plugin.json");
    try {
      const text = await readFile(path, "utf8");
      const data: unknown = JSON.parse(text);
      const manifest = manifestSchema.parse(data);
      return manifest.version === version;
    } catch { return false; }
  }

  check(): Promise<PluginUpdate> {
    if (this.enabled === false) return Promise.resolve({ status: "disabled", currentVersion: this.currentVersion });
    if (this.migrating !== undefined) return this.migrating;
    if (this.checking !== undefined) return this.checking;
    const checking = this.checkLatest();
    this.checking = checking.finally(() => { this.checking = undefined; });
    return this.checking;
  }

  private async checkLatest(): Promise<PluginUpdate> {
    const cache = await this.loadCache();
    const status = this.status(cache);
    if (status.status === "migrated" || this.isFresh(cache)) return status;
    const startedAt = performance.now();
    const checkedAt = this.now();
    let next: SavedCache;
    try {
      const catalog = await this.catalog();
      const storeInstalled = await this.storeInstalled(catalog);
      next = { state: "checked", checkedAt, latestVersion: catalog.store.version, githubConfigured: githubConfigured(catalog), storeInstalled };
    } catch { next = { state: "failed", checkedAt, previous: knownCache(cache) }; }
    this.last = next;
    try { await this.saveCache(next); }
    catch {
      const error = new Error("Could not save the plugin update check.");
      captureServerError(error, "plugin.update.cache");
    }
    const update = this.status(next);
    const elapsed = performance.now() - startedAt;
    recordPluginUpdate("check", update.status, elapsed);
    return update;
  }

  migrate(): Promise<PluginUpdate> {
    if (this.enabled === false) {
      const error = new Error("Development builds do not migrate public plugin installations.");
      return Promise.reject(error);
    }
    if (this.migrating !== undefined) return this.migrating;
    const migrating = this.migrateToStore();
    this.migrating = migrating.finally(() => { this.migrating = undefined; });
    return this.migrating;
  }

  private async migrateToStore(): Promise<PluginUpdate> {
    const startedAt = performance.now();
    let step: MigrationStep = "catalog";
    try {
      if (this.checking !== undefined) await this.checking;
      const catalog = await this.catalog();
      const version = catalog.store.version;
      const installed = this.isMigrationTarget(version) && await this.storeInstalled(catalog);
      if (installed === false) {
        throw new ExpectedOperationError("app_unavailable", "Install and enable the latest Mobile Dev version from the plugin store, then finish migration here.");
      }
      step = "remove-plugin";
      const installedPlugins = catalog.installed.filter(plugin => plugin.installed);
      if (hasGithubRelease(installedPlugins)) {
        const result = await this.run(["plugin", "remove", githubPlugin, "--json"]);
        const removed = removedSchema.parse(result);
        if (removed.pluginId !== githubPlugin) throw new PluginUpdateError("Codex did not remove the GitHub installation. Try again.", "not-removed");
      }
      step = "remove-marketplace";
      const marketplaces = await this.run(["plugin", "marketplace", "list", "--json"]);
      const marketplaceResult = marketplaceSchema.parse(marketplaces);
      const marketplace = marketplaceResult.marketplaces.find(item => item.name === "mobile-dev");
      if (marketplace !== undefined) {
        const source = marketplace.marketplaceSource;
        if (source?.sourceType !== "git" || isReleaseRepository(source.source) === false) {
          throw new PluginUpdateError("The mobile-dev marketplace belongs to another source and cannot be removed here.", "foreign-marketplace");
        }
        const result = await this.run(["plugin", "marketplace", "remove", "mobile-dev", "--json"]);
        const removed = removedMarketplaceSchema.parse(result);
        if (removed.marketplaceName !== "mobile-dev") throw new PluginUpdateError("Codex did not remove the GitHub marketplace. Try again.", "not-removed");
      }
      step = "verify";
      const verified = await this.catalog();
      if (githubConfigured(verified) || await this.storeInstalled(verified) === false) {
        throw new PluginUpdateError("Could not verify the store migration. Try again.", "not-verified");
      }
      const installedVersion = releaseVersionSchema.parse(verified.store.localVersion);
      const cache: SavedCache = { state: "migrated", checkedAt: this.now(), latestVersion: version, githubConfigured: false, storeInstalled: true, migratedVersion: installedVersion };
      step = "save";
      await this.saveCache(cache);
      this.last = cache;
      const elapsed = performance.now() - startedAt;
      recordPluginUpdate("migrate", "migrated", elapsed);
      return { status: "migrated", currentVersion: this.currentVersion, latestVersion: installedVersion, storeInstalled: true };
    } catch (error) {
      const elapsed = performance.now() - startedAt;
      recordPluginUpdate("migrate", "failed", elapsed);
      if (error instanceof ExpectedOperationError) throw error;
      const telemetryError = new Error("The plugin store migration failed.");
      Sentry.withScope(scope => {
        scope.setTags({ plugin_update_step: step, plugin_update_failure: updateFailure(error) });
        captureServerError(telemetryError, "plugin.update.migrate");
      });
      if (error instanceof PluginUpdateError) throw error;
      throw new Error("Could not verify the Mobile Dev migration. Try again.");
    }
  }

  close() { this.abort.abort(); }
}
