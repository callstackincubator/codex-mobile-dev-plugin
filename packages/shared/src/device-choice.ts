import { z } from "zod";
import type { PhysicalIosDevice } from "./ios-devices.ts";
import type { Status } from "./protocol.ts";
import { isDeviceActive, isPhysicalIos } from "./devices.ts";

const deviceId = z.string().min(1).max(256).regex(/^[a-zA-Z0-9_.:-]+$/);
const appName = z.string().trim().min(1).max(128).optional();
const ios = z.literal("ios");
const android = z.literal("android");
const simulator = z.literal("simulator");
const physical = z.literal("physical");
const iosKind = z.union([simulator, physical]);
const androidKind = z.enum(["emulator", "physical"]);
const simulatorId = z.uuid();

export const deviceChoiceReferenceSchema = z.discriminatedUnion("platform", [
  z.object({ platform: ios, kind: iosKind, deviceId, appName }).strict(),
  z.object({ platform: android, kind: androidKind, deviceId, appName }).strict(),
]).superRefine((device, context) => {
  if (device.platform === "ios" && device.kind === "simulator") {
    const parsed = simulatorId.safeParse(device.deviceId);
    if (parsed.success === false) context.addIssue({ code: "custom", path: ["deviceId"], message: "Use a simulator UUID from a device list." });
  }
});

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
