import { z } from "zod";

export const physicalAndroidDeviceSchema = z.object({
  udid: z.string(),
  name: z.string(),
  model: z.string().optional(),
  state: z.string(),
  runtime: z.string(),
  platform: z.literal("android"),
  kind: z.literal("physical"),
  transportType: z.enum(["wired", "localNetwork"]),
});

export type PhysicalAndroidDevice = z.infer<typeof physicalAndroidDeviceSchema>;
