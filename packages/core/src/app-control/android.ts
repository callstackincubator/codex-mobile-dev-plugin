import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { foregroundAndroidPackage } from "../device-apps/foreground.ts";
import { runningDeviceApps } from "../device-apps/apps.ts";
import { ExpectedOperationError } from "@mobile-dev/shared/error-reporting.ts";
import { annotateDeviceCommand } from "@mobile-dev/shared/device-command-diagnostics.ts";
import { platformPermissions } from "@mobile-dev/shared/app-control.ts";
import type { AppDetails, AppPermission, AppPermissionEntry, InstalledApp, PermissionState } from "@mobile-dev/shared/app-control.ts";
import { commandError, commandLabel, commandOutput, runAdb, withTemporaryDirectory } from "./commands.ts";
import type { Commands } from "./commands.ts";
import { collectDetails, pngDataUrl, rankAppLinks, requireArtifact, requireSupportedPermission, urlSchemePattern } from "./driver.ts";
import type { AppDetailsCache, AppDriver } from "./driver.ts";

export function parseAndroidPackages(output: string): InstalledApp[] {
  return output.split("\n").flatMap(line => {
    const match = /^package:([A-Za-z0-9._-]+)\s*$/.exec(line);
    return match ? [{ bundleId: match[1], name: match[1] }] : [];
  }).sort((a, b) => a.bundleId.localeCompare(b.bundleId));
}

export function parseLauncherActivity(output: string, bundleId: string): string | null {
  const component = output.split("\n").map(line => line.trim()).filter(Boolean).at(-1);
  return component && component.startsWith(`${bundleId}/`) && /^[A-Za-z0-9._-]+\/[A-Za-z0-9._$]+$/.test(component) ? component : null;
}

type IntentFilter = { own: boolean; view: boolean; browsable: boolean; schemes: string[]; hosts: string[]; paths: string[] };

export function parseAndroidAppLinks(output: string, bundleId: string): string[] {
  const start = output.indexOf("Activity Resolver Table:");
  const end = output.indexOf("Receiver Resolver Table:");
  const filters = new Map<string, IntentFilter>();
  let current: IntentFilter | undefined;
  for (const line of output.slice(start, end >= 0 ? end : undefined).split("\n")) {
    const header = /^\s+[0-9a-f]+ ([A-Za-z0-9._]+)\/(\S+) filter ([0-9a-f]+)\s*$/.exec(line);
    if (header) {
      // Filters repeat once per scheme they declare; read each one once. SDK activities are not the app's screens.
      const own = header[1] === bundleId && (header[2].startsWith(".") || header[2].startsWith(`${bundleId}.`));
      current = filters.has(header[3]) ? undefined : { own, view: false, browsable: false, schemes: [], hosts: [], paths: [] };
      if (current) filters.set(header[3], current);
      continue;
    }
    const field = current && /^\s+(Action|Category|Scheme|Authority|Path): "([^"]*)"/.exec(line);
    if (!current || !field) continue;
    const [, kind, value] = field;
    if (kind === "Action") current.view ||= value === "android.intent.action.VIEW";
    else if (kind === "Category") current.browsable ||= value === "android.intent.category.BROWSABLE";
    else if (kind === "Scheme") current.schemes.push(value);
    else if (kind === "Authority" && /^[A-Za-z0-9.-]+$/.test(value)) current.hosts.push(value);
    else if (kind === "Path") {
      const path = /^PatternMatcher\{(?:LITERAL|PREFIX): (\/[^}*]*)\}$/.exec(value)?.[1];
      if (path && path !== "/") current.paths.push(path);
    }
  }
  const links = [...filters.values()].filter(filter => filter.own && filter.view && filter.browsable).flatMap(filter => filter.schemes
    .filter(scheme => urlSchemePattern.test(scheme))
    .flatMap(scheme => filter.hosts.length === 0
      ? /^https?$/.test(scheme) ? [] : [`${scheme}://`]
      : [...new Set(filter.hosts)].slice(0, 2).map(host => `${scheme}://${host}${filter.paths[0] ?? "/"}`)));
  // Web links are listed for both http and https; offer the secure one.
  return rankAppLinks(links.filter(link => !link.startsWith("http://") || !links.includes(link.replace(/^http:/, "https:"))));
}

