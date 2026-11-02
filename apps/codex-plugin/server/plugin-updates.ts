import { execFile } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as Sentry from "@sentry/node";
import { compareReleaseVersions, PLUGIN_STORE_ID, pluginUpdateSchema, releaseVersionSchema, STORE_MIGRATION_VERSION } from "../shared/plugin-updates.ts";
import type { PluginUpdate } from "../shared/plugin-updates.ts";
import { PLUGIN_VERSION } from "@mobile-dev/shared/version.ts";
import { ExpectedOperationError } from "@mobile-dev/shared/error-reporting.ts";
import { captureServerError } from "@mobile-dev/core/telemetry.ts";
import { resolveTelemetryEnvironment } from "@mobile-dev/core/telemetry-environment.ts";

export function recordPluginUpdate(operation: "check" | "migrate", outcome: "disabled" | "unavailable" | "current" | "available" | "migration" | "migrated" | "failed", duration: number, failure?: UpdateFailure | "unknown") {
  if (process.env.MOBILE_DEV_TELEMETRY === "off") return;
  const attributes: Record<string, string> = { component: "server", operation, outcome };
  if (failure !== undefined) attributes.failure = failure;
  Sentry.metrics.count("plugin.update.operations", 1, { attributes });
  Sentry.metrics.gauge("plugin.update.duration", duration, { unit: "millisecond", attributes });
}

const execute = promisify(execFile);
const repositories = ["callstackincubator/codex-mobile-dev-plugin", "callstackincubator/mobile-dev"];
const storeMarketplace = "openai-curated-remote";
const githubPlugin = "mobile-dev@mobile-dev";
const storePlugin = "mobile-dev@openai-curated-remote";
const checkIntervalMs = 60 * 60 * 1000;
const failedCheckIntervalMs = 15 * 60 * 1000;
const numberSchema = z.number();
const timestampSchema = numberSchema.nonnegative();
const optionalVersionSchema = releaseVersionSchema.optional();
const booleanSchema = z.boolean();
const storeIdSchema = z.literal(PLUGIN_STORE_ID);
const cacheSchema = z.object({
  source: storeIdSchema, checkedAt: timestampSchema, latestVersion: optionalVersionSchema,
  githubConfigured: booleanSchema, storeInstalled: booleanSchema, migratedVersion: optionalVersionSchema,
});
const pluginNameSchema = z.literal("mobile-dev");
const manifestSchema = z.object({ name: pluginNameSchema, version: releaseVersionSchema });
const textSchema = z.string();
const optionalTextSchema = textSchema.nullish();
const nullableVersionSchema = textSchema.nullable();
const sourceSchema = z.object({ source: textSchema, id: optionalTextSchema });
const marketplaceSourceSchema = z.object({ sourceType: textSchema, source: textSchema });
const optionalSourceSchema = marketplaceSourceSchema.optional();
const pluginSchema = z.object({
  pluginId: textSchema, name: textSchema, marketplaceName: textSchema, version: nullableVersionSchema,
  installed: booleanSchema, enabled: booleanSchema, source: sourceSchema, marketplaceSource: optionalSourceSchema,
});
const pluginsArraySchema = z.array(pluginSchema);
const pluginsSchema = z.object({ installed: pluginsArraySchema, available: pluginsArraySchema });
const marketplaceItemSchema = z.object({ name: textSchema, marketplaceSource: optionalSourceSchema });
const marketplacesArraySchema = z.array(marketplaceItemSchema);
const marketplaceSchema = z.object({ marketplaces: marketplacesArraySchema });
const removedSchema = z.object({ pluginId: textSchema });
const removedMarketplaceSchema = z.object({ marketplaceName: textSchema });
type Cache = z.infer<typeof cacheSchema>;
const storeSummarySchema = z.object({
  remotePluginId: storeIdSchema, name: pluginNameSchema, version: releaseVersionSchema,
});
const publishedReleaseSchema = z.object({ version: releaseVersionSchema });
const enabledStatusSchema = z.literal("ENABLED");
const storeResponseSchema = z.object({ id: storeIdSchema, name: pluginNameSchema, status: enabledStatusSchema, release: publishedReleaseSchema });
export type StorePlugin = z.infer<typeof storeSummarySchema>;
type Catalog = z.infer<typeof pluginsSchema> & { store: StorePlugin & { localVersion: string | null; installed: boolean; enabled: boolean } };
export type ReadStore = () => Promise<unknown>;
export type RunCodex = (args: string[]) => Promise<unknown>;
type UpdateFailure = "codex-not-found" | "command-failed" | "invalid-response" | "store-unavailable" | "foreign-marketplace" | "not-removed" | "not-verified" | "cache-write";
type MigrationStep = "catalog" | "remove-plugin" | "remove-marketplace" | "verify" | "save";
class PluginUpdateError extends Error {
  readonly failure: UpdateFailure;

  constructor(message: string, failure: UpdateFailure) {
    super(message);
    this.failure = failure;
  }
}

function updateFailure(error: unknown): UpdateFailure | "unknown" {
  if (error instanceof PluginUpdateError) return error.failure;
  if (error instanceof z.ZodError) return "invalid-response";
  return "unknown";
}

