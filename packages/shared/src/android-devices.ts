import { z } from "zod";

export const androidBookingNameSchema = z.string().regex(/^.{1,120}$/su);
export const androidBookingNamesSchema = z.record(z.string(), androidBookingNameSchema);
export type AndroidBookingNames = z.infer<typeof androidBookingNamesSchema>;

export type PhysicalAndroidDevice = {
  udid: string;
  name: string;
  model?: string;
  state: string;
  runtime: string;
  platform: "android";
  kind: "physical";
  transportType: "wired" | "localNetwork";
};
