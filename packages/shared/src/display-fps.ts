import { z } from "zod";
import type { CpuPhase } from "./cpu.ts";

export const MAX_DISPLAY_FRAMES_PER_INTERVAL = 4096;
const integerString = z.string();
const boundedIntegerString = integerString.max(20);
export const frameIntegerSchema = boundedIntegerString.regex(/^(0|[1-9][0-9]*)$/);
const integer = z.number();
const wholeInteger = integer.int();
const nonnegativeInteger = wholeInteger.nonnegative();
const metadataInteger = nonnegativeInteger.max(2147483647);
const optionalMetadataInteger = metadataInteger.optional();
const boolean = z.boolean();
const optionalBoolean = boolean.optional();
export const displayFrameSchema = z.object({
  token: frameIntegerSchema,
  startTimeNs: frameIntegerSchema,
  endTimeNs: frameIntegerSchema,
  presentType: metadataInteger,
  onTimeFinish: optionalBoolean,
  gpuComposition: optionalBoolean,
  jankType: optionalMetadataInteger,
  predictionType: optionalMetadataInteger,
  jankSeverityType: optionalMetadataInteger,
});
const displayFrames = z.array(displayFrameSchema);
const boundedDisplayFrames = displayFrames.max(MAX_DISPLAY_FRAMES_PER_INTERVAL);
const frameTimelineClock = z.literal("boottime");
export const frameTimelineSchema = z.object({
  clock: frameTimelineClock,
  intervalEndNs: frameIntegerSchema,
  frames: boundedDisplayFrames,
});
export type DisplayFrame = z.infer<typeof displayFrameSchema>;
export type DisplayFrameTimeline = z.infer<typeof frameTimelineSchema>;
export type DisplayFpsSample = { time: number; interval: number; fps: number | null; frameTimeline?: DisplayFrameTimeline };
export type DisplayFpsBatch = { cursor: number; phase: CpuPhase; samples: DisplayFpsSample[]; error?: string };

export function displayFrameTime(frame: DisplayFrame, intervalEndNs: string, intervalEndTime: number) {
  const end = BigInt(frame.endTimeNs);
  const intervalEnd = BigInt(intervalEndNs);
  const elapsedNs = end - intervalEnd;
  const elapsed = Number(elapsedNs) / 1e9;
  return intervalEndTime + elapsed;
}
const platform = z.enum(["ios", "android"]);
const deviceString = z.string();
const nonemptyDevice = deviceString.min(1);
const boundedDevice = nonemptyDevice.max(256);
const deviceId = boundedDevice.regex(/^[a-zA-Z0-9_.:-]+$/);
const target = z.object({ platform, deviceId });
export const displayFpsTargetSchema = target.strict();
export type DisplayFpsTarget = z.infer<typeof displayFpsTargetSchema>;