export async function resolveCodexCli(parentPid = process.ppid, cwd = homedir()): Promise<string> {
  const pid = String(parentPid);
  const result = await execute("/bin/ps", ["-p", pid, "-o", "comm="], { cwd, timeout: 5000, maxBuffer: 4096 });
  const path = result.stdout.trim();
  const absolute = isAbsolute(path);
  const name = basename(path);
  if (absolute === false || name !== "codex") throw new PluginUpdateError("Could not locate the Codex executable that launched Mobile Dev.", "codex-not-found");
  return path;
}

export function createCodexRunner(cwd: string, options: { path?: string; env?: NodeJS.ProcessEnv; signal?: AbortSignal } = {}): RunCodex {
  const environment = options.env ?? process.env;
  const env = { ...environment, GIT_TERMINAL_PROMPT: "0" };
  return async args => {
    const path = options.path ?? await resolveCodexCli(process.ppid, cwd);
    let stdout: string;
    try {
      const result = await execute(path, args, { cwd, timeout: 120000, maxBuffer: 1024 * 1024, env, signal: options.signal });
      stdout = result.stdout;
    } catch {
      throw new PluginUpdateError("Codex could not complete the Mobile Dev update command. Try again.", "command-failed");
    }
    try { return JSON.parse(stdout); }
    catch { throw new PluginUpdateError("Codex returned an invalid update response. Try again.", "invalid-response"); }
  };
}

export async function readPluginStore(options: { fetch?: typeof globalThis.fetch; signal?: AbortSignal } = {}): Promise<StorePlugin> {
  const request = options.fetch ?? globalThis.fetch;
  const timeout = AbortSignal.timeout(20000);
  const signals = [timeout];
  if (options.signal !== undefined) signals.push(options.signal);
  const signal = AbortSignal.any(signals);
  const url = `https://chatgpt.com/backend-api/ps/plugins/${PLUGIN_STORE_ID}`;
  let response: Response;
  try {
    response = await request(url, {
      headers: { Accept: "application/json", "OAI-Product-Sku": "codex" },
      credentials: "omit", redirect: "error", signal,
    });
  } catch {
    throw new PluginUpdateError("Could not read the Codex plugin store catalog.", "store-unavailable");
  }
  if (response.ok === false) {
    await response.body?.cancel();
    throw new PluginUpdateError("Could not read the Codex plugin store catalog.", "store-unavailable");
  }
  try {
    const data: unknown = await response.json();
    const plugin = storeResponseSchema.parse(data);
    return { remotePluginId: plugin.id, name: plugin.name, version: plugin.release.version };
  } catch {
    throw new PluginUpdateError("The plugin store returned an invalid update response.", "invalid-response");
  }
}

function isReleaseRepository(source: string): boolean {
  return repositories.some(repository => source === `https://github.com/${repository}` || source === `https://github.com/${repository}.git`
    || source === `git@github.com:${repository}.git` || source === `ssh://git@github.com/${repository}.git`);
}

function githubInstalled(catalog: Catalog): boolean {
  return catalog.installed.some(plugin => {
    const source = plugin.marketplaceSource;
    return plugin.pluginId === githubPlugin && plugin.installed && source?.sourceType === "git" && isReleaseRepository(source.source);
  });
}

