import { z } from "zod";

export const contentSizes = ["extra-small", "small", "medium", "large", "extra-large", "extra-extra-large", "extra-extra-extra-large", "accessibility-medium", "accessibility-large", "accessibility-extra-large", "accessibility-extra-extra-large", "accessibility-extra-extra-extra-large"] as const;
// Throttles match Baguette's presets so both platforms simulate the same connection.
export const networkPresets = {
  lte: { latencyMs: 130, bandwidthKbps: 50000 },
  "3g": { latencyMs: 200, bandwidthKbps: 780 },
  edge: { latencyMs: 800, bandwidthKbps: 240 },
} as const;
export type NetworkPreset = keyof typeof networkPresets;
export const networkConditions = ["normal", "lte", "3g", "edge", "offline"] as const satisfies readonly ("normal" | "offline" | NetworkPreset)[];
export type NetworkCondition = typeof networkConditions[number];
export const locationSchema = z.object({ latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180) }).strict();
export const deviceSettingSchema = z.discriminatedUnion("setting", [
  z.object({ setting: z.literal("appearance"), value: z.enum(["light", "dark", "auto"]) }).strict(),
  z.object({ setting: z.literal("contentSize"), value: z.enum(contentSizes) }).strict(),
  z.object({ setting: z.literal("fontScale"), value: z.number().finite().min(0.7).max(2) }).strict(),
  z.object({ setting: z.literal("increaseContrast"), value: z.boolean() }).strict(),
  z.object({ setting: z.literal("orientation"), value: z.enum(["auto", "portrait", "landscape"]) }).strict(),
  z.object({ setting: z.literal("location"), value: locationSchema.nullable() }).strict(),
  z.object({ setting: z.literal("statusBar"), value: z.enum(["clean", "live"]) }).strict(),
  z.object({ setting: z.literal("network"), value: z.enum(networkConditions) }).strict(),
]);
export type DeviceSetting = z.infer<typeof deviceSettingSchema>;
export const deviceSettingsSchema = z.object({
  appearance: z.enum(["light", "dark", "auto"]).optional(),
  contentSize: z.enum(contentSizes).optional(),
  fontScale: z.number().optional(),
  increaseContrast: z.boolean().optional(),
  orientation: z.enum(["auto", "portrait", "landscape"]).optional(),
  location: z.object(locationSchema.shape).nullable().optional(),
  locationSupported: z.boolean(),
  statusBar: z.enum(["clean", "live"]).optional(),
  // "custom" is a throttle set outside this panel; it is shown but never sent.
  network: z.enum([...networkConditions, "custom"] as const).optional(),
  errors: z.array(z.string()).optional(),
});
export type DeviceSettings = z.infer<typeof deviceSettingsSchema>;
