import { z } from "zod";

const platform = z.enum(["ios", "android"]).optional().describe("The task's established platform. Omit when undecided.");
const kind = z.enum(["simulator", "emulator", "physical"]).optional().describe("The requested device kind. Omit when undecided.");
const deviceId = z.string().min(1).max(256).regex(/^[A-Za-z0-9_.:\[\]%-]+$/).optional().describe("An exact device ID from device discovery. Omit to select a matching device automatically.");

export const panelTargetSchema = z.object({ platform, kind, deviceId }).strict().superRefine((target, context) => {
  if (target.platform === "ios" && target.kind === "emulator" || target.platform === "android" && target.kind === "simulator") {
    context.addIssue({ code: "custom", path: ["kind"], message: "Use simulator for iOS or emulator for Android." });
  }
});

export type PanelTarget = z.infer<typeof panelTargetSchema>;

export function panelTargetPlatform(target: PanelTarget): "ios" | "android" | undefined {
  if (target.platform !== undefined) return target.platform;
  if (target.kind === "simulator") return "ios";
  if (target.kind === "emulator") return "android";
}
