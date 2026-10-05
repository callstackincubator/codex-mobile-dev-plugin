import { execFile } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { compareReleaseVersions, pluginUpdateSchema, releaseVersionSchema } from "../shared/plugin-updates.ts";
import type { PluginUpdate } from "../shared/plugin-updates.ts";
import { PLUGIN_VERSION } from "../shared/version.ts";
import { captureServerError, recordPluginUpdate } from "./telemetry.ts";
import { resolveTelemetryEnvironment } from "./telemetry-environment.ts";

const execute = promisify(execFile);
const repository = "callstackincubator/codex-mobile-dev-plugin";
const releaseEndpoint = `https://api.github.com/repos/${repository}/releases/latest`;
const marketplaceEndpoint = `https://raw.githubusercontent.com/${repository}/release/latest/plugins/mobile-dev/.codex-plugin/plugin.json`;
const checkIntervalMs = 60 * 60 * 1000;
const failedCheckIntervalMs = 15 * 60 * 1000;
const numberSchema = z.number();
const timestampSchema = numberSchema.nonnegative();
const optionalVersionSchema = releaseVersionSchema.optional();
const cacheSchema = z.object({ checkedAt: timestampSchema, latestVersion: optionalVersionSchema, installedVersion: optionalVersionSchema });
const pluginNameSchema = z.literal("mobile-dev");
const manifestSchema = z.object({ name: pluginNameSchema, version: releaseVersionSchema });
const textSchema = z.string();
const falseSchema = z.literal(false);
const releaseSchema = z.object({ tag_name: textSchema, draft: falseSchema, prerelease: falseSchema });
const sourceSchema = z.object({ sourceType: textSchema, source: textSchema });
const optionalSourceSchema = sourceSchema.optional();
const marketplaceItemSchema = z.object({ name: textSchema, root: textSchema, marketplaceSource: optionalSourceSchema });
const marketplacesSchema = z.array(marketplaceItemSchema);
const marketplaceSchema = z.object({ marketplaces: marketplacesSchema });
const textsSchema = z.array(textSchema);
const unknownSchema = z.unknown();
const errorsSchema = z.array(unknownSchema);
const upgradeSchema = z.object({ selectedMarketplaces: textsSchema, upgradedRoots: textsSchema, errors: errorsSchema });
const booleanSchema = z.boolean();
const installedPluginSchema = z.object({ pluginId: textSchema, version: textSchema, installed: booleanSchema });
const installedPluginsSchema = z.array(installedPluginSchema);
const pluginsSchema = z.object({ installed: installedPluginsSchema });
type Cache = z.infer<typeof cacheSchema>;
export type RunCodex = (args: string[]) => Promise<unknown>;
class PluginUpdateError extends Error {}

export async function resolveCodexCli(parentPid = process.ppid): Promise<string> {
  const pid = String(parentPid);
  const result = await execute("/bin/ps", ["-p", pid, "-o", "comm="], { timeout: 5000, maxBuffer: 4096 });
  const path = result.stdout.trim();
  const absolute = isAbsolute(path);
  const name = basename(path);
  if (absolute === false || name !== "codex") throw new PluginUpdateError("Could not locate the Codex executable that launched Mobile Dev.");
  return path;
}

