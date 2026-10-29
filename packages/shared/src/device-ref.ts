import { z } from "zod";
import { androidIdSchema } from "./android-ids.ts";
import { udidSchema } from "./protocol.ts";

export const platformSchema = z.enum(["ios", "android"]);
// adb serials are the widest device IDs; simulator UUIDs and hardware UDIDs fit the same rule.
export const deviceIdSchema = androidIdSchema;
export const deviceRefSchema = z.object({ platform: platformSchema, deviceId: deviceIdSchema });
export type DeviceRef = z.infer<typeof deviceRefSchema>;

// An iOS reference that is not to physical hardware names a simulator by its UUID.
export function requireSimulatorId(device: { platform: string; kind?: string; deviceId: string }, context: z.RefinementCtx, message: string) {
  if (device.platform !== "ios" || device.kind === "physical") return;
  if (udidSchema.safeParse(device.deviceId).success === false) context.addIssue({ code: "custom", path: ["deviceId"], message });
}

// An iOS simulator or any Android device, for tools that cannot reach physical iPhones.
export const deviceTargetSchema = z.discriminatedUnion("platform", [
  z.object({ platform: z.literal("ios"), id: udidSchema }).strict(),
  z.object({ platform: z.literal("android"), id: androidIdSchema }).strict(),
]);
export type DeviceTarget = z.infer<typeof deviceTargetSchema>;
