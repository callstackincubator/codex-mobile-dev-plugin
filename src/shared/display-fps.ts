import { z } from "zod";
import type { CpuPhase } from "./cpu.ts";

export type DisplayFpsSample = { time: number; interval: number; fps: number | null };
export type DisplayFpsBatch = { cursor: number; phase: CpuPhase; samples: DisplayFpsSample[]; error?: string };
const platform = z.enum(["ios", "android"]);
const deviceString = z.string();
const nonemptyDevice = deviceString.min(1);
const boundedDevice = nonemptyDevice.max(256);
const deviceId = boundedDevice.regex(/^[a-zA-Z0-9_.:-]+$/);
const target = z.object({ platform, deviceId });
export const displayFpsTargetSchema = target.strict();
export type DisplayFpsTarget = z.infer<typeof displayFpsTargetSchema>;
