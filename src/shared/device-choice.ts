import { z } from "zod";

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

const message = z.string().trim().min(1).max(1024);
const context = z.string().trim().min(1).max(512).optional();
const selectionMode = z.enum(["single", "multiple"]).default("single");
const devices = z.array(deviceChoiceReferenceSchema).min(1).max(20);

export const deviceChoiceInputSchema = z.object({ message, context, selectionMode, devices }).strict();
export type DeviceChoiceInput = z.infer<typeof deviceChoiceInputSchema>;
export type DeviceChoiceReference = z.infer<typeof deviceChoiceReferenceSchema>;
export type DeviceChoice = DeviceChoiceReference & { name: string; runtime: string; state: string };
