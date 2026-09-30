import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CpuApp } from "../../shared/cpu.ts";
import { adbPath } from "../native-logs.ts";

const execute = promisify(execFile);

export function parseRunningApps(output: string): CpuApp[] {
  const apps: CpuApp[] = [];
  for (const line of output.split("\n")) {
    const match = /^\s*(\d+)\s+-?\d+\s+UIKitApplication:([^\[\s]+)\[/.exec(line);
    if (match === null || match[2].startsWith("com.apple.")) continue;
    const pid = Number(match[1]);
    if (Number.isSafeInteger(pid) && pid > 0) apps.push({ bundleId: match[2], pid });
  }
  return apps;
}

export async function runningSimulatorApps(deviceId: string, signal?: AbortSignal): Promise<CpuApp[]> {
  if (process.platform !== "darwin") throw new Error("iOS CPU monitoring requires macOS and Xcode.");
  const result = await execute("xcrun", ["simctl", "spawn", deviceId, "launchctl", "list"], { timeout: 5000, maxBuffer: 1024 * 1024, signal });
  return parseRunningApps(result.stdout);
}

export function parseAndroidApps(packages: string, processes: string): CpuApp[] {
  const installed = new Set<string>();
  for (const line of packages.split("\n")) {
    const match = /^package:([a-zA-Z0-9._-]+)\s*$/.exec(line);
    if (match) installed.add(match[1]);
  }
  const apps: CpuApp[] = [];
  for (const line of processes.split("\n")) {
    const match = /^\s*(\d+)\s+([a-zA-Z0-9._-]+)\s*$/.exec(line);
    if (match === null || installed.has(match[2]) === false) continue;
    const pid = Number(match[1]);
    if (Number.isSafeInteger(pid) && pid > 0) apps.push({ bundleId: match[2], pid });
  }
  return apps;
}

const packageLists = new Map<string, { expires: number; output: string }>();
export async function runningCpuApps(deviceId: string, signal?: AbortSignal, platform: "ios" | "android" = "ios"): Promise<CpuApp[]> {
  if (platform === "ios") return runningSimulatorApps(deviceId, signal);
  const adb = await adbPath();
  let packages = packageLists.get(deviceId);
  if (packages === undefined || packages.expires < Date.now()) {
    const result = await execute(adb, ["-s", deviceId, "shell", "pm", "list", "packages", "-3"], { signal, timeout: 5000, maxBuffer: 1024 * 1024 });
    packages = { expires: Date.now() + 30000, output: result.stdout };
    packageLists.set(deviceId, packages);
  }
  const processes = await execute(adb, ["-s", deviceId, "shell", "ps", "-A", "-o", "PID,NAME"], { signal, timeout: 5000, maxBuffer: 1024 * 1024 });
  return parseAndroidApps(packages.output, processes.stdout);
}
