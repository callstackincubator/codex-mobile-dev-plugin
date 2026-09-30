import { z } from "zod";

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
  phase: CpuPhase;
  samples: CpuSample[];
  memoryMetric: MemoryMetric;
  error?: string;
};

export type CpuApp = { bundleId: string; pid: number };
const deviceFields = {
  platform: z.enum(["ios", "android"]).default("ios"),
  deviceId: z.string().min(1).max(256).regex(/^[a-zA-Z0-9_.:-]+$/),
};
function checkDevice(device: { platform: string; deviceId: string }, context: z.RefinementCtx) {
  if (device.platform === "ios" && z.uuid().safeParse(device.deviceId).success === false) {
    context.addIssue({ code: "custom", path: ["deviceId"], message: "Expected an iOS simulator UUID." });
  }
  if (device.platform === "android" && device.deviceId.startsWith("avd:")) {
    context.addIssue({ code: "custom", path: ["deviceId"], message: "Choose a running Android device serial." });
  }
}
export const cpuDeviceSchema = z.object(deviceFields).strict().superRefine(checkDevice);
export const cpuTargetSchema = z.object({
  ...deviceFields,
  bundleId: z.string().min(1).max(256).regex(/^[a-zA-Z0-9._-]+$/),
}).strict().superRefine(checkDevice);
export type CpuTarget = z.infer<typeof cpuTargetSchema>;

export const CPU_HISTORY_SECONDS = 150;
export const CPU_MAX_SAMPLES = 600;
