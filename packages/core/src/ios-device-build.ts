import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Commands } from "./app-control/commands.ts";

/**
 * A build of the app made for physical devices, found where Xcode and Expo leave them.
 *
 * Only `*-iphoneos` products qualify: a `Debug-iphonesimulator` app has the simulator slice and no
 * provisioning profile, so it cannot run on hardware however it is installed. The newest build whose
 * `CFBundleIdentifier` matches wins. Roots are the project's own `ios/build` (`expo run:ios --device`)
 * and Xcode's DerivedData.
 */

async function modified(path: string): Promise<number> { return (await stat(path).catch(() => undefined))?.mtimeMs ?? 0; }

async function appsIn(directory: string): Promise<string[]> {
  const entries = await readdir(directory).catch(() => [] as string[]);
  return entries.filter(name => name.endsWith(".app")).map(name => join(directory, name));
}

/** The `*-iphoneos` product directories under the build roots. */
export async function deviceProductDirectories(projectPath?: string, home = homedir()): Promise<string[]> {
  const products: string[] = [];
  const productsOf = async (root: string) => {
    for (const configuration of await readdir(root).catch(() => [] as string[])) {
      if (configuration.endsWith("-iphoneos")) products.push(join(root, configuration));
    }
  };
  if (projectPath) await productsOf(join(projectPath, "ios", "build", "Build", "Products"));
  const derived = join(home, "Library", "Developer", "Xcode", "DerivedData");
  for (const project of await readdir(derived).catch(() => [] as string[])) await productsOf(join(derived, project, "Build", "Products"));
  return products;
}

export async function findDeviceBuild(appId: string, commands: Pick<Commands, "run">, projectPath?: string, home?: string): Promise<string | undefined> {
  const candidates: { path: string; time: number }[] = [];
  for (const directory of await deviceProductDirectories(projectPath, home)) {
    for (const app of await appsIn(directory)) candidates.push({ path: app, time: await modified(app) });
  }
  candidates.sort((a, b) => b.time - a.time);
  for (const { path } of candidates) {
    try {
      const identifier = (await commands.run("/usr/bin/plutil", ["-extract", "CFBundleIdentifier", "raw", "-o", "-", join(path, "Info.plist")], { timeout: 5_000 })).trim();
      if (identifier === appId) return path;
    } catch { /* an unreadable bundle is not a match */ }
  }
  return undefined;
}
