import { displayFrameTime } from "../shared/display-fps.ts";
import type { DisplayFrame } from "../shared/display-fps.ts";
import type { PerformanceRecording, RecordingRange } from "../shared/recordings.ts";
import { summarizeDisplayFrames } from "../shared/frame-statistics.ts";
import type { DisplayFrameStats } from "../shared/frame-statistics.ts";

export type RecordingDisplayFrame = DisplayFrame & { time: number };
type RecordingFramesPage = {
  recordingId: string; available: boolean; clock: "boottime"; frameCount: number;
  frames: RecordingDisplayFrame[]; nextCursor?: number; frameStats: DisplayFrameStats | null;
};

export function readRecordingFrames(recording: PerformanceRecording, range: RecordingRange | undefined, after: number, limit: number): RecordingFramesPage {
  if (recording.status !== "finished" && recording.status !== "failed") throw new Error("Wait for the recording to finish before paging through display frames.");
  const start = range?.start ?? 0;
  const end = range?.end ?? recording.durationSeconds;
  if (end > recording.durationSeconds) throw new Error("The selected range exceeds this recording's duration.");
  let available = false;
  let frameCount = 0;
  const frames: RecordingDisplayFrame[] = [];
  for (const sample of recording.fps.samples) {
    const timeline = sample.frameTimeline;
    if (timeline === undefined) continue;
    available = true;
    for (const frame of timeline.frames) {
      const time = displayFrameTime(frame, timeline.intervalEndNs, sample.time);
      if (time < start || time >= end) continue;
      if (frameCount >= after && frames.length < limit) frames.push({ ...frame, time });
      frameCount++;
    }
  }
  const cursor = after + frames.length;
  const nextCursor = cursor < frameCount ? cursor : undefined;
  const frameStats = recording.target.platform === "android" ? summarizeDisplayFrames(recording.fps.samples, recording.durationSeconds, range) : null;
  return { recordingId: recording.id, available, clock: "boottime", frameCount, frames, nextCursor, frameStats };
}
