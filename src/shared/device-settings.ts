import { z } from "zod";

export const contentSizes = ["extra-small", "small", "medium", "large", "extra-large", "extra-extra-large", "extra-extra-extra-large", "accessibility-medium", "accessibility-large", "accessibility-extra-large", "accessibility-extra-extra-large", "accessibility-extra-extra-extra-large"] as const;
export const locationSchema = z.object({ latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180) }).strict();
export const deviceSettingSchema = z.discriminatedUnion("setting", [
  z.object({ setting: z.literal("appearance"), value: z.enum(["light", "dark", "auto"]) }).strict(),
  z.object({ setting: z.literal("contentSize"), value: z.enum(contentSizes) }).strict(),
  z.object({ setting: z.literal("fontScale"), value: z.number().finite().min(0.7).max(2) }).strict(),
  z.object({ setting: z.literal("increaseContrast"), value: z.boolean() }).strict(),
  z.object({ setting: z.literal("orientation"), value: z.enum(["auto", "portrait", "landscape"]) }).strict(),
  z.object({ setting: z.literal("location"), value: locationSchema.nullable() }).strict(),
]);
export type DeviceSetting = z.infer<typeof deviceSettingSchema>;
export type DeviceSettings = {
  appearance?: "light" | "dark" | "auto";
  contentSize?: typeof contentSizes[number];
  fontScale?: number;
  increaseContrast?: boolean;
  orientation?: "auto" | "portrait" | "landscape";
  location?: z.infer<typeof locationSchema> | null;
  locationSupported: boolean;
  errors?: string[];
};
