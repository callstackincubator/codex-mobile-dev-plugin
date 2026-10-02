import test from "node:test";
import assert from "node:assert/strict";
import { readRecordingFrames } from "../src/server/recording-frames.ts";
import { recordingFixture } from "./recording-fixtures.ts";

test("frame pages distinguish unsupported or historical data from a measured idle interval", () => {
  const recording = recordingFixture();
  const historical = readRecordingFrames(recording, undefined, 0, 200);
  assert.equal(historical.available, false);
  assert.equal(historical.frameStats, null);
  assert.deepEqual(historical.frames, []);
  recording.fps.samples[0].frameTimeline = { clock: "boottime", intervalEndNs: "1000000000", frames: [] };
  const idle = readRecordingFrames(recording, undefined, 0, 200);
  assert.equal(idle.available, true);
  assert.equal(idle.frameCount, 0);
  assert.equal(idle.frameStats?.jankRatePercent, null);
  assert.deepEqual(idle.frames, []);
});

test("frame pages use start-inclusive/end-exclusive ranges and only stable completed recordings", () => {
  const recording = recordingFixture();
  recording.fps.samples[0].frameTimeline = { clock: "boottime", intervalEndNs: "1000000000", frames: [
    { token: "1", startTimeNs: "490000000", endTimeNs: "500000000", presentType: 1 },
    { token: "2", startTimeNs: "740000000", endTimeNs: "750000000", presentType: 5 },
  ] };
  const range = { start: 0.5, end: 0.75 };
  const selected = readRecordingFrames(recording, range, 0, 200);
  assert.equal(selected.frameCount, 1);
  assert.equal(selected.frames[0].token, "1");
  assert.equal(selected.frames[0].time, 0.5);
  const pastEnd = readRecordingFrames(recording, range, 100, 200);
  assert.deepEqual(pastEnd.frames, []);
  assert.equal(pastEnd.nextCursor, undefined);
  recording.status = "recording";
  assert.throws(() => readRecordingFrames(recording, range, 0, 200), /finish/);
  recording.status = "failed";
  const partial = readRecordingFrames(recording, range, 0, 200);
  assert.equal(partial.frameCount, 1);
});
