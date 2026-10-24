import { z } from "zod";
import { PLUGIN_VERSION } from "./version.ts";
import type { PhysicalIosDevice } from "./ios-devices.ts";
import type { Status } from "./protocol.ts";

export const DEVICES_URI = `ui://mobile-dev/${PLUGIN_VERSION}/devices.html`;

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
    if (parsed.success === false) context.addIssue({ code: "custom", path: ["deviceId"], message: "Use a simulator UUID from mobile_list_simulators." });
  }
});

const message = z.string().trim().min(1).max(1024).optional();
const context = z.string().trim().min(1).max(512).optional();
const selectionMode = z.enum(["single", "multiple"]).optional();
const devices = z.array(deviceChoiceReferenceSchema).min(1).max(20).optional();

export const deviceChoiceInputSchema = z.object({ message, context, selectionMode, devices }).strict().superRefine((input, issues) => {
  if (input.selectionMode !== undefined && input.message === undefined) issues.addIssue({ code: "custom", path: ["message"], message: "Explain the task when asking the user to choose." });
});
export type DeviceChoiceInput = z.infer<typeof deviceChoiceInputSchema>;
export type DeviceChoiceReference = z.infer<typeof deviceChoiceReferenceSchema>;
export type DeviceChoice = DeviceChoiceReference & { name: string; runtime: string; state: string; transportType?: string; pairingState?: string };

const deviceChoiceSchema = z.object({
  platform: z.enum(["ios", "android"]), kind: z.enum(["simulator", "emulator", "physical"]), deviceId: z.string(), appName: z.string().optional(),
  name: z.string(), runtime: z.string(), state: z.string(), transportType: z.string().optional(), pairingState: z.string().optional(),
});
// Browse and card results list devices for the user; a form result carries its outcome instead.
export const devicesViewSchema = z.union([
  z.object({ action: z.enum(["accept", "cancel", "decline"]), devices: z.array(deviceChoiceSchema) }),
  z.object({
    mode: z.enum(["browse", "choose"]), selectionMode: z.enum(["single", "multiple"]).optional(),
    message: z.string().optional(), context: z.string().optional(),
    devices: z.array(deviceChoiceSchema), errors: z.array(z.string()),
  }),
]);
export type DevicesView = z.infer<typeof devicesViewSchema>;

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
  return device.platform === "ios" && device.kind === "physical" ? device.state === "connected" : device.state === "Booted";
}

// The same rule the native form applies before offering a device.
export function isSelectableDevice(device: DeviceChoice): boolean {
  if (device.platform === "ios" && device.kind === "physical") return device.state === "connected" && device.pairingState === "paired";
  return device.state === "Booted" || device.state === "Shutdown";
}
