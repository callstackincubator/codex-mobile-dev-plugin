import { readFile, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { ExpectedOperationError } from "../../shared/error-reporting.ts";
import type { AppDetails, AppPermission, AppPermissionEntry, InstalledApp, InstalledApps, PermissionState } from "../../shared/app-control.ts";
import type { CommandRunner } from "./commands.ts";

export type RunningApp = { bundleId: string; pid: number };

// One device's apps, reached through simctl or adb. Tools pick the driver; drivers never branch on platform.
export interface AppDriver {
  installed(): Promise<InstalledApp[]>;
  foreground(): Promise<string | null>;
  running(): Promise<RunningApp[]>;
  launch(bundleId: string): Promise<void>;
  stop(bundleId: string): Promise<void>;
  install(path: string): Promise<{ bundleId?: string }>;
  openUrl(url: string): Promise<void>;
  links(bundleId: string): Promise<string[]>;
  details(bundleIds?: string[]): Promise<Record<string, AppDetails>>;
  permissions(bundleId: string): Promise<AppPermissionEntry[]>;
  setPermission(bundleId: string, permission: AppPermission | "all", state: PermissionState): Promise<AppPermissionEntry[]>;
  push(bundleId: string, payload: Record<string, unknown>): Promise<void>;
  // The app's own language, or null when it follows the device. Apps pick it up on their next launch.
  language(bundleId: string): Promise<string | null>;
  setLanguage(bundleId: string, language: string | null): Promise<void>;
}

export async function listApps(driver: AppDriver): Promise<InstalledApps> {
  const [apps, foreground, running] = await Promise.all([driver.installed(), driver.foreground().catch(() => null), driver.running().catch(() => [])]);
  const installed = new Set(apps.map(app => app.bundleId));
  const foregroundBundleId = foreground !== null && installed.has(foreground) ? foreground : null;
  // The foreground app leads, then higher PIDs, which started later.
  const newest = [...running].sort((a, b) => b.pid - a.pid).map(app => app.bundleId);
  const runningBundleIds = [...new Set([...(foregroundBundleId ? [foregroundBundleId] : []), ...newest])].filter(bundleId => installed.has(bundleId));
  return { apps, foregroundBundleId, runningBundleIds };
}

// Simulator builds are .app bundle directories; Android builds are .apk files.
export async function requireArtifact(path: string, extension: ".app" | ".apk", description: string): Promise<string> {
  const trimmed = path.replace(/(.)\/+$/, "$1");
  const info = isAbsolute(trimmed) && trimmed.endsWith(extension) ? await stat(trimmed).catch(() => undefined) : undefined;
  const directory = extension === ".app";
  if (info === undefined || info.isDirectory() !== directory) throw new ExpectedOperationError("invalid_input", `Pass the absolute path of ${description}.`);
  return trimmed;
}

// Sign-in, payment, and social SDKs register redirect schemes that are not app screens.
const sdkScheme = /^fb\d+$|^com\.googleusercontent\.apps\.|auth|^stripe|^link-popup$|^msal|^db-|^twitterkit-|^pdk\d|^vk\d|^tiktok/i;
export const urlSchemePattern = /^[A-Za-z][A-Za-z0-9+.-]*$/;

// Own short schemes first, then web links, then bundle-ID-style schemes that SDKs and dev clients add.
export function rankAppLinks(links: string[]): string[] {
  const rank = (link: string) => /^https?:/.test(link) ? 1 : /^[^:]*[.+][^:]*:/.test(link) ? 2 : 0;
  return [...new Set(links)].filter(link => !sdkScheme.test(link.slice(0, link.indexOf(":"))))
    .map((link, index) => ({ link, index })).sort((a, b) => rank(a.link) - rank(b.link) || a.index - b.index)
    .slice(0, 5).map(entry => entry.link);
}

// Extracted icons are cached by a key that changes on reinstall: the bundle path and Info.plist time, or the APK path.
export class AppDetailsCache {
  private readonly entries = new Map<string, AppDetails>();

  async get(key: string, read: () => Promise<AppDetails>): Promise<AppDetails> {
    const hit = this.entries.get(key);
    if (hit) return hit;
    const details = await read();
    if (this.entries.size >= 200) this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(key, details);
    return details;
  }
}

// Details are best effort: an app without a readable icon keeps its initial in the panel.
export async function collectDetails(bundleIds: readonly string[], read: (bundleId: string) => Promise<AppDetails>): Promise<Record<string, AppDetails>> {
  const results: Record<string, AppDetails> = {};
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(3, bundleIds.length) }, async () => {
    while (next < bundleIds.length) {
      const bundleId = bundleIds[next++];
      const details = await read(bundleId).catch((): AppDetails => ({}));
      if (details.icon || details.name) results[bundleId] = details;
    }
  }));
  return results;
}

export async function pngDataUrl(run: CommandRunner, source: string, directory: string): Promise<string> {
  const output = join(directory, "icon-64.png");
  await run("sips", ["-s", "format", "png", "-Z", "64", source, "--out", output], { timeout: 10000 });
  return `data:image/png;base64,${(await readFile(output)).toString("base64")}`;
}
