import { z } from "zod";
import { deviceIdSchema } from "@mobile-dev/shared/panel-target.ts";

const device = z.object({
  platform: z.enum(["ios", "android"]),
  kind: z.enum(["simulator", "emulator", "physical"]),
  deviceId: deviceIdSchema,
  name: z.string(),
  runtime: z.string(),
  state: z.string(),
  transportType: z.string().optional(),
});
export const panelSelectionSchema = z.object({
  devices: z.array(device),
  activeDeviceId: deviceIdSchema.optional(),
});
export type PanelSelection = z.infer<typeof panelSelectionSchema>;