type RuntimePermission = { granted: boolean; userFixed: boolean };

export function parseAndroidRuntimePermissions(output: string): Map<string, RuntimePermission> {
  if (/^Unable to find package/m.test(output)) throw new ExpectedOperationError("invalid_input", "The app is not installed on this device.");
  const permissions = new Map<string, RuntimePermission>();
  let section = false;
  for (const line of output.split("\n")) {
    if (/^\s*runtime permissions:\s*$/.test(line)) { section = true; continue; }
    if (!section) continue;
    const match = /^\s+([A-Za-z0-9_.]+): granted=(true|false)(?:, flags=\[([^\]]*)\])?/.exec(line);
    // Only the first user's runtime permission block describes the foreground user.
    if (match === null) { if (permissions.size > 0) break; section = false; continue; }
    permissions.set(match[1], { granted: match[2] === "true", userFixed: /\bUSER_FIXED\b/.test(match[3] ?? "") });
  }
  return permissions;
}

const permissionGroups: Record<AppPermission, readonly string[]> = {
  location: ["ACCESS_FINE_LOCATION", "ACCESS_COARSE_LOCATION"],
  photos: ["READ_MEDIA_IMAGES", "READ_MEDIA_VIDEO", "READ_MEDIA_VISUAL_USER_SELECTED", "READ_EXTERNAL_STORAGE"],
  camera: ["CAMERA"],
  microphone: ["RECORD_AUDIO"],
  notifications: ["POST_NOTIFICATIONS"],
  contacts: ["READ_CONTACTS", "WRITE_CONTACTS"],
  calendar: ["READ_CALENDAR", "WRITE_CALENDAR"],
  reminders: [],
  motion: [],
};
const runtimeNames = (permission: AppPermission) => permissionGroups[permission].map(name => `android.permission.${name}`);

export function androidPermissionStates(runtime: Map<string, RuntimePermission>): AppPermissionEntry[] {
  return platformPermissions.android.flatMap(permission => {
    const states = runtimeNames(permission).flatMap(name => runtime.get(name) ?? []);
    if (states.length === 0) return [];
    const state: PermissionState = states.some(entry => entry.granted) ? "allow" : states.some(entry => entry.userFixed) ? "deny" : "ask";
    return [{ permission, state }];
  });
}

export function parseAndroidBadging(output: string): { icon: string | null; label: string | null } {
  const label = /^application-label:'([^']*)'/m.exec(output) ?? /^application: label='([^']*)'/m.exec(output);
  const icon = /^application: .*\bicon='([^']+)'/m.exec(output);
  return { icon: icon?.[1] ?? null, label: label?.[1] || null };
}

const densities: Record<string, number> = { ldpi: 1, mdpi: 2, tvdpi: 3, hdpi: 4, xhdpi: 5, xxhdpi: 6, xxxhdpi: 7 };
// Adaptive launcher icons are XML; the same resource usually keeps raster versions for older Android releases.
export function pickAndroidIconFile(resources: string, iconPath: string): string | null {
  const blocks: { config: string; path: string }[][] = [];
  let current: { config: string; path: string }[] | undefined;
  for (const line of resources.split("\n")) {
    if (/^\s+resource 0x[0-9a-f]+ /.test(line)) blocks.push(current = []);
    else if (/^\s*(?:type|Package) /.test(line)) current = undefined;
    else {
      const file = /^\s+\(([^)]*)\) \(file\) (\S+)/.exec(line);
      if (current && file) current.push({ config: file[1], path: file[2] });
    }
  }
  const entries = blocks.find(block => block.some(entry => entry.path === iconPath)) ?? [{ config: "", path: iconPath }];
  const rank = (config: string) => densities[/\b(ldpi|mdpi|tvdpi|hdpi|xhdpi|xxhdpi|xxxhdpi)\b/.exec(config)?.[1] ?? ""] ?? 0;
  return entries.filter(entry => /\.(?:png|webp)$/i.test(entry.path)).sort((a, b) => rank(b.config) - rank(a.config))[0]?.path ?? null;
}

