import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { TestingTarget } from "./testing-projects.ts";

const execute = promisify(execFile);

export interface ForegroundTestingTarget { platform: "ios" | "android"; bundleId: string }
export interface DiscoveredTestingTargets { targets: TestingTarget[]; source: "expo-cli" | "static-expo" | "foreground" | "none"; warning?: string }

function expoObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const root = value as Record<string, unknown>;
  const candidate = root.expo && typeof root.expo === "object" && !Array.isArray(root.expo) ? root.expo : root;
  return candidate as Record<string, unknown>;
}

function text(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value.trim() : undefined; }

export function expoTargets(config: unknown): TestingTarget[] {
  const root = expoObject(config);
  if (!root) return [];
  const ios = root.ios && typeof root.ios === "object" ? text((root.ios as Record<string, unknown>).bundleIdentifier) : undefined;
  const android = root.android && typeof root.android === "object" ? text((root.android as Record<string, unknown>).package) : undefined;
  return [
    ...(ios ? [{ name: "ios", platform: "ios", bundleId: ios }] : []),
    ...(android ? [{ name: "android", platform: "android", bundleId: android }] : []),
  ];
}

async function localExpoConfig(projectPath: string): Promise<unknown> {
  const bin = join(projectPath, "node_modules/.bin/expo");
  if (!existsSync(bin)) return;
  const { stdout } = await execute(bin, ["config", "--json", "--type", "public"], {
    cwd: projectPath, timeout: 20_000, maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
  });
  return JSON.parse(stdout);
}

async function staticExpoConfig(projectPath: string): Promise<unknown> {
  for (const name of ["app.json", "app.config.json"]) {
    const source = await readFile(join(projectPath, name), "utf8").catch(() => undefined);
    if (!source) continue;
    try { return JSON.parse(source); } catch { continue; }
  }
  // Dynamic configs must never be executed as a fallback. Expo's common object-literal form can
  // still be read safely: only the two quoted identifier properties are projected, everything
  // else (functions, environment reads and plugins included) is ignored.
  for (const name of ["app.config.ts", "app.config.js", "app.config.mjs", "app.config.cjs"]) {
    const source = await readFile(join(projectPath, name), "utf8").catch(() => undefined);
    if (!source) continue;
    const bundleIdentifier = source.match(/\bbundleIdentifier\s*:\s*["'`]([^"'`]+)["'`]/)?.[1];
    const packageName = source.match(/\bpackage\s*:\s*["'`]([^"'`]+)["'`]/)?.[1];
    if (bundleIdentifier || packageName) return { ios: { bundleIdentifier }, android: { package: packageName } };
  }
}

/** Expo 57 target discovery: local CLI, then non-executing JSON, then the mirrored foreground app. */
export async function discoverTestingTargets(projectPath: string, foreground?: ForegroundTestingTarget): Promise<DiscoveredTestingTargets> {
  try {
    const targets = expoTargets(await localExpoConfig(projectPath));
    if (targets.length) return { targets, source: "expo-cli" };
  } catch (error) {
    const fallback = expoTargets(await staticExpoConfig(projectPath));
    if (fallback.length) return { targets: fallback, source: "static-expo", warning: `Expo CLI config failed; using static JSON (${error instanceof Error ? error.message : String(error)}).` };
  }
  const targets = expoTargets(await staticExpoConfig(projectPath));
  if (targets.length) return { targets, source: "static-expo" };
  if (foreground?.bundleId) return { targets: [{ name: foreground.platform, platform: foreground.platform, bundleId: foreground.bundleId }], source: "foreground",
    warning: "No static Expo app identifier was found; using the foreground app. You can edit it before setup." };
  return { targets: [], source: "none", warning: "No mobile app identifier was found. Open the app in the mirror or enter one in setup." };
}
