import { z } from "zod";
import { cpuPhaseSchema } from "./cpu.ts";
import { deviceRefSchema } from "./device-ref.ts";

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
export const displayFpsSampleSchema = z.object({ time: z.number(), interval: z.number(), fps: z.number().nullable(), frameTimeline: frameTimelineSchema.optional() });
export type DisplayFpsSample = z.infer<typeof displayFpsSampleSchema>;
export const displayFpsBatchSchema = z.object({ cursor: z.number().int().nonnegative(), phase: cpuPhaseSchema, samples: z.array(displayFpsSampleSchema), error: z.string().optional() });
export type DisplayFpsBatch = z.infer<typeof displayFpsBatchSchema>;

export function displayFrameTime(frame: DisplayFrame, intervalEndNs: string, intervalEndTime: number) {
  const end = BigInt(frame.endTimeNs);
  const intervalEnd = BigInt(intervalEndNs);
  const elapsedNs = end - intervalEnd;
  const elapsed = Number(elapsedNs) / 1e9;
  return intervalEndTime + elapsed;
}
export const displayFpsTargetSchema = deviceRefSchema.strict();
export type DisplayFpsTarget = z.infer<typeof displayFpsTargetSchema>;