// Android 12 and older have no locale service. cmd says so with exit status 20, or 0 when chained.
const localeUnavailable = /Can't find service: locale|Unknown command/;

// "Locales for com.example for user 0 are [de-AT,en]"; an empty list follows the device.
export function parseAndroidAppLocales(output: string): string | null {
  if (/Unknown package/.test(output)) throw new ExpectedOperationError("invalid_input", "The app is not installed on this device.");
  if (localeUnavailable.test(output)) throw new ExpectedOperationError("unsupported_platform", "Per-app languages need Android 13 or later.");
  const list = /are \[([^\]]*)\]/.exec(output);
  if (!list) throw annotateDeviceCommand(new Error("Reading the app language failed: unexpected cmd locale output."), "adb_shell_cmd", { failure: "unexpected_output" });
  return list[1].split(",").map(entry => entry.trim()).find(Boolean) ?? null;
}

const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

export class AndroidDriver implements AppDriver {
  private readonly deviceId: string;
  private readonly commands: Commands;
  private readonly cache: AppDetailsCache;

  constructor(deviceId: string, commands: Commands, cache: AppDetailsCache) {
    this.deviceId = deviceId;
    this.commands = commands;
    this.cache = cache;
  }

  // am and pm report rejected intents and permissions on stdout, sometimes with exit status 0.
  // Output matching `tolerate` is returned even when the command fails, for callers that parse it.
  private async shell(action: string, command: string, timeout = 15000, tolerate?: RegExp) {
    const rejected = (output: string) => {
      const failure = /^(?:Error: |Exception occurred while executing)[^\n]*/m.exec(output) ?? /^Error[^\n]*/m.exec(output);
      return failure ? new ExpectedOperationError("invalid_input", `${action} failed: ${failure[0]}`) : undefined;
    };
    let output: string;
    try { output = await this.commands.run(await this.commands.adb(), ["-s", this.deviceId, "shell", command], { timeout }); }
    catch (error) {
      const failed = commandOutput(error);
      if (tolerate?.test(failed)) return failed;
      throw rejected(failed) ?? commandError(error, action, commandLabel("adb_shell", command));
    }
    const failure = rejected(output);
    if (failure) throw failure;
    return output;
  }

  private async runtime(bundleId: string) {
    return parseAndroidRuntimePermissions(await this.shell("Reading app permissions", `dumpsys package ${bundleId}`));
  }

  async installed() { return parseAndroidPackages(await this.shell("Listing apps", "pm list packages -3")); }
  async activity() {
    const [running, foreground] = await Promise.all([runningDeviceApps(this.deviceId, undefined, "android").catch(() => []), foregroundAndroidPackage(this.deviceId).catch(() => null)]);
    return { foreground, running };
  }

  async launch(bundleId: string) {
    // Some emulators only resolve launcher activities when direct-boot matching is explicit.
    const resolved = await this.shell("Finding the launch activity", `cmd package resolve-activity --brief --query-flags 0x000C0000 -a android.intent.action.MAIN -c android.intent.category.LAUNCHER ${bundleId}`);
    const component = parseLauncherActivity(resolved, bundleId);
    if (component === null) throw new ExpectedOperationError("invalid_input", `${bundleId} is not installed or has no launcher activity.`);
    await this.shell("Launching the app", `am force-stop ${bundleId} && am start -W -n ${shellQuote(component)}`, 30000);
  }

  async stop(bundleId: string) { await this.shell("Stopping the app", `am force-stop ${bundleId}`); }

  async install(path: string) {
    const apk = await requireArtifact(path, ".apk", "a built .apk file");
    await runAdb(this.commands, this.deviceId, "Installing the app", ["install", "-r", apk], 300000);
    return {};
  }

  async openUrl(url: string) { await this.shell("Opening the URL", `am start -W -a android.intent.action.VIEW -d ${shellQuote(url)}`, 30000); }

  async links(bundleId: string) { return parseAndroidAppLinks(await this.shell("Reading app links", `dumpsys package ${bundleId}`), bundleId); }

