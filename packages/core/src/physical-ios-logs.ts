import { ExpectedOperationError } from "@mobile-dev/shared/error-reporting.ts";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import type { NativeLogTarget } from "@mobile-dev/shared/logs.ts";
import { listIosDevices } from "./ios-devices.ts";
import { requirePhysicalIos } from "./devices.ts";

export type PhysicalIosLogTarget = Extract<NativeLogTarget, { kind: "physical" }>;

export async function physicalIosLogCommand(target: PhysicalIosLogTarget, signal?: AbortSignal, discover = listIosDevices,
  helper = new URL("./ios-logs/mobile-dev-ios-logs", import.meta.url)) {
  if (process.platform !== "darwin") throw new ExpectedOperationError("unsupported_platform", "Physical iOS logs require macOS.");
  signal?.throwIfAborted();
  const devices = await discover(signal);
  signal?.throwIfAborted();
  const device = requirePhysicalIos(devices.find(device => device.udid === target.deviceId), "logs");
  const command = fileURLToPath(helper);
  try { await access(command, constants.X_OK); }
  catch { throw new Error("The bundled physical iOS log reader is missing. Rebuild and package the plugin."); }
  signal?.throwIfAborted();
  const transport = device.transportType === "localNetwork" ? "network" : "usb";
  const args = ["--device", device.udid, transport];
  if (target.process) args.push(target.process);
  return { command, args };
}
