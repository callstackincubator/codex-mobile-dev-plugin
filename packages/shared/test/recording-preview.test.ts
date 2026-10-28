import test from "node:test";
import assert from "node:assert/strict";
import { recordingPreview, recordingSchema } from "../src/recordings.ts";
import { longestRecordingFixture, recordingWithFramesFixture } from "../../test-support/recording-fixtures.ts";

test("a preview keeps every sample at its time, rounded, without thread detail", () => {
  const recording = longestRecordingFixture();
  const preview = recordingPreview(recording);
  recordingSchema.parse(preview);
  assert.equal(preview.samples.length, recording.samples.length);
  assert.equal(preview.fps.samples.length, recording.fps.samples.length);
  assert.deepEqual(preview.samples[10], { time: 10.12, interval: 1, cpuPercent: 123.5, memoryBytes: 4_862_137_897, threads: [] });
  assert.deepEqual(preview.fps.samples[10], { time: 10.51, interval: 1, fps: 59.9 });
  assert.ok(JSON.stringify(recording).length > 10 * JSON.stringify(preview).length, "threads make up most of a recording");
});

test("a preview leaves out Android frame timelines and keeps readings that are missing", () => {
  const recording = recordingWithFramesFixture();
  recording.samples[0].cpuPercent = null;
  const preview = recordingPreview(recording);
  assert.ok(recording.fps.samples.some(sample => sample.frameTimeline));
  assert.ok(preview.fps.samples.every(sample => sample.frameTimeline === undefined));
  assert.equal(preview.samples[0].cpuPercent, null);
  assert.equal(preview.id, recording.id);
  assert.equal(preview.title, recording.title);
});
