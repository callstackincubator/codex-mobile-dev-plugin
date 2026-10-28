import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { SimulatorForeground } from "../device-apps/foreground.ts";
import { runningSimulatorApps } from "../device-apps/apps.ts";
import { ExpectedOperationError, expectedOutcome } from "@mobile-dev/shared/error-reporting.ts";
import { bundleIdSchema, platformPermissions } from "@mobile-dev/shared/app-control.ts";
import type { AppDetails, AppPermission, AppPermissionEntry, InstalledApp, PermissionState } from "@mobile-dev/shared/app-control.ts";
import { commandError, commandOutput, withTemporaryDirectory } from "./commands.ts";
import type { Commands } from "./commands.ts";
import { collectDetails, pngDataUrl, rankAppLinks, requireArtifact, requireSupportedPermission, urlSchemePattern } from "./driver.ts";
import type { AppDetailsCache, AppDriver } from "./driver.ts";

type SimulatorApp = InstalledApp & { path: string };
// Failures simctl reports for a fixable request, mapped to the message the user sees.
type SimctlOptions = { timeout?: number; input?: string; known?: readonly (readonly [RegExp, string])[]; tolerate?: RegExp };

const listingSchema = z.record(z.string(), z.object({
  ApplicationType: z.string().optional(), CFBundleIdentifier: z.string().optional(), CFBundleDisplayName: z.string().optional(), CFBundleName: z.string().optional(), Path: z.string().optional(),
}).loose());

export function parseSimulatorApps(json: string): SimulatorApp[] {
  const apps: SimulatorApp[] = [];
  for (const [key, app] of Object.entries(listingSchema.parse(JSON.parse(json)))) {
    const bundleId = bundleIdSchema.safeParse(app.CFBundleIdentifier ?? key);
    if (app.ApplicationType !== "User" || !bundleId.success) continue;
    apps.push({ bundleId: bundleId.data, name: app.CFBundleDisplayName || app.CFBundleName || bundleId.data, path: app.Path ?? "" });
  }
  return apps.sort((a, b) => a.name.localeCompare(b.name));
}

export function parseIosUrlSchemes(json: string): string[] {
  const types = z.array(z.object({ CFBundleURLSchemes: z.array(z.string()).optional() }).loose()).safeParse(JSON.parse(json));
  return rankAppLinks((types.data ?? []).flatMap(type => type.CFBundleURLSchemes ?? []).filter(scheme => urlSchemePattern.test(scheme)).map(scheme => `${scheme}://`));
}

// defaults prints arrays in the old plist style, quoting only entries with punctuation.
export function parseDefaultsArray(output: string): string[] {
  const body = /^\(\s*([\s\S]*?)\s*\)\s*$/.exec(output.trim())?.[1];
  return body ? body.split(",").map(entry => entry.trim().replace(/^"(.*)"$/, "$1")).filter(Boolean) : [];
}

// iOS reads the app's own AppleLanguages before the device's, like Settings > Apps > Language.
export const iosLocale = (language: string) => language.replaceAll("-", "_");

const iconFilesSchema = z.object({ CFBundlePrimaryIcon: z.object({ CFBundleIconFiles: z.array(z.string()).optional() }).loose().optional() }).loose();

export class SimulatorDriver implements AppDriver {
  private readonly deviceId: string;
  private readonly commands: Commands;
  private readonly cache: AppDetailsCache;
  private readonly foreground: SimulatorForeground;

  constructor(deviceId: string, commands: Commands, cache: AppDetailsCache, foreground: SimulatorForeground) {
    this.deviceId = deviceId;
    this.commands = commands;
    this.cache = cache;
    this.foreground = foreground;
  }

  private async simctl(action: string, args: string[], { timeout = 30000, input, known = [], tolerate }: SimctlOptions = {}) {
    try { return await this.commands.run("xcrun", ["simctl", ...args], { timeout, input }); }
    catch (error) {
      const output = commandOutput(error);
      if (tolerate?.test(output)) return "";
      const failure = commandError(error, action);
      const match = expectedOutcome(failure) === undefined ? known.find(([pattern]) => pattern.test(output)) : undefined;
      throw match ? new ExpectedOperationError("invalid_input", match[1]) : failure;
    }
  }

  private plutil(args: string[], input?: string) { return this.commands.run("plutil", args, { timeout: 10000, input }); }

  private async listing(): Promise<SimulatorApp[]> {
    const listing = await this.simctl("Listing apps", ["listapps", this.deviceId]);
    try { return parseSimulatorApps(await this.plutil(["-convert", "json", "-o", "-", "-"], listing)); }
    catch (error) { throw commandError(error, "Reading the app list"); }
  }

  async installed() { return (await this.listing()).map(({ bundleId, name }) => ({ bundleId, name })); }
  // One launchctl listing names both the running apps and the foreground app's process.
  async activity() {
    const [running, pid] = await Promise.all([runningSimulatorApps(this.deviceId).catch(() => []), this.foreground(this.deviceId).catch(() => null)]);
    return { foreground: running.find(app => app.pid === pid)?.bundleId ?? null, running };
  }

  async launch(bundleId: string) {
    await this.simctl("Launching the app", ["launch", "--terminate-running-process", this.deviceId, bundleId],
      { known: [[/FBSOpenApplicationServiceErrorDomain/, `${bundleId} is not installed or could not open.`]] });
  }

