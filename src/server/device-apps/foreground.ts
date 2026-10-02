import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { adbPath } from "../native-logs.ts";
import type { ForegroundApp } from "../../shared/device-apps.ts";

const execute = promisify(execFile);
const number = z.number();
const integer = number.int();
const positive = integer.positive();
const bounded = positive.max(2147483647);
const pid = bounded.nullable();
const response = z.object({ pid });
const schema = response.strict();

export async function foregroundPhysicalPid(deviceId: string, signal?: AbortSignal,
  helper = new URL("./ios-fps/mobile-dev-ios-fps", import.meta.url)): Promise<number | null> {
  const path = fileURLToPath(helper);
  const result = await execute(path, ["foreground", deviceId], { encoding: "utf8", timeout: 20000, maxBuffer: 4096, signal });
  const decoded: unknown = JSON.parse(result.stdout);
  const foreground = schema.parse(decoded);
  return foreground.pid;
}

export async function foregroundSimulatorPid(deviceId: string, signal?: AbortSignal,
  helper = new URL("./baguette/Baguette", import.meta.url)): Promise<number | null> {
  const path = fileURLToPath(helper);
  const result = await execute(path, ["foreground", "--udid", deviceId], { encoding: "utf8", timeout: 10000, maxBuffer: 4096, signal });
  const decoded: unknown = JSON.parse(result.stdout);
  const foreground = schema.parse(decoded);
  return foreground.pid;
}

export function parseAndroidForegroundPackage(output: string): string | null {
  const top = /^\s*topResumedActivity\s*[:=]\s*(.+)$/gm;
  const resumed = /^\s*mResumedActivity\s*[:=]\s*(.+)$/gm;
  const topMatches = output.matchAll(top);
  const topEntries = Array.from(topMatches);
  const resumedMatches = output.matchAll(resumed);
  const entries = topEntries.length > 0 ? topEntries : Array.from(resumedMatches);
  if (entries.length === 0) throw new Error("Android did not report its resumed activity.");
  const packages = new Set<string>();
  for (const entry of entries) {
    if (entry[1].trim() === "null") continue;
    const component = /\b([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)\/[a-zA-Z0-9_.$]+/.exec(entry[1]);
    if (component === null) throw new Error("Android returned an unsupported resumed activity.");
    packages.add(component[1]);
  }
  if (packages.size > 1) throw new Error("Android reported multiple foreground apps across displays.");
  const packageName = packages.values().next();
  return packageName.value ?? null;
}

export async function foregroundAndroidPackage(deviceId: string, signal?: AbortSignal): Promise<string | null> {
  const adb = await adbPath();
  const result = await execute(adb, ["-s", deviceId, "shell", "dumpsys", "activity", "activities"], {
    encoding: "utf8", timeout: 5000, maxBuffer: 4 * 1024 * 1024, signal,
  });
  return parseAndroidForegroundPackage(result.stdout);
}

export async function foregroundAndroidApp(deviceId: string, signal?: AbortSignal): Promise<ForegroundApp | null> {
  const bundleId = await foregroundAndroidPackage(deviceId, signal);
  if (bundleId === null) return null;
  const adb = await adbPath();
  const result = await execute(adb, ["-s", deviceId, "shell", "pidof", bundleId], {
    encoding: "utf8", timeout: 5000, maxBuffer: 4096, signal,
  });
  const output = result.stdout.trim();
  const candidates = output.split(/\s+/);
  if (candidates.length !== 1) throw new Error("Android did not report one foreground app process.");
  const numeric = /^\d+$/.test(output);
  const value = Number(output);
  const valid = Number.isSafeInteger(value);
  if (numeric === false || valid === false || value < 1 || value > 2147483647) {
    throw new Error("Android returned an invalid foreground app PID.");
  }
  return { bundleId, pid: value };
}