async function runCodex(args: string[]): Promise<unknown> {
  const path = await resolveCodexCli();
  try {
    const result = await execute(path, args, { timeout: 120000, maxBuffer: 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    return JSON.parse(result.stdout);
  } catch {
    throw new PluginUpdateError("Codex could not update Mobile Dev. Check your network connection and try again.");
  }
}

function isReleaseRepository(source: string): boolean {
  return source === `https://github.com/${repository}` || source === `https://github.com/${repository}.git`
    || source === `git@github.com:${repository}.git` || source === `ssh://git@github.com/${repository}.git`;
}

export class PluginUpdates {
  private readonly enabled: boolean;
  private readonly currentVersion: string;
  private readonly profile: string;
  private readonly cachePath: string;
  private readonly fetch: typeof fetch;
  private readonly run: RunCodex;
  private readonly now: () => number;
  private checking?: Promise<PluginUpdate>;
  private installing?: Promise<PluginUpdate>;
  private readonly abort = new AbortController();

  constructor(options: { enabled?: boolean; currentVersion?: string; profile?: string; fetch?: typeof fetch; run?: RunCodex; now?: () => number } = {}) {
    this.enabled = options.enabled ?? resolveTelemetryEnvironment() === "release";
    this.currentVersion = options.currentVersion ?? PLUGIN_VERSION;
    const home = homedir();
    const defaultProfile = join(home, ".codex");
    this.profile = options.profile ?? process.env.CODEX_HOME ?? defaultProfile;
    this.cachePath = join(this.profile, "mobile-dev", "updates.json");
    this.fetch = options.fetch ?? fetch;
    this.run = options.run ?? runCodex;
    this.now = options.now ?? Date.now;
  }

  private status(cache: Cache): PluginUpdate {
    const installed = cache.installedVersion;
    if (installed !== undefined && compareReleaseVersions(installed, this.currentVersion) > 0) {
      return { status: "updated", currentVersion: this.currentVersion, latestVersion: installed };
    }
    const latest = cache.latestVersion;
    if (latest === undefined) return { status: "unavailable", currentVersion: this.currentVersion };
    const newer = compareReleaseVersions(latest, this.currentVersion) > 0;
    return { status: newer ? "available" : "current", currentVersion: this.currentVersion, latestVersion: latest };
  }

  private async readCache(): Promise<Cache> {
    try {
      const text = await readFile(this.cachePath, "utf8");
      const data: unknown = JSON.parse(text);
      return cacheSchema.parse(data);
    } catch { return { checkedAt: 0 }; }
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
      throw new PluginUpdateError("Could not save the update status. Check free disk space and try again.");
    } finally { await rm(temporary, { force: true }); }
  }

  private async readJson(url: string): Promise<unknown> {
    const timeout = AbortSignal.timeout(10000);
    const signal = AbortSignal.any([timeout, this.abort.signal]);
    const response = await this.fetch(url, { headers: { Accept: "application/vnd.github+json" }, signal, redirect: "error" });
    if (response.ok === false) throw new Error("Could not check for plugin updates.");
    return response.json();
  }

  check(): Promise<PluginUpdate> {
    if (this.enabled === false) return Promise.resolve({ status: "disabled", currentVersion: this.currentVersion });
    if (this.installing !== undefined) return this.installing;
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
    if (status.status === "updated" || cache.checkedAt > 0 && age >= 0 && age < interval) return status;
    const startedAt = performance.now();
    const next: Cache = { checkedAt: this.now(), installedVersion: cache.installedVersion };
    try {
      const releaseData = this.readJson(releaseEndpoint);
      const marketplaceData = this.readJson(marketplaceEndpoint);
      const data = await Promise.all([releaseData, marketplaceData]);
      const release = releaseSchema.parse(data[0]);
      const manifest = manifestSchema.parse(data[1]);
      if (release.tag_name !== `v${manifest.version}`) throw new Error("The latest release is not available in the marketplace yet.");
      next.latestVersion = manifest.version;
    } catch { /* A failed check leaves the workspace usable and retries after the cache expires. */ }
    try { await this.saveCache(next); }
    catch {
      const error = new Error("Could not save the plugin update check.");
      captureServerError(error, "plugin.update.cache");
      delete next.latestVersion;
    }
    const update = this.status(next);
    const elapsed = performance.now() - startedAt;
    recordPluginUpdate("check", update.status, elapsed);
    return update;
  }

  install(): Promise<PluginUpdate> {
    if (this.enabled === false) {
      const error = new Error("Development builds do not install public plugin updates.");
      return Promise.reject(error);
    }
    if (this.installing !== undefined) return this.installing;
    const installing = this.installLatest();
    this.installing = installing.finally(() => { this.installing = undefined; });
    return this.installing;
  }

  private async installLatest(): Promise<PluginUpdate> {
    const startedAt = performance.now();
    try {
      const update = await this.check();
      if (update.status === "updated") return update;
      if (update.status !== "available" || update.latestVersion === undefined) throw new PluginUpdateError("No installable Mobile Dev update is available. Try again later.");
      const listed = await this.run(["plugin", "marketplace", "list", "--json"]);
      const marketplaces = marketplaceSchema.parse(listed);
      const marketplace = marketplaces.marketplaces.find(item => item.name === "mobile-dev");
      const source = marketplace?.marketplaceSource;
      if (marketplace === undefined || source?.sourceType !== "git" || isReleaseRepository(source.source) === false) {
        throw new PluginUpdateError("Mobile Dev must be installed from its public release marketplace to update here.");
      }
      const result = await this.run(["plugin", "marketplace", "upgrade", "mobile-dev", "--json"]);
      const upgrade = upgradeSchema.parse(result);
      const selected = upgrade.selectedMarketplaces.includes("mobile-dev");
      const refreshed = upgrade.upgradedRoots.includes(marketplace.root);
      if (upgrade.errors.length > 0 || selected === false || refreshed === false) {
        throw new PluginUpdateError("Codex could not refresh the Mobile Dev marketplace. Try again.");
      }
      const listedPlugins = await this.run(["plugin", "list", "--json"]);
      const plugins = pluginsSchema.parse(listedPlugins);
      const plugin = plugins.installed.find(item => item.pluginId === "mobile-dev@mobile-dev" && item.installed);
      const installedVersion = releaseVersionSchema.parse(plugin?.version);
      const path = join(this.profile, "plugins/cache/mobile-dev/mobile-dev", installedVersion, ".codex-plugin/plugin.json");
      const text = await readFile(path, "utf8");
      const data: unknown = JSON.parse(text);
      const installed = manifestSchema.parse(data);
      if (installed.version !== installedVersion || compareReleaseVersions(installedVersion, update.latestVersion) < 0) {
        throw new PluginUpdateError("The new Mobile Dev version has not been installed. Try again later.");
      }
      const cache: Cache = { checkedAt: this.now(), latestVersion: installedVersion, installedVersion };
      await this.saveCache(cache);
      const elapsed = performance.now() - startedAt;
      recordPluginUpdate("install", "updated", elapsed);
      return this.status(cache);
    } catch (error) {
      const elapsed = performance.now() - startedAt;
      recordPluginUpdate("install", "failed", elapsed);
      const telemetryError = new Error("The plugin update failed.");
      captureServerError(telemetryError, "plugin.update.install");
      if (error instanceof PluginUpdateError) throw error;
      throw new PluginUpdateError("Could not verify the Mobile Dev update. Try again.");
    }
  }

  close() { this.abort.abort(); }
}

export function registerPluginUpdateTools(server: McpServer, updates: PluginUpdates) {
  const visibility: ("app" | "model")[] = ["app"];
  const metadata = { ui: { visibility } };
  const outputSchema = { update: pluginUpdateSchema };
  registerAppTool(server, "mobile_check_plugin_update", {
    title: "Check Mobile Dev updates", description: "Check for an installable public Mobile Dev release.", inputSchema: {},
    outputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true }, _meta: metadata,
  }, async () => {
    const update = await updates.check();
    return { content: [], structuredContent: { update } };
  });
  registerAppTool(server, "mobile_install_plugin_update", {
    title: "Update Mobile Dev", description: "Install the available Mobile Dev release after the user clicks Update. Codex must be quit and reopened afterward.", inputSchema: {},
    outputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }, _meta: metadata,
  }, async () => {
    try {
      const update = await updates.install();
      return { content: [], structuredContent: { update } };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not update Mobile Dev. Try again.";
      return { isError: true, content: [{ type: "text", text: message }] };
    }
  });
}
