import { z } from "zod";
import { deviceRefSchema, platformSchema, requireSimulatorId } from "./device-ref.ts";
import { isStoppedAvd } from "./android-ids.ts";

export type CpuPoint = { time: number; value: number | null };
const percent = z.number().nullable();
export const cpuSampleSchema = z.object({
  time: z.number(),
  interval: z.number(),
  cpuPercent: percent,
  memoryBytes: z.number().nullable(),
  threads: z.array(z.object({ id: z.string(), name: z.string(), cpuPercent: percent })),
});
export type CpuSample = z.infer<typeof cpuSampleSchema>;
export const cpuPhaseSchema = z.enum(["idle", "connecting", "recording", "stopping", "stopped", "failed"]);
export type CpuPhase = z.infer<typeof cpuPhaseSchema>;
const memoryMetricSchema = z.enum(["rss", "physical-footprint"]);
export type MemoryMetric = z.infer<typeof memoryMetricSchema>;
export const cpuBatchSchema = z.object({
  cursor: z.number().int().nonnegative(),
  timeOrigin: z.number().optional(),
  phase: cpuPhaseSchema,
  samples: z.array(cpuSampleSchema),
  memoryMetric: memoryMetricSchema,
  error: z.string().optional(),
});
export type CpuBatch = z.infer<typeof cpuBatchSchema>;

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
