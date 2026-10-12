import { execFile } from "node:child_process";
import { access, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { adbPath } from "./native-logs.ts";
import { androidIdSchema } from "./serve-emu.ts";
import { readDeviceApps } from "./device-apps/sources.ts";
import { runningDeviceApps } from "./device-apps/apps.ts";
import { foregroundAndroidPackage } from "./device-apps/foreground.ts";
import { captureServerError } from "./telemetry.ts";
import { errorMessage, udidSchema } from "../shared/protocol.ts";
import { ExpectedOperationError, expectedOutcome } from "../shared/error-reporting.ts";
import { appPermissions, appTargetShape, appUrlSchema, bundleIdSchema, permissionStates, platformPermissions } from "../shared/app-control.ts";
import type { AppIcon, AppPermission, AppPermissionEntry, InstalledApp, InstalledApps, PermissionState } from "../shared/app-control.ts";

export type AppTarget = { platform: "ios" | "android"; deviceId: string };
type CommandOptions = { timeout: number; input?: string; maxBuffer?: number };
export type CommandRunner = (file: string, args: string[], options: CommandOptions) => Promise<{ stdout: string; stderr: string }>;
export type BinaryRunner = (file: string, args: string[], options: { timeout: number }) => Promise<Buffer>;

const runCommand: CommandRunner = (file, args, { timeout, input, maxBuffer = 8 * 1024 * 1024 }) => new Promise((resolve, reject) => {
  const child = execFile(file, args, { encoding: "utf8", timeout, maxBuffer }, (error, stdout, stderr) => {
    if (error) reject(Object.assign(error, { stdout, stderr }));
    else resolve({ stdout, stderr });
  });
  if (input !== undefined) child.stdin?.end(input);
});

const runBinary: BinaryRunner = (file, args, { timeout }) => new Promise((resolve, reject) => {
  execFile(file, args, { encoding: "buffer", timeout, maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => {
    if (error) reject(error);
    else resolve(stdout);
  });
});

async function mapLimit<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await work(items[next++]);
  }));
}

let aapt2: Promise<string | null> | undefined;
// aapt2 ships with the Android SDK build tools; use the newest installed version.
function findAapt2(): Promise<string | null> {
  return aapt2 ??= (async () => {
    for (const root of [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, join(homedir(), "Library/Android/sdk")]) {
      if (!root) continue;
      const versions = await readdir(join(root, "build-tools")).catch(() => []);
      versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      for (const version of versions) {
        const path = join(root, "build-tools", version, "aapt2");
        if (await access(path).then(() => true, () => false)) return path;
      }
    }
    return null;
  })();
}

function commandOutput(error: unknown): string {
  if (error === null || typeof error !== "object") return String(error);
  const stderr = "stderr" in error && typeof error.stderr === "string" ? error.stderr : "";
  const stdout = "stdout" in error && typeof error.stdout === "string" ? error.stdout : "";
  return `${stderr}\n${stdout}`.trim();
}

const unavailable = /current state: Shutdown|not booted|Invalid device|device offline|device unauthorized|device '.*' not found|no devices\/emulators found/i;