function githubConfigured(catalog: Catalog): boolean {
  const plugins = [...catalog.installed, ...catalog.available];
  return plugins.some(plugin => {
    const source = plugin.marketplaceSource;
    return plugin.pluginId === githubPlugin && source?.sourceType === "git" && isReleaseRepository(source.source);
  });
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
    this.run = options.run ?? createCodexRunner(this.profile, { signal: this.abort.signal });
    this.readStore = options.readStore ?? (() => readPluginStore({ signal: this.abort.signal }));
    this.now = options.now ?? Date.now;
  }

  private emptyCache(): Cache {
    return { source: PLUGIN_STORE_ID, checkedAt: 0, githubConfigured: false, storeInstalled: false };
  }

  private status(cache: Cache): PluginUpdate {
    if (cache.migratedVersion !== undefined && this.runningGithub) {
      return { status: "migrated", currentVersion: this.currentVersion, latestVersion: cache.migratedVersion, storeInstalled: true };
    }
    const latest = cache.latestVersion;
    if (latest === undefined) return { status: "unavailable", currentVersion: this.currentVersion };
    const migrationReady = compareReleaseVersions(latest, STORE_MIGRATION_VERSION) >= 0 && compareReleaseVersions(latest, this.currentVersion) >= 0;
    if (cache.githubConfigured && migrationReady) {
      return { status: "migration", currentVersion: this.currentVersion, latestVersion: latest, storeInstalled: cache.storeInstalled };
    }
    const newer = compareReleaseVersions(latest, this.currentVersion) > 0;
    return { status: newer ? "available" : "current", currentVersion: this.currentVersion, latestVersion: latest };
  }

  private async readCache(): Promise<Cache> {
    try {
      const text = await readFile(this.cachePath, "utf8");
      const data: unknown = JSON.parse(text);
      return cacheSchema.parse(data);
    } catch { return this.emptyCache(); }
  }

  private async saveCache(cache: Cache) {
    const directory = dirname(this.cachePath);
    const id = randomUUID();
    const temporary = `${this.cachePath}.${id}.tmp`;
    try {
      await mkdir(directory, { recursive: true });
      const text = JSON.stringify(cache);
      await writeFile(temporary, text, { mode: 0o600 });
      await rename(temporary, this.cachePath);
    } catch {
      throw new PluginUpdateError("Could not save the update status. Check free disk space and try again.", "cache-write");
    } finally { await rm(temporary, { force: true }); }
  }

  private async catalog(): Promise<Catalog> {
    const plugins = this.run(["plugin", "list", "--marketplace", "mobile-dev", "--available", "--json"]);
    const installed = this.run(["plugin", "list", "--json"]);
    const store = this.readStore();
    const results = await Promise.all([plugins, installed, store]);
    const catalog = pluginsSchema.parse(results[0]);
    const local = pluginsSchema.parse(results[1]);
    const summary = storeSummarySchema.parse(results[2]);
    const entry = local.installed.find(plugin => plugin.pluginId === storePlugin && plugin.name === "mobile-dev"
      && plugin.marketplaceName === storeMarketplace && plugin.source.source === "remote" && plugin.source.id === PLUGIN_STORE_ID);
    const localVersion = entry?.version ?? null;
    if (localVersion !== null) releaseVersionSchema.parse(localVersion);
    return {
      ...catalog,
      store: { ...summary, localVersion, installed: entry?.installed ?? false, enabled: entry?.enabled ?? false },
    };
  }

  private async storeInstalled(catalog: Catalog): Promise<boolean> {
    const entry = catalog.store;
    const version = entry.localVersion;
    if (entry.installed === false || entry.enabled === false || version === null) return false;
    if (compareReleaseVersions(version, STORE_MIGRATION_VERSION) < 0 || compareReleaseVersions(version, this.currentVersion) < 0) return false;
    const path = join(this.profile, "plugins/cache", storeMarketplace, "mobile-dev", version, ".codex-plugin/plugin.json");
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
    const cache = await this.readCache();
    const status = this.status(cache);
    const age = this.now() - cache.checkedAt;
    const interval = cache.latestVersion === undefined ? failedCheckIntervalMs : checkIntervalMs;
    if (status.status === "migrated" || cache.checkedAt > 0 && age >= 0 && age < interval) return status;
    const startedAt = performance.now();
    let failure: UpdateFailure | "unknown" | undefined;
    const next = this.emptyCache();
    next.checkedAt = this.now();
    try {
      const catalog = await this.catalog();
      next.latestVersion = catalog.store.version;
      next.githubConfigured = githubConfigured(catalog);
      next.storeInstalled = await this.storeInstalled(catalog);
    } catch (error) { failure = updateFailure(error); }
    try { await this.saveCache(next); }
    catch {
      const error = new Error("Could not save the plugin update check.");
      captureServerError(error, "plugin.update.cache");
      delete next.latestVersion;
      failure = "cache-write";
    }
    const update = this.status(next);
    const elapsed = performance.now() - startedAt;
    recordPluginUpdate("check", update.status, elapsed, failure);
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
      const ready = compareReleaseVersions(version, STORE_MIGRATION_VERSION) >= 0 && compareReleaseVersions(version, this.currentVersion) >= 0;
      const installed = ready && await this.storeInstalled(catalog);
      if (installed === false) {
        throw new ExpectedOperationError("app_unavailable", "Install and enable the latest Mobile Dev version from the plugin store, then finish migration here.");
      }
      step = "remove-plugin";
      if (githubInstalled(catalog)) {
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
      const cache: Cache = { source: PLUGIN_STORE_ID, checkedAt: this.now(), latestVersion: version, githubConfigured: false, storeInstalled: true, migratedVersion: installedVersion };
      step = "save";
      await this.saveCache(cache);
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

export function registerPluginUpdateTools(server: McpServer, updates: PluginUpdates) {
  const visibility: ("app" | "model")[] = ["app"];
  const metadata = { ui: { visibility } };
  const outputSchema = { update: pluginUpdateSchema };
  registerAppTool(server, "mobile_check_plugin_update", {
    title: "Check Mobile Dev updates", description: "Read the published Mobile Dev version from the Codex plugin store.", inputSchema: {},
    outputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true }, _meta: metadata,
  }, async () => {
    const update = await updates.check();
    return { content: [], structuredContent: { update } };
  });
  registerAppTool(server, "mobile_migrate_plugin_to_store", {
    title: "Finish Mobile Dev store migration", description: "After the user installs Mobile Dev from the plugin store and clicks Finish migration, verify that installation and remove the GitHub plugin and marketplace. Restart Codex afterward.", inputSchema: {},
    outputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true }, _meta: metadata,
  }, async () => {
    try {
      const update = await updates.migrate();
      return { content: [], structuredContent: { update } };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not migrate Mobile Dev. Try again.";
      return { isError: true, content: [{ type: "text", text: message }] };
    }
  });
}
