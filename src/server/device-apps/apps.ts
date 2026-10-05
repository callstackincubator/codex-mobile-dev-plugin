import { ExpectedOperationError } from "../../shared/error-reporting.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { DeviceApp } from "../../shared/device-apps.ts";
import { adbPath } from "../native-logs.ts";

const execute = promisify(execFile);
type DeviceCommand = (file: string, args: string[], options: { encoding: "utf8"; timeout: number; maxBuffer: number; signal?: AbortSignal }) => Promise<{ stdout: string }>;

const text = z.string();
const number = z.number();
const integer = number.int();
const pid = integer.positive();
const executable = text.optional();
const processEntry = z.object({ executable, processIdentifier: pid });
const processes = z.array(processEntry);
const developerApp = z.boolean();
const application = z.object({ bundleIdentifier: text, url: text, builtByDeveloper: developerApp });
const applications = z.array(application);
const success = z.literal("success");
const info = z.object({ outcome: success });
const processResult = z.object({ runningProcesses: processes });
const processResponse = z.object({ info, result: processResult });
const appResult = z.object({ apps: applications });
const appResponse = z.object({ info, result: appResult });

function devicePath(url: string): string {
  const decoded = fileURLToPath(url);
  const path = decoded.replace(/^\/private\/var\//, "/var/");
  return path.replace(/\/$/, "");
}

export function parsePhysicalApps(apps: string, processes: string): DeviceApp[] {
  const appJson: unknown = JSON.parse(apps);
  const processJson: unknown = JSON.parse(processes);
  const installed = appResponse.parse(appJson);
  const running = processResponse.parse(processJson);
  const bundles = new Map<string, string>();
  for (const app of installed.result.apps) {
    if (app.builtByDeveloper === false || app.bundleIdentifier.startsWith("com.apple.")) continue;
    const path = devicePath(app.url);
    bundles.set(path, app.bundleIdentifier);
  }
  const result: DeviceApp[] = [];
  for (const process of running.result.runningProcesses) {
    if (process.executable === undefined) continue;
    const path = devicePath(process.executable);
    const directory = dirname(path);
    const bundleId = bundles.get(directory);
    if (bundleId) result.push({ bundleId, pid: process.processIdentifier });
  }
  return result;
}

export async function runningPhysicalApps(deviceId: string, signal?: AbortSignal, run: DeviceCommand = execute): Promise<DeviceApp[]> {
  const prefix = ["devicectl", "device", "info"];
  const options = ["--device", deviceId, "--quiet", "--timeout", "10", "--omit-deprecated-fields-in-json", "--json-output", "-"];
  const settings: Parameters<DeviceCommand>[2] = { encoding: "utf8", timeout: 15000, maxBuffer: 4 * 1024 * 1024, signal };
  const installed = run("/usr/bin/xcrun", [...prefix, "apps", "--no-include-default-apps", ...options], settings);
  const running = run("/usr/bin/xcrun", [...prefix, "processes", ...options], settings);
  const results = await Promise.all([installed, running]);
  return parsePhysicalApps(results[0].stdout, results[1].stdout);
}

export function parseRunningApps(output: string): DeviceApp[] {
  const apps: DeviceApp[] = [];
  for (const line of output.split("\n")) {
    const match = /^\s*(\d+)\s+-?\d+\s+UIKitApplication:([^\[\s]+)\[/.exec(line);
    if (match === null || match[2].startsWith("com.apple.")) continue;
    const pid = Number(match[1]);
    if (Number.isSafeInteger(pid) && pid > 0) apps.push({ bundleId: match[2], pid });
  }
  return apps;
}

export async function runningSimulatorApps(deviceId: string, signal?: AbortSignal): Promise<DeviceApp[]> {
  if (process.platform !== "darwin") throw new ExpectedOperationError("unsupported_platform", "iOS CPU monitoring requires macOS and Xcode.");
  const result = await execute("xcrun", ["simctl", "spawn", deviceId, "launchctl", "list"], { timeout: 5000, maxBuffer: 1024 * 1024, signal });
  return parseRunningApps(result.stdout);
}

export function parseAndroidApps(packages: string, processes: string): DeviceApp[] {
  const installed = new Set<string>();
  for (const line of packages.split("\n")) {
    const match = /^package:([a-zA-Z0-9._-]+)\s*$/.exec(line);
    if (match) installed.add(match[1]);
  }
  const apps: DeviceApp[] = [];
  for (const line of processes.split("\n")) {
    const match = /^\s*(\d+)\s+([a-zA-Z0-9._-]+)\s*$/.exec(line);
    if (match === null || installed.has(match[2]) === false) continue;
    const pid = Number(match[1]);
    if (Number.isSafeInteger(pid) && pid > 0) apps.push({ bundleId: match[2], pid });
  }
  return apps;
}

const packageLists = new Map<string, { expires: number; output: string }>();
export async function runningDeviceApps(deviceId: string, signal?: AbortSignal, platform: "ios" | "android" = "ios", kind?: "simulator" | "physical"): Promise<DeviceApp[]> {
  if (platform === "ios" && kind === "physical") return runningPhysicalApps(deviceId, signal);
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
