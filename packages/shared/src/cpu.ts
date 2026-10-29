import { z } from "zod";
import { deviceRefSchema, platformSchema, requireSimulatorId } from "./device-ref.ts";
import { isStoppedAvd } from "./android-ids.ts";

export type CpuPoint = { time: number; value: number | null };
export type CpuSample = {
  time: number;
  interval: number;
  cpuPercent: number | null;
  memoryBytes: number | null;
  threads: Array<{ id: string; name: string; cpuPercent: number | null }>;
};
export type CpuPhase = "idle" | "connecting" | "recording" | "stopping" | "stopped" | "failed";
export type MemoryMetric = "rss" | "physical-footprint";
export type CpuBatch = {
  cursor: number;
  timeOrigin?: number;
  phase: CpuPhase;
  samples: CpuSample[];
  memoryMetric: MemoryMetric;
  error?: string;
};

const deviceKinds = z.enum(["simulator", "physical"]);
const device = deviceRefSchema.extend({ platform: platformSchema.default("ios"), kind: deviceKinds.optional() });
function checkDevice(device: { platform: string; deviceId: string; kind?: string }, context: z.RefinementCtx) {
  requireSimulatorId(device, context, "Expected an iOS simulator UUID, or kind: physical with a hardware UDID.");
  if (device.platform === "android" && device.kind !== undefined) {
    context.addIssue({ code: "custom", path: ["kind"], message: "Device kind is only used for iOS performance targets." });
  }
  if (device.platform === "android" && isStoppedAvd(device.deviceId)) {
    context.addIssue({ code: "custom", path: ["deviceId"], message: "Choose a running Android device serial." });
  }
}
export const cpuDeviceSchema = device.strict().superRefine(checkDevice);
export const cpuTargetSchema = device.extend({
  bundleId: z.string().min(1).max(256).regex(/^[a-zA-Z0-9._-]+$/),
}).strict().superRefine(checkDevice);
export type CpuTarget = z.infer<typeof cpuTargetSchema>;

export const CPU_HISTORY_SECONDS = 150;
export const CPU_MAX_SAMPLES = 600;
