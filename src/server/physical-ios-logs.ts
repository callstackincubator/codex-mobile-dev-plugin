import { ExpectedOperationError } from "../shared/error-reporting.ts";
import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";
import type { NativeLogTarget } from "../shared/logs.ts";
import { listIosDevices } from "./ios-devices.ts";

const execute = promisify(execFile);

export type PhysicalIosLogTarget = Extract<NativeLogTarget, { kind: "physical" }>;

export async function physicalIosLogDevice(udid: string, discover = listIosDevices, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const devices = await discover(signal);
  signal?.throwIfAborted();
  const device = devices.find(device => device.udid === udid);
  if (device === undefined || device.state !== "connected") throw new ExpectedOperationError("device_unavailable", "The selected physical iOS device is no longer connected. Refresh the device list.");
  if (device.pairingState !== "paired") throw new ExpectedOperationError("device_unavailable", "The selected iPhone is not paired. Unlock it and trust this Mac.");
  if (device.transportType !== "wired" && device.transportType !== "localNetwork") throw new ExpectedOperationError("device_unavailable", "The selected iPhone has no supported USB or Wi-Fi connection.");
  return device;
}

const bundledReader = new URL("./ios-logs/mobile-dev-ios-logs", import.meta.url);

async function physicalIosReader(udid: string, signal?: AbortSignal, discover = listIosDevices, helper = bundledReader) {
  if (process.platform !== "darwin") throw new ExpectedOperationError("unsupported_platform", "Physical iOS logs require macOS.");
  const device = await physicalIosLogDevice(udid, discover, signal);
  const command = fileURLToPath(helper);
  try { await access(command, constants.X_OK); }
  catch { throw new Error("The bundled physical iOS log reader is missing. Rebuild and package the plugin."); }
  signal?.throwIfAborted();
  const transport = device.transportType === "localNetwork" ? "network" : "usb";
  return { command, args: ["--device", device.udid, transport] };
}

export async function physicalIosLogCommand(target: PhysicalIosLogTarget, signal?: AbortSignal, discover = listIosDevices, helper = bundledReader) {
  const reader = await physicalIosReader(target.deviceId, signal, discover, helper);
  if (target.process) reader.args.push(target.process);
  return reader;
}

export type PhysicalIosCrashReport = { name: string; modified: number; text: string };
const crashReportLine = z.object({ name: z.string(), modified: z.number(), text: z.string() });

/** Copy the phone's .ips crash reports modified at or after sinceMs, in the phone's clock. */
export async function physicalIosCrashReports(udid: string, sinceMs: number, signal?: AbortSignal, discover = listIosDevices, helper = bundledReader): Promise<PhysicalIosCrashReport[]> {
  const reader = await physicalIosReader(udid, signal, discover, helper);
  const { stdout } = await execute(reader.command, [...reader.args, "--crash-reports", String(Math.max(0, Math.floor(sinceMs)))],
    { timeout: 30000, maxBuffer: 64 * 1024 * 1024, signal });
  const reports: PhysicalIosCrashReport[] = [];
  for (const line of stdout.split("\n")) {
    let value: unknown;
    try { value = JSON.parse(line); } catch { continue; }
    const parsed = crashReportLine.safeParse(value);
    if (parsed.success) reports.push(parsed.data);
  }
  return reports;
}
