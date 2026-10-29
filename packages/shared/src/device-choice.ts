import { z } from "zod";
import { deviceRefSchema, requireSimulatorId } from "./device-ref.ts";
import type { PhysicalIosDevice } from "./ios-devices.ts";
import type { Status } from "./protocol.ts";
import { isDeviceActive, isPhysicalIos } from "./devices.ts";

const appName = z.string().trim().min(1).max(128).optional();
const ios = z.literal("ios");
const android = z.literal("android");
const simulator = z.literal("simulator");
const physical = z.literal("physical");
const iosKind = z.union([simulator, physical]);
const androidKind = z.enum(["emulator", "physical"]);

export const deviceChoiceReferenceSchema = z.discriminatedUnion("platform", [
  deviceRefSchema.extend({ platform: ios, kind: iosKind, appName }).strict(),
  deviceRefSchema.extend({ platform: android, kind: androidKind, appName }).strict(),
]).superRefine((device, context) => requireSimulatorId(device, context, "Use a simulator UUID from a device list."));

const message = z.string().trim().min(1).max(1024);
const context = z.string().trim().min(1).max(512).optional();
const selectionMode = z.enum(["single", "multiple"]).default("single");
// Omitted candidates are discovered: every selectable device, running ones first.
const devices = z.array(deviceChoiceReferenceSchema).min(1).max(20).optional();

export const deviceChoiceInputSchema = z.object({ message, context, selectionMode, devices }).strict();
export type DeviceChoiceInput = z.infer<typeof deviceChoiceInputSchema>;
export type DeviceChoiceReference = z.infer<typeof deviceChoiceReferenceSchema>;
export type DeviceChoice = DeviceChoiceReference & { name: string; runtime: string; state: string; transportType?: string; pairingState?: string };

export function simulatorChoices(status: Status): DeviceChoice[] {
  return status.devices.flatMap(device => device.platform === "android" || device.kind === "physical" ? []
    : [{ platform: "ios" as const, kind: "simulator" as const, deviceId: device.udid, name: device.name, runtime: device.runtime, state: device.state }]);
}

export function androidChoices(status: Status): DeviceChoice[] {
  return status.devices.flatMap((device): DeviceChoice[] => {
    if (device.platform !== "android") return [];
    const choice = { platform: "android" as const, deviceId: device.udid, name: device.name, runtime: device.runtime, state: device.state };
    if (device.kind === "physical") return [{ ...choice, kind: "physical" as const, transportType: device.transportType }];
    return [{ ...choice, kind: "emulator" as const }];
  });
}

export function physicalIosChoices(devices: PhysicalIosDevice[]): DeviceChoice[] {
  return devices.map(device => ({
    platform: "ios", kind: "physical", deviceId: device.udid, name: device.name, runtime: device.runtime, state: device.state,
    transportType: device.transportType, pairingState: device.pairingState,
  }));
}

export function isRunningDevice(device: DeviceChoice): boolean {
  return isDeviceActive(device);
}

// The same rule the native form applies before offering a device.
export function isSelectableDevice(device: DeviceChoice): boolean {
  if (isPhysicalIos(device)) return device.state === "connected" && device.pairingState === "paired";
  return device.state === "Booted" || device.state === "Shutdown";
}
