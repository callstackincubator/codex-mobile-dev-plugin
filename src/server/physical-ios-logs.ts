import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import type { NativeLogTarget } from "../shared/logs.ts";
import { listIosDevices } from "./ios-devices.ts";

export type PhysicalIosLogTarget = Extract<NativeLogTarget, { kind: "physical" }>;

export async function physicalIosLogDevice(udid: string, discover = listIosDevices) {
  const devices = await discover();
  const device = devices.find(device => device.udid === udid);
  if (device === undefined || device.state !== "connected") throw new Error("The selected physical iOS device is no longer connected. Refresh the device list.");
  if (device.pairingState !== "paired") throw new Error("The selected iPhone is not paired. Unlock it and trust this Mac.");
  if (device.transportType !== "wired" && device.transportType !== "localNetwork") throw new Error("The selected iPhone has no supported USB or Wi-Fi connection.");
  return device;
}

export async function physicalIosLogCommand(target: PhysicalIosLogTarget, discover = listIosDevices,
  helper = new URL("./ios-logs/mobile-dev-ios-logs", import.meta.url)) {
  if (process.platform !== "darwin") throw new Error("Physical iOS logs require macOS.");
  const device = await physicalIosLogDevice(target.deviceId, discover);
  const command = fileURLToPath(helper);
  try { await access(command, constants.X_OK); }
  catch { throw new Error("The bundled physical iOS log reader is missing. Rebuild and package the plugin."); }
  const transport = device.transportType === "localNetwork" ? "network" : "usb";
  const args = ["--device", device.udid, transport];
  if (target.process) args.push(target.process);
  return { command, args };
}