  async stop(bundleId: string) {
    await this.simctl("Stopping the app", ["terminate", this.deviceId, bundleId], { tolerate: /found nothing to terminate/ });
  }

  async install(path: string) {
    const bundle = await requireArtifact(path, ".app", "a built .app bundle for the simulator");
    await this.simctl("Installing the app", ["install", this.deviceId, bundle], { timeout: 300000 });
    const bundleId = bundleIdSchema.safeParse(await this.plutil(["-extract", "CFBundleIdentifier", "raw", "-o", "-", join(bundle, "Info.plist")]).then(id => id.trim(), () => undefined));
    return bundleId.success ? { bundleId: bundleId.data } : {};
  }

  async openUrl(url: string) {
    await this.simctl("Opening the URL", ["openurl", this.deviceId, url], { known: [[/LSApplicationWorkspaceErrorDomain/, "No installed app handles this URL."]] });
  }

  async links(bundleId: string) {
    const container = await this.simctl("Reading app links", ["get_app_container", this.deviceId, bundleId, "app"],
      { known: [[/No such file or directory/, `${bundleId} is not installed on this simulator.`]] });
    // Apps without URL types make plutil exit with "No value at that key path".
    const types = await this.plutil(["-extract", "CFBundleURLTypes", "json", "-o", "-", join(container.trim(), "Info.plist")]).catch(() => undefined);
    return types ? parseIosUrlSchemes(types) : [];
  }

  async details(bundleIds?: string[]) {
    const apps = await this.listing();
    const paths = new Map(apps.map(app => [app.bundleId, app.path]));
    return collectDetails(bundleIds ?? apps.map(app => app.bundleId), async bundleId => {
      const path = paths.get(bundleId);
      return path ? this.icon(path) : {};
    });
  }

  private async icon(bundlePath: string): Promise<AppDetails> {
    const plist = join(bundlePath, "Info.plist");
    return this.cache.get(`ios:${bundlePath}:${(await stat(plist)).mtimeMs}`, async () => {
      const icons = await this.plutil(["-extract", "CFBundleIcons", "json", "-o", "-", plist]).catch(() => "{}");
      const names = iconFilesSchema.safeParse(JSON.parse(icons)).data?.CFBundlePrimaryIcon?.CFBundleIconFiles ?? [];
      const files = (await readdir(bundlePath)).filter(file => file.endsWith(".png") && names.some(name => file.startsWith(name)));
      const sized = await Promise.all(files.map(async file => ({ file, size: (await stat(join(bundlePath, file))).size })));
      const largest = sized.sort((a, b) => b.size - a.size)[0];
      return largest ? { icon: await withTemporaryDirectory(directory => pngDataUrl(this.commands.run, join(bundlePath, largest.file), directory)) } : {};
    });
  }

  // simctl cannot read privacy decisions, so states are unknown until the panel sets them.
  async permissions(): Promise<AppPermissionEntry[]> { return platformPermissions.ios.map(permission => ({ permission, state: null })); }

  async setPermission(bundleId: string, permission: AppPermission | "all", state: PermissionState) {
    requireSupportedPermission("ios", permission);
    const action = { allow: "grant", deny: "revoke", ask: "reset" }[state];
    await this.simctl("Changing the permission", ["privacy", this.deviceId, action, permission, bundleId]);
    return platformPermissions.ios.map(entry => ({ permission: entry, state: permission === "all" || permission === entry ? state : null }));
  }

  private async preferences(bundleId: string) {
    const container = await this.simctl("Finding the app data", ["get_app_container", this.deviceId, bundleId, "data"],
      { known: [[/No such file or directory/, `${bundleId} is not installed on this simulator.`]] });
    return join(container.trim(), "Library/Preferences", bundleId);
  }

  // A missing key or domain means the app follows the device language.
  private defaults(action: string, args: string[]) {
    return this.simctl(action, ["spawn", this.deviceId, "defaults", ...args], { tolerate: /Domain '[^']*' not found|Could not find key/ });
  }

  async language(bundleId: string) {
    const languages = parseDefaultsArray(await this.defaults("Reading the app language", ["read", await this.preferences(bundleId), "AppleLanguages"]));
    return languages[0] ?? null;
  }

  async setLanguage(bundleId: string, language: string | null) {
    const domain = await this.preferences(bundleId);
    // A running app writes its cached preferences back on exit, so it stops first.
    await this.stop(bundleId);
    if (language === null) {
      await this.defaults("Resetting the app language", ["delete", domain, "AppleLanguages"]);
      await this.defaults("Resetting the app language", ["delete", domain, "AppleLocale"]);
      return;
    }
    await this.defaults("Changing the app language", ["write", domain, "AppleLanguages", "-array", language]);
    await this.defaults("Changing the app language", ["write", domain, "AppleLocale", "-string", iosLocale(language)]);
  }

  async push(bundleId: string, payload: Record<string, unknown>) {
    const json = JSON.stringify(payload);
    if (Buffer.byteLength(json) > 4096) throw new ExpectedOperationError("invalid_input", "Push payloads must be 4 KB or smaller.");
    await this.simctl("Sending the notification", ["push", this.deviceId, bundleId, "-"],
      { input: json, known: [[/UNErrorDomain/, `${bundleId} is not installed or cannot receive notifications.`]] });
  }
}
