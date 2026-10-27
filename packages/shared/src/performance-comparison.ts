import { z } from "zod";
import { PLUGIN_VERSION } from "./version.ts";
import { recordingIdSchema, recordingRangeSchema, recordingSchema, summarizeRecording } from "./recordings.ts";
import type { PerformanceRecording, RecordingRange } from "./recordings.ts";

export const COMPARISON_URI = `ui://mobile-dev/${PLUGIN_VERSION}/comparison.html`;
const idArray = z.array(recordingIdSchema);
const atLeastTwoIds = idArray.min(2);
const ids = atLeastTwoIds.max(6);
export const comparisonIdsSchema = ids.refine(values => {
  const unique = new Set(values);
  return unique.size === values.length;
}, "Choose distinct recording IDs.");
const title = z.string();
const nonemptyTitle = title.min(1);
export const comparisonTitleSchema = nonemptyTitle.max(160);
const completedRecordingSchema = recordingSchema.refine(recording =>
  recording.status === "finished" || recording.status === "failed",
"Finish each recording before comparing runs.");
const recordingArray = z.array(completedRecordingSchema);
const atLeastTwoRecordings = recordingArray.min(2);
const recordingsSchema = atLeastTwoRecordings.max(6);
const optionalRange = recordingRangeSchema.optional();
const comparisonObject = z.object({
  title: comparisonTitleSchema,
  recordings: recordingsSchema,
  range: optionalRange,
});
export const comparisonSchema = comparisonObject.superRefine((comparison, context) => {
  const ids = comparison.recordings.map(recording => recording.id);
  const distinct = comparisonIdsSchema.safeParse(ids);
  if (distinct.success === false) context.addIssue({ code: "custom", message: "Choose distinct recording IDs." });
  const duration = comparisonDuration(comparison.recordings);
  if (comparison.range !== undefined && comparison.range.end > duration) {
    context.addIssue({ code: "custom", message: "The selected range exceeds the comparison's duration." });
  }
});
export type PerformanceComparison = z.infer<typeof comparisonSchema>;

export function comparisonDuration(recordings: PerformanceRecording[]) {
  let duration = 0;
  for (const recording of recordings) duration = Math.max(duration, recording.durationSeconds);
  return duration;
}

export function summarizeComparison(recordings: PerformanceRecording[], range?: RecordingRange) {
  return recordings.map(recording => {
    const start = range?.start ?? 0;
    const end = Math.min(range?.end ?? recording.durationSeconds, recording.durationSeconds);
    if (start >= end) return { recordingId: recording.id, range: null, summary: null };
    const covered = { start, end };
    const summary = summarizeRecording(recording, covered);
    return { recordingId: recording.id, range: covered, summary };
  });
}