// Keep only the readable simctl or adb lines; "Command failed: ..." repeats every argument.
function commandError(error: unknown, action: string): Error {
  if (expectedOutcome(error) !== undefined) return error as Error;
  const output = commandOutput(error);
  const message = output.split("\n").map(line => line.trim()).filter(line => line && !/^Underlying error|^An error was encountered/.test(line)).slice(0, 3).join(" ");
  const text = `${action} failed${message ? `: ${message}` : "."}`;
  if (unavailable.test(output)) return new ExpectedOperationError("device_unavailable", text);
  if (error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT") return new ExpectedOperationError("unsupported_platform", `${action} needs ${process.platform === "darwin" ? "Xcode or the Android SDK" : "macOS and Xcode"}.`);
  return new Error(text, { cause: error });
}

function shellQuote(value: string) { return `'${value.replaceAll("'", "'\\''")}'`; }

export function parseSimulatorApps(json: string): InstalledApp[] {
  const record = z.record(z.string(), z.object({ ApplicationType: z.string().optional(), CFBundleIdentifier: z.string().optional(), CFBundleDisplayName: z.string().optional(), CFBundleName: z.string().optional() }).loose()).parse(JSON.parse(json));
  const apps: InstalledApp[] = [];
  for (const [key, app] of Object.entries(record)) {
    if (app.ApplicationType !== "User") continue;
    const bundleId = bundleIdSchema.safeParse(app.CFBundleIdentifier ?? key);
    if (bundleId.success) apps.push({ bundleId: bundleId.data, name: app.CFBundleDisplayName || app.CFBundleName || bundleId.data });
  }
  return apps.sort((a, b) => a.name.localeCompare(b.name));
}

export function parseSimulatorAppPaths(json: string): Map<string, string> {
  const record = z.record(z.string(), z.object({ CFBundleIdentifier: z.string().optional(), Path: z.string().optional() }).loose()).parse(JSON.parse(json));
  return new Map(Object.entries(record).flatMap(([key, app]) => app.Path ? [[app.CFBundleIdentifier ?? key, app.Path] as const] : []));
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
    if (/^\s+resource 0x[0-9a-f]+ /.test(line)) { current = []; blocks.push(current); continue; }
    if (/^\s*(?:type|Package) /.test(line)) { current = undefined; continue; }
    const file = /^\s+\(([^)]*)\) \(file\) (\S+)/.exec(line);
    if (current && file) current.push({ config: file[1], path: file[2] });
  }
  const entries = blocks.find(block => block.some(entry => entry.path === iconPath)) ?? [{ config: "", path: iconPath }];
  const rank = (config: string) => densities[/\b(ldpi|mdpi|tvdpi|hdpi|xhdpi|xxhdpi|xxxhdpi)\b/.exec(config)?.[1] ?? ""] ?? 0;
  const rasters = entries.filter(entry => /\.(?:png|webp)$/i.test(entry.path)).sort((a, b) => rank(b.config) - rank(a.config));
  return rasters[0]?.path ?? null;
}

export function parseAndroidPackages(output: string): InstalledApp[] {
  const apps: InstalledApp[] = [];
  for (const line of output.split("\n")) {
    const match = /^package:([A-Za-z0-9._-]+)\s*$/.exec(line);
    if (match) apps.push({ bundleId: match[1], name: match[1] });
  }
  return apps.sort((a, b) => a.bundleId.localeCompare(b.bundleId));
}

export function parseLauncherActivity(output: string, bundleId: string): string | null {
  const lines = output.split("\n").map(line => line.trim()).filter(Boolean);
  const component = lines.at(-1);
  return component && component.startsWith(`${bundleId}/`) && /^[A-Za-z0-9._-]+\/[A-Za-z0-9._$]+$/.test(component) ? component : null;
}

// Sign-in, payment, and social SDKs register redirect schemes that are not app screens.
const sdkScheme = /^fb\d+$|^com\.googleusercontent\.apps\.|auth|^stripe|^link-popup$|^msal|^db-|^twitterkit-|^pdk\d|^vk\d|^tiktok/i;
const maxLinks = 5;

// Own short schemes first, then web links, then bundle-ID-style schemes that SDKs and dev clients add.
export function rankAppLinks(links: string[]): string[] {
  const rank = (link: string) => /^https?:/.test(link) ? 1 : /^[^:]*[.+][^:]*:/.test(link) ? 2 : 0;
  const unique = [...new Set(links)].filter(link => !sdkScheme.test(link.slice(0, link.indexOf(":"))));
  return unique.map((link, index) => ({ link, index })).sort((a, b) => rank(a.link) - rank(b.link) || a.index - b.index).slice(0, maxLinks).map(entry => entry.link);
}

export function parseIosUrlSchemes(json: string): string[] {
  const types = z.array(z.object({ CFBundleURLSchemes: z.array(z.string()).optional() }).loose()).safeParse(JSON.parse(json));
  if (!types.success) return [];
  return rankAppLinks(types.data.flatMap(type => type.CFBundleURLSchemes ?? []).filter(scheme => /^[A-Za-z][A-Za-z0-9+.-]*$/.test(scheme)).map(scheme => `${scheme}://`));
}

