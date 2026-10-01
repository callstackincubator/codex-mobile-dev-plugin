import { z } from "zod";

const text = z.string();
const identifier = z.uuid();
const platform = z.literal("ios");
const kind = z.literal("physical");

export const physicalIosDeviceSchema = z.object({
  udid: text,
  coreDeviceId: identifier,
  name: text,
  model: text,
  productType: text,
  state: text,
  runtime: text,
  platform,
  kind,
  transportType: text,
  pairingState: text,
});

export type PhysicalIosDevice = z.infer<typeof physicalIosDeviceSchema>;

export function physicalConnectionLabel(transportType: string): string {
  if (transportType === "wired") return "USB";
  if (transportType === "localNetwork") return "Wi-Fi";
  return transportType;
}