  async details(bundleIds?: string[]) {
    const aapt2 = await this.commands.aapt2();
    if (!aapt2) return {};
    return collectDetails(bundleIds ?? (await this.installed()).map(app => app.bundleId), bundleId => this.appDetails(bundleId, aapt2));
  }

  // Reads only the manifest, resource table, and icon from the device instead of pulling the whole APK.
  private async appDetails(bundleId: string, aapt2: string): Promise<AppDetails> {
    const paths = (await this.shell("Finding the app package", `pm path ${bundleId}`)).split("\n").map(line => line.trim().replace(/^package:/, "")).filter(Boolean);
    const apk = paths.find(path => path.endsWith("base.apk")) ?? paths[0];
    if (!apk || !/^\/[\w./~=+-]+\.apk$/.test(apk)) return {};
    const adb = await this.commands.adb();
    const entry = (name: string) => this.commands.readBinary(adb, ["-s", this.deviceId, "exec-out", "unzip", "-p", apk, name], { timeout: 20000 });
    return this.cache.get(`android:${this.deviceId}:${apk}`, () => withTemporaryDirectory(async directory => {
      const parts = ["AndroidManifest.xml", "resources.arsc"];
      await Promise.all(parts.map(async part => writeFile(join(directory, part), await entry(part))));
      const partial = join(directory, "partial.apk");
      await this.commands.run("zip", ["-q", "-0", "-j", partial, ...parts.map(part => join(directory, part))], { timeout: 10000 });
      const badging = parseAndroidBadging(await this.commands.run(aapt2, ["dump", "badging", partial], { timeout: 15000 }));
      const name = badging.label ?? undefined;
      const file = badging.icon && pickAndroidIconFile(await this.commands.run(aapt2, ["dump", "resources", partial], { timeout: 15000, maxBuffer: 64 * 1024 * 1024 }), badging.icon);
      if (!file) return { name };
      const source = join(directory, `icon${file.slice(file.lastIndexOf("."))}`);
      await writeFile(source, await entry(file));
      return { name, icon: await pngDataUrl(this.commands.run, source, directory) };
    }));
  }

  async permissions(bundleId: string) { return androidPermissionStates(await this.runtime(bundleId)); }

  async setPermission(bundleId: string, permission: AppPermission | "all", state: PermissionState) {
    requireSupportedPermission("android", permission);
    const runtime = await this.runtime(bundleId);
    const names = (permission === "all" ? platformPermissions.android : [permission]).flatMap(runtimeNames).filter(name => runtime.has(name));
    if (names.length === 0) throw new ExpectedOperationError("invalid_input", permission === "all" ? "The app does not request any supported runtime permissions." : `The app does not request the ${permission} permission.`);
    // USER_FIXED makes a denial final, matching "Don't allow"; clearing it makes Android ask again.
    const commands = names.flatMap(name => state === "allow"
      ? [`pm clear-permission-flags ${bundleId} ${name} user-set user-fixed`, `pm grant ${bundleId} ${name}`]
      : [`pm revoke ${bundleId} ${name}`, `pm ${state === "deny" ? "set" : "clear"}-permission-flags ${bundleId} ${name} user-set user-fixed`]);
    await this.shell("Changing the permission", commands.join(" && "));
    return this.permissions(bundleId);
  }

  async language(bundleId: string) { return parseAndroidAppLocales(await this.shell("Reading the app language", `cmd locale get-app-locales ${bundleId}`, 15000, localeUnavailable)); }

  async setLanguage(bundleId: string, language: string | null) {
    // set-app-locales reports an unknown package or missing service on stdout with exit status 0.
    const output = await this.shell("Changing the app language", `cmd locale set-app-locales ${bundleId}${language === null ? "" : ` --locales ${language}`}; cmd locale get-app-locales ${bundleId}`, 15000, localeUnavailable);
    const applied = parseAndroidAppLocales(output);
    if (applied?.toLowerCase() !== language?.toLowerCase()) throw annotateDeviceCommand(new Error("Changing the app language failed: Android kept a different language."), "adb_shell_cmd", { failure: "unexpected_output" });
  }

  async push(): Promise<void> {
    throw new ExpectedOperationError("unsupported_platform", "Test push notifications are available on iOS simulators. Android needs Firebase Cloud Messaging.");
  }
}