export function parseAndroidAppLinks(output: string, bundleId: string): string[] {
  const table = output.slice(output.indexOf("Activity Resolver Table:"), output.indexOf("Receiver Resolver Table:") >= 0 ? output.indexOf("Receiver Resolver Table:") : undefined);
  type Filter = { own: boolean; view: boolean; browsable: boolean; schemes: string[]; hosts: string[]; paths: string[] };
  const filters = new Map<string, Filter>();
  let current: Filter | undefined;
  for (const line of table.split("\n")) {
    const header = /^\s+[0-9a-f]+ ([A-Za-z0-9._]+)\/(\S+) filter ([0-9a-f]+)\s*$/.exec(line);
    if (header) {
      // Filters repeat once per scheme they declare; read each one once.
      current = filters.has(header[3]) ? undefined : { own: header[1] === bundleId && (header[2].startsWith(".") || header[2].startsWith(`${bundleId}.`)), view: false, browsable: false, schemes: [], hosts: [], paths: [] };
      if (current) filters.set(header[3], current);
      continue;
    }
    if (!current) continue;
    const field = /^\s+(Action|Category|Scheme|Authority|Path): "([^"]*)"/.exec(line);
    if (!field) continue;
    if (field[1] === "Action" && field[2] === "android.intent.action.VIEW") current.view = true;
    else if (field[1] === "Category" && field[2] === "android.intent.category.BROWSABLE") current.browsable = true;
    else if (field[1] === "Scheme") current.schemes.push(field[2]);
    else if (field[1] === "Authority" && /^[A-Za-z0-9.-]+$/.test(field[2])) current.hosts.push(field[2]);
    else if (field[1] === "Path") {
      const path = /^PatternMatcher\{(?:LITERAL|PREFIX): (\/[^}*]*)\}$/.exec(field[2]);
      if (path && path[1] !== "/") current.paths.push(path[1]);
    }
  }
  const links: string[] = [];
  for (const filter of filters.values()) {
    if (!filter.own || !filter.view || !filter.browsable) continue;
    for (const scheme of filter.schemes) {
      if (!/^[A-Za-z][A-Za-z0-9+.-]*$/.test(scheme)) continue;
      if (filter.hosts.length === 0) { if (!/^https?$/.test(scheme)) links.push(`${scheme}://`); continue; }
      for (const host of [...new Set(filter.hosts)].slice(0, 2)) links.push(`${scheme}://${host}${filter.paths[0] ?? "/"}`);
    }
  }
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
    if (section === false) continue;
    const match = /^\s+([A-Za-z0-9_.]+): granted=(true|false)(?:, flags=\[([^\]]*)\])?/.exec(line);
    // Only the first user's runtime permission block describes the foreground user.
    if (match === null) { if (permissions.size > 0) break; section = false; continue; }
    permissions.set(match[1], { granted: match[2] === "true", userFixed: /\bUSER_FIXED\b/.test(match[3] ?? "") });
  }
  return permissions;
}

