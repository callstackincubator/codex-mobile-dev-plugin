import { z } from "zod";

const text = z.string();
const identifier = z.uuid();
const platform = z.literal("ios");
const kind = z.literal("physical");
const transportType = text.optional();

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
  transportType,
  pairingState: text,
});

export type PhysicalIosDevice = z.infer<typeof physicalIosDeviceSchema>;

export function physicalConnectionLabel(transportType: string | undefined): string {
  if (transportType === undefined) return "Transport not reported";
  if (transportType === "wired") return "USB";
  if (transportType === "localNetwork") return "Wi-Fi";
  return transportType;
}
