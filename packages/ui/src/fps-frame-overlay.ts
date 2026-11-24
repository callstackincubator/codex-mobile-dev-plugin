import { displayFrameTime } from "@mobile-dev/shared/display-fps.ts";
import type { DisplayFrame, DisplayFpsSample } from "@mobile-dev/shared/display-fps.ts";
import { classifyDisplayJank } from "@mobile-dev/shared/frame-statistics.ts";
import type { IosHitch, IosHitches } from "@mobile-dev/shared/ios-hitches.ts";
import type { RecordingRange } from "@mobile-dev/shared/recordings.ts";
import type { RecordingPoint } from "./recording-series.ts";

export type AndroidFrameMarker = { time: number; frame: DisplayFrame; label: "Late" | "Dropped" | "Janky" };
export type FpsInterval = RecordingRange & { fps: number; markerCount: number | null };
export type FpsFrameOverlay = {
  samples: FpsInterval[];
  platform: "ios" | "android";
  markers: { event: IosHitch | AndroidFrameMarker; sample?: FpsInterval }[];
};

export function createIosFrameOverlay(capture: IosHitches | undefined, fps: RecordingPoint[]): FpsFrameOverlay | undefined {
  if (capture?.status !== "finished") return;
  const samples: FpsInterval[] = [];
  // The FPS curve contains a start/end pair per clipped interval, including gaps.
  for (let i = 0; i < fps.length; i += 2) {
    const first = fps[i];
    if (first.value === null) continue;
    const end = fps[i + 1].time;
    samples.push({ start: first.time, end, fps: first.value, markerCount: end <= capture.end ? 0 : null });
  }
  let index = 0;
  const markers = capture.events.map(event => {
    while (index < samples.length && samples[index].end <= event.time) index++;
    const sample = samples[index];
    if (sample === undefined || event.time < sample.start) return { event };
    if (sample.markerCount !== null) sample.markerCount++;
    return { event, sample };
  });
  return { platform: "ios", samples, markers };
}

/** Android resolves each display frame into an FPS bucket, including late corrections. */
export function createAndroidFrameOverlay(readings: DisplayFpsSample[], range?: RecordingRange): FpsFrameOverlay | undefined {
  const samples: FpsInterval[] = [];
  const markers: FpsFrameOverlay["markers"] = [];
  let available = false;
  let previousEnd = range?.start ?? -Infinity;
  for (const reading of readings) {
    const start = Math.max(previousEnd, reading.time - reading.interval);
    const end = Math.min(range?.end ?? Infinity, reading.time);
    if (end <= start) continue;
    previousEnd = end;
    const timeline = reading.frameTimeline;
    const sample = reading.fps === null ? undefined : { start, end, fps: reading.fps, markerCount: timeline ? 0 : null };
    if (sample) samples.push(sample);
    if (timeline === undefined) continue;
    available = true;
    for (const frame of timeline.frames) {
      let label: AndroidFrameMarker["label"];
      if (frame.presentType === 4) label = "Dropped";
      else if (frame.presentType === 2) label = "Late";
      else if ((frame.presentType === 1 || frame.presentType === 3) && classifyDisplayJank(frame.jankType) === "janky") label = "Janky";
      else continue;
      const time = displayFrameTime(frame, timeline.intervalEndNs, reading.time);
      if (range && (time < range.start || time >= range.end)) continue;
      const onCurve = time >= start && time < end ? sample : undefined;
      if (onCurve && onCurve.markerCount !== null) onCurve.markerCount++;
      markers.push({ event: { time, frame, label }, sample: onCurve });
    }
  }
  return available ? { platform: "android", markers, samples } : undefined;
}