const androidGroups: Record<AppPermission, readonly string[]> = {
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

export function androidPermissionStates(runtime: Map<string, RuntimePermission>): AppPermissionEntry[] {
  const entries: AppPermissionEntry[] = [];
  for (const permission of platformPermissions.android) {
    const states = androidGroups[permission].flatMap(name => runtime.get(`android.permission.${name}`) ?? []);
    if (states.length === 0) continue;
    const state: PermissionState = states.some(entry => entry.granted) ? "allow" : states.some(entry => entry.userFixed) ? "deny" : "ask";
    entries.push({ permission, state });
  }
  return entries;
}

// Baguette cannot read the foreground app on every simulator runtime; callers then fall back to running apps.
async function simulatorForeground(deviceId: string): Promise<string | null> {
  return (await readDeviceApps(deviceId, undefined, "ios")).foregroundApp?.bundleId ?? null;
}

export class AppControl {
  private readonly run: CommandRunner;
  private readonly adb: () => Promise<string>;
  private readonly foreground: (target: AppTarget) => Promise<string | null>;
  private readonly running: (target: AppTarget) => Promise<{ bundleId: string; pid: number }[]>;
  private readonly readBinary: BinaryRunner;
  private readonly aapt2: () => Promise<string | null>;
  // Keyed by bundle path and Info.plist time on iOS, and by APK path on Android, so reinstalls refresh.
  private readonly iconCache = new Map<string, AppIcon>();

  constructor(options: { run?: CommandRunner; readBinary?: BinaryRunner; aapt2?: () => Promise<string | null>; adb?: () => Promise<string>; foreground?: (target: AppTarget) => Promise<string | null>; running?: (target: AppTarget) => Promise<{ bundleId: string; pid: number }[]> } = {}) {
    this.running = options.running ?? (target => runningDeviceApps(target.deviceId, undefined, target.platform));
    this.run = options.run ?? runCommand;
    this.readBinary = options.readBinary ?? runBinary;
    this.aapt2 = options.aapt2 ?? findAapt2;
    this.adb = options.adb ?? adbPath;
    this.foreground = options.foreground ?? (target => target.platform === "android" ? foregroundAndroidPackage(target.deviceId) : simulatorForeground(target.deviceId));
  }

  private target(target: AppTarget): AppTarget {
    if (target.platform === "android") {
      if (androidIdSchema.safeParse(target.deviceId).success === false || target.deviceId.startsWith("avd:")) throw new ExpectedOperationError("invalid_input", "Choose a running Android device serial.");
      return target;
    }
    if (udidSchema.safeParse(target.deviceId).success === false) throw new ExpectedOperationError("invalid_input", "App tools support iOS simulators and Android devices. Pass an iOS simulator UDID.");
    if (process.platform !== "darwin") throw new ExpectedOperationError("unsupported_platform", "iOS simulators require macOS and Xcode.");
    return target;
  }

  private async simctl(action: string, args: string[], options: Partial<CommandOptions> = {}) {
    try { return await this.run("xcrun", ["simctl", ...args], { timeout: 30000, ...options }); }
    catch (error) { throw commandError(error, action); }
  }

  private async shell(action: string, deviceId: string, command: string, timeout = 15000) {
    const adb = await this.adb();
    // am and pm report rejected intents and permissions on stdout, sometimes with exit status 0.
    const rejected = (output: string) => {
      const failure = /^(?:Error: |Exception occurred while executing)[^\n]*/m.exec(output) ?? /^Error[^\n]*/m.exec(output);
      return failure ? new ExpectedOperationError("invalid_input", `${action} failed: ${failure[0]}`) : undefined;
    };
    let result: { stdout: string; stderr: string };
    try { result = await this.run(adb, ["-s", deviceId, "shell", command], { timeout }); }
    catch (error) { throw rejected(commandOutput(error)) ?? commandError(error, action); }
    const failure = rejected(result.stdout);
    if (failure) throw failure;
    return result.stdout;
  }

  async apps(input: AppTarget): Promise<InstalledApps> {
    const target = this.target(input);
    const foreground = this.foreground(target).catch(() => null);
    const running = this.running(target).catch(() => []);
    let apps: InstalledApp[];
    if (target.platform === "ios") {
      apps = parseSimulatorApps(await this.simulatorListing(target.deviceId));
    } else apps = parseAndroidPackages(await this.shell("Listing apps", target.deviceId, "pm list packages -3"));
    const bundleId = await foreground;
    const installed = new Set(apps.map(app => app.bundleId));
    // Higher PIDs started later, so the first entry is the most recently launched app.
    const runningBundleIds = [...new Set((await running).sort((a, b) => b.pid - a.pid).map(app => app.bundleId))].filter(id => installed.has(id));
    return { apps, foregroundBundleId: bundleId !== null && installed.has(bundleId) ? bundleId : null, runningBundleIds };
  }

  private async simulatorListing(deviceId: string) {
    const listing = await this.simctl("Listing apps", ["listapps", deviceId]);
    try { return (await this.run("plutil", ["-convert", "json", "-o", "-", "-"], { timeout: 10000, input: listing.stdout })).stdout; }
    catch (error) { throw commandError(error, "Reading the app list"); }
  }

  // Icons are best effort: an app without a readable icon keeps its initial in the panel.
  async icons(input: AppTarget, bundleIds?: string[]): Promise<{ apps: Record<string, AppIcon> }> {
    const target = this.target(input);
    const apps: Record<string, AppIcon> = {};
    const collect = async (ids: readonly string[], read: (bundleId: string) => Promise<AppIcon>) => mapLimit(ids, 3, async bundleId => {
      const icon = await read(bundleId).catch((): AppIcon => ({}));
      if (icon.icon || icon.name) apps[bundleId] = icon;
    });
    if (target.platform === "ios") {
      const listing = await this.simulatorListing(target.deviceId);
      const paths = parseSimulatorAppPaths(listing);
      await collect(bundleIds ?? parseSimulatorApps(listing).map(app => app.bundleId), async bundleId => {
        const path = paths.get(bundleId);
        return path ? this.simulatorIcon(path) : {};
      });
      return { apps };
    }
    const aapt2 = await this.aapt2();
    if (!aapt2) return { apps };
    const ids = bundleIds ?? parseAndroidPackages(await this.shell("Listing apps", target.deviceId, "pm list packages -3")).map(app => app.bundleId);
    await collect(ids, bundleId => this.androidIcon(target.deviceId, bundleId, aapt2));
    return { apps };
  }

  private async cached(key: string, read: () => Promise<AppIcon>) {
    const hit = this.iconCache.get(key);
    if (hit) return hit;
    const icon = await read();
    if (this.iconCache.size >= 200) this.iconCache.delete(this.iconCache.keys().next().value!);
    this.iconCache.set(key, icon);
    return icon;
  }

  private async pngDataUrl(source: string, directory: string) {
    const output = join(directory, "icon-64.png");
    await this.run("sips", ["-s", "format", "png", "-Z", "64", source, "--out", output], { timeout: 10000 });
    return `data:image/png;base64,${(await readFile(output)).toString("base64")}`;
  }

  private async simulatorIcon(bundlePath: string): Promise<AppIcon> {
    const plist = join(bundlePath, "Info.plist");
    const info = await stat(plist);
    return this.cached(`ios:${bundlePath}:${info.mtimeMs}`, async () => {
      const icons = await this.run("plutil", ["-extract", "CFBundleIcons", "json", "-o", "-", plist], { timeout: 10000 }).catch(() => undefined);
      const names = z.object({ CFBundlePrimaryIcon: z.object({ CFBundleIconFiles: z.array(z.string()).optional() }).loose().optional() }).loose()
        .safeParse(icons ? JSON.parse(icons.stdout) : {}).data?.CFBundlePrimaryIcon?.CFBundleIconFiles ?? [];
      if (names.length === 0) return {};
      const files = (await readdir(bundlePath)).filter(file => file.endsWith(".png") && names.some(name => file.startsWith(name)));
      const sized = await Promise.all(files.map(async file => ({ file, size: (await stat(join(bundlePath, file))).size })));
      const largest = sized.sort((a, b) => b.size - a.size)[0];
      if (!largest) return {};
      const directory = await mkdtemp(join(tmpdir(), "mobile-dev-icon-"));
      try { return { icon: await this.pngDataUrl(join(bundlePath, largest.file), directory) }; }
      finally { await rm(directory, { recursive: true, force: true }); }
    });
  }

  // Reads only the manifest, resource table, and icon from the device instead of pulling the whole APK.
  private async androidIcon(deviceId: string, bundleId: string, aapt2: string): Promise<AppIcon> {
    const paths = await this.shell("Finding the app package", deviceId, `pm path ${bundleId}`);
    const apk = paths.split("\n").map(line => line.trim().replace(/^package:/, "")).find(line => line.endsWith("base.apk")) ?? paths.trim().replace(/^package:/, "").split("\n")[0];
    if (!apk || !/^\/[\w./~=+-]+\.apk$/.test(apk)) return {};
    return this.cached(`android:${deviceId}:${apk}`, async () => {
      const adb = await this.adb();
      const entry = (name: string) => this.readBinary(adb, ["-s", deviceId, "exec-out", "unzip", "-p", apk, name], { timeout: 20000 });
      const directory = await mkdtemp(join(tmpdir(), "mobile-dev-icon-"));
      try {
        const [manifest, resources] = await Promise.all([entry("AndroidManifest.xml"), entry("resources.arsc")]);
        await Promise.all([writeFile(join(directory, "AndroidManifest.xml"), manifest), writeFile(join(directory, "resources.arsc"), resources)]);
        const partial = join(directory, "partial.apk");
        await this.run("zip", ["-q", "-0", "-j", partial, join(directory, "AndroidManifest.xml"), join(directory, "resources.arsc")], { timeout: 10000 });
        const badging = parseAndroidBadging((await this.run(aapt2, ["dump", "badging", partial], { timeout: 15000 })).stdout);
        const name = badging.label ?? undefined;
        if (!badging.icon) return { name };
        const table = await this.run(aapt2, ["dump", "resources", partial], { timeout: 15000, maxBuffer: 64 * 1024 * 1024 });
        const file = pickAndroidIconFile(table.stdout, badging.icon);
        if (!file) return { name };
        const source = join(directory, `icon${file.slice(file.lastIndexOf("."))}`);
        await writeFile(source, await entry(file));
        return { name, icon: await this.pngDataUrl(source, directory) };
      } finally { await rm(directory, { recursive: true, force: true }); }
    });
  }

  async launch(input: AppTarget, bundleId: string) {
    const target = this.target(input);
    if (target.platform === "ios") {
      try { await this.simctl("Launching the app", ["launch", "--terminate-running-process", target.deviceId, bundleId]); }
      catch (error) {
        if (/FBSOpenApplicationServiceErrorDomain/.test(commandOutput((error as Error).cause))) throw new ExpectedOperationError("invalid_input", `${bundleId} is not installed or could not open.`);
        throw error;
      }
      return { launched: bundleId };
    }
    // Some emulators only resolve launcher activities when direct-boot matching is explicit.
    const resolved = await this.shell("Finding the launch activity", target.deviceId, `cmd package resolve-activity --brief --query-flags 0x000C0000 -a android.intent.action.MAIN -c android.intent.category.LAUNCHER ${bundleId}`);
    const component = parseLauncherActivity(resolved, bundleId);
    if (component === null) throw new ExpectedOperationError("invalid_input", `${bundleId} is not installed or has no launcher activity.`);
    await this.shell("Launching the app", target.deviceId, `am force-stop ${bundleId} && am start -W -n ${component}`, 30000);
    return { launched: bundleId };
  }

  async stop(input: AppTarget, bundleId: string) {
    const target = this.target(input);
    if (target.platform === "android") await this.shell("Stopping the app", target.deviceId, `am force-stop ${bundleId}`);
    else {
      try { await this.simctl("Stopping the app", ["terminate", target.deviceId, bundleId]); }
      catch (error) { if (!/found nothing to terminate/.test(commandOutput((error as Error).cause))) throw error; }
    }
    return { stopped: bundleId };
  }

  async install(input: AppTarget, bundlePath: string) {
    const target = this.target(input);
    const path = bundlePath.replace(/(.)\/+$/, "$1");
    const extension = target.platform === "ios" ? ".app" : ".apk";
    const info = isAbsolute(path) && path.endsWith(extension) ? await stat(path).catch(() => undefined) : undefined;
    if (info === undefined || (target.platform === "ios" ? !info.isDirectory() : !info.isFile())) {
      throw new ExpectedOperationError("invalid_input", `Pass the absolute path of a built ${extension} ${target.platform === "ios" ? "bundle for the simulator" : "file"}.`);
    }
    if (target.platform === "android") {
      const adb = await this.adb();
      try { await this.run(adb, ["-s", target.deviceId, "install", "-r", path], { timeout: 300000 }); }
      catch (error) { throw commandError(error, "Installing the app"); }
      return { installed: true };
    }
    await this.simctl("Installing the app", ["install", target.deviceId, path], { timeout: 300000 });
    const plist = await this.run("plutil", ["-extract", "CFBundleIdentifier", "raw", "-o", "-", `${path}/Info.plist`], { timeout: 10000 }).catch(() => undefined);
    const bundleId = bundleIdSchema.safeParse(plist?.stdout.trim());
    return { installed: true, ...(bundleId.success ? { bundleId: bundleId.data } : {}) };
  }

  async openUrl(input: AppTarget, url: string) {
    const target = this.target(input);
    if (target.platform === "android") {
      await this.shell("Opening the URL", target.deviceId, `am start -W -a android.intent.action.VIEW -d ${shellQuote(url)}`, 30000);
      return { opened: url };
    }
    try { await this.simctl("Opening the URL", ["openurl", target.deviceId, url]); }
    catch (error) {
      if (/LSApplicationWorkspaceErrorDomain/.test(commandOutput((error as Error).cause))) throw new ExpectedOperationError("invalid_input", "No installed app handles this URL.");
      throw error;
    }
    return { opened: url };
  }

  async links(input: AppTarget, bundleId: string): Promise<{ links: string[] }> {
    const target = this.target(input);
    if (target.platform === "android") return { links: parseAndroidAppLinks(await this.shell("Reading app links", target.deviceId, `dumpsys package ${bundleId}`), bundleId) };
    const container = await this.simctl("Reading app links", ["get_app_container", target.deviceId, bundleId, "app"]).catch(error => {
      throw expectedOutcome(error) === undefined ? new ExpectedOperationError("invalid_input", `${bundleId} is not installed on this simulator.`) : error;
    });
    // Apps without URL types make plutil exit with "No value at that key path".
    const types = await this.run("plutil", ["-extract", "CFBundleURLTypes", "json", "-o", "-", `${container.stdout.trim()}/Info.plist`], { timeout: 10000 }).catch(() => undefined);
    return { links: types ? parseIosUrlSchemes(types.stdout) : [] };
  }

  private async androidRuntime(deviceId: string, bundleId: string) {
    return parseAndroidRuntimePermissions(await this.shell("Reading app permissions", deviceId, `dumpsys package ${bundleId}`));
  }

  async permissions(input: AppTarget, bundleId: string): Promise<{ permissions: AppPermissionEntry[] }> {
    const target = this.target(input);
    // The simulator does not expose privacy decisions through simctl.
    if (target.platform === "ios") return { permissions: platformPermissions.ios.map(permission => ({ permission, state: null })) };
    return { permissions: androidPermissionStates(await this.androidRuntime(target.deviceId, bundleId)) };
  }

  async setPermission(input: AppTarget, bundleId: string, permission: AppPermission | "all", state: PermissionState) {
    const target = this.target(input);
    if (permission !== "all" && !platformPermissions[target.platform].includes(permission)) {
      throw new ExpectedOperationError("invalid_input", `${target.platform === "ios" ? "iOS simulators do" : "Android does"} not support the ${permission} permission here.`);
    }
    if (target.platform === "ios") {
      const action = { allow: "grant", deny: "revoke", ask: "reset" }[state];
      await this.simctl("Changing the permission", ["privacy", target.deviceId, action, permission, bundleId]);
      return { permissions: permission === "all" ? platformPermissions.ios.map(entry => ({ permission: entry, state })) : [{ permission, state }] };
    }
    const runtime = await this.androidRuntime(target.deviceId, bundleId);
    const groups = permission === "all" ? platformPermissions.android : [permission];
    const names = groups.flatMap(group => androidGroups[group].map(name => `android.permission.${name}`)).filter(name => runtime.has(name));
    if (names.length === 0) throw new ExpectedOperationError("invalid_input", permission === "all" ? "The app does not request any supported runtime permissions." : `The app does not request the ${permission} permission.`);
    // USER_FIXED makes a denial final, matching "Don't allow"; clearing it makes Android ask again.
    const commands = names.flatMap(name => state === "allow"
      ? [`pm clear-permission-flags ${bundleId} ${name} user-set user-fixed`, `pm grant ${bundleId} ${name}`]
      : [`pm revoke ${bundleId} ${name}`, `pm ${state === "deny" ? "set" : "clear"}-permission-flags ${bundleId} ${name} user-set user-fixed`]);
    await this.shell("Changing the permission", target.deviceId, commands.join(" && "));
    return { permissions: androidPermissionStates(await this.androidRuntime(target.deviceId, bundleId)) };
  }

  async push(input: AppTarget, bundleId: string, payload: Record<string, unknown>) {
    const target = this.target(input);
    if (target.platform === "android") throw new ExpectedOperationError("unsupported_platform", "Test push notifications are available on iOS simulators. Android needs Firebase Cloud Messaging.");
    const json = JSON.stringify(payload);
    if (Buffer.byteLength(json) > 4096) throw new ExpectedOperationError("invalid_input", "Push payloads must be 4 KB or smaller.");
    try { await this.simctl("Sending the notification", ["push", target.deviceId, bundleId, "-"], { input: json }); }
    catch (error) {
      if (/UNErrorDomain/.test(commandOutput((error as Error).cause))) throw new ExpectedOperationError("invalid_input", `${bundleId} is not installed or cannot receive notifications.`);
      throw error;
    }
    return { sent: true };
  }
}

const bundleId = bundleIdSchema.describe("App bundle ID or Android package name.");
const payloadSchema = z.record(z.string(), z.unknown()).refine(value => typeof value.aps === "object" && value.aps !== null, "Payload needs an aps object.");

export function registerAppControlTools(server: McpServer, control = new AppControl()) {
  const tool = <T extends AppTarget>(name: string, action: string, config: { title: string; description: string; inputSchema: z.ZodRawShape; readOnly?: boolean; destructive?: boolean; model?: boolean },
    handler: (input: T) => Promise<object>) => {
    registerAppTool(server, name, {
      title: config.title, description: config.description, inputSchema: { ...appTargetShape, ...config.inputSchema },
      annotations: { readOnlyHint: config.readOnly ?? false, destructiveHint: config.destructive ?? false, openWorldHint: false },
      _meta: { ui: { visibility: config.model === false ? ["app"] : ["app", "model"] } },
    }, async input => {
      try {
        const result = await handler(input as T);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }], structuredContent: result as Record<string, unknown> };
      } catch (error) {
        // Command output can contain app IDs, URLs, and device serials, so Sentry receives only the action.
        if (expectedOutcome(error) === undefined) captureServerError(new Error(`App ${action} command failed.`), `app_control.${action}`);
        return { isError: true, content: [{ type: "text" as const, text: errorMessage(error) }] };
      }
    });
  };
  const target = "Selected iOS simulator or Android device.";
  tool("mobile_list_apps", "list", { title: "List installed apps", readOnly: true, inputSchema: {},
    description: `List user-installed apps on the ${target} Returns bundle IDs, names, the foreground app, and running apps, most recent first.` },
  input => control.apps(input));
  tool<AppTarget & { bundleId: string }>("mobile_launch_app", "launch", { title: "Launch app", inputSchema: { bundleId },
    description: "Launch an installed app, restarting it if it is already running. Does not build; use the project's build tools first." },
  input => control.launch(input, input.bundleId));
  tool<AppTarget & { bundleId: string }>("mobile_stop_app", "stop", { title: "Stop app", inputSchema: { bundleId },
    description: "Terminate a running app on the device." },
  input => control.stop(input, input.bundleId));
  tool<AppTarget & { path: string }>("mobile_install_app", "install", { title: "Install app", destructive: true,
    inputSchema: { path: z.string().min(1).max(4096).describe("Absolute path to a simulator .app bundle or an .apk.") },
    description: "Install or replace a built app on the device. Build it with the project's tools first." },
  input => control.install(input, input.path));
  tool<AppTarget & { url: string }>("mobile_open_url", "open_url", { title: "Open URL",
    inputSchema: { url: appUrlSchema.describe("Deep link or web URL, such as myapp://checkout.") },
    description: "Open a deep link or URL on the device to jump straight to a screen." },
  input => control.openUrl(input, input.url));
  tool<AppTarget & { bundleIds?: string[] }>("mobile_app_icons", "icons", { title: "Read app icons", readOnly: true, model: false,
    inputSchema: { bundleIds: z.array(bundleIdSchema).max(200).optional() },
    description: "Read small PNG icons for installed apps, plus Android app labels." },
  input => control.icons(input, input.bundleIds));
  tool<AppTarget & { bundleId: string }>("mobile_app_links", "links", { title: "Read app URL schemes", readOnly: true, model: false, inputSchema: { bundleId },
    description: "Read the URL schemes and Android link hosts an app declares, without SDK redirect schemes." },
  input => control.links(input, input.bundleId));
  tool<AppTarget & { bundleId: string }>("mobile_app_permissions", "permissions", { title: "Read app permissions", readOnly: true, model: false, inputSchema: { bundleId },
    description: "Read supported app permissions. Android reports current states; iOS simulators report null." },
  input => control.permissions(input, input.bundleId));
  tool<AppTarget & { bundleId: string; permission: AppPermission | "all"; state: PermissionState }>("mobile_set_app_permission", "permission", { title: "Set app permission",
    inputSchema: { bundleId, permission: z.enum([...appPermissions, "all"]), state: z.enum(permissionStates).describe("allow grants, deny blocks, ask resets so the app prompts again.") },
    description: "Allow, deny, or reset an app permission without the system prompt. iOS simulators lack camera and notifications; Android lacks reminders and motion. Changes may restart the app." },
  input => control.setPermission(input, input.bundleId, input.permission, input.state));
  tool<AppTarget & { bundleId: string; payload: Record<string, unknown> }>("mobile_send_push", "push", { title: "Send test push",
    inputSchema: { bundleId, payload: payloadSchema.describe("APNs payload with an aps object, such as {\"aps\":{\"alert\":\"Hi\"}}.") },
    description: "Send a test push notification to an app on an iOS simulator." },
  input => control.push(input, input.bundleId, input.payload));
}
