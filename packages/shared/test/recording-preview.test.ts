import test from "node:test";
import assert from "node:assert/strict";
import { RECORDING_PREVIEW_BYTES, recordingPreview, recordingPreviews, recordingSchema } from "../src/recordings.ts";
import { recordingFixture, recordingWithFramesFixture } from "../../test-support/recording-fixtures.ts";

// The longest recording, sampled every second with FPS and a busy app's threads.
function longestRecording() {
  const recording = recordingFixture();
  recording.durationSeconds = 300;
  const threads = Array.from({ length: 160 }, (_, index) => ({ id: String(1000 + index), name: `com.example.worker.thread-${index}`, cpuPercent: 12.345678 }));
  recording.samples = Array.from({ length: 300 }, (_, index) => ({
    time: index + 0.123456789, interval: 1.004567, cpuPercent: 123.456789, memoryBytes: 4_862_137_896.5, threads,
  }));
  recording.fps = { status: "finished", samples: Array.from({ length: 300 }, (_, index) => ({ time: index + 0.5123456, interval: 1.0012345, fps: 59.87654321 })) };
  return recording;
}

test("a preview keeps every sample at its time and fits a tool result", () => {
  const recording = longestRecording();
  const preview = recordingPreview(recording);
  recordingSchema.parse(preview);
  assert.equal(preview.samples.length, recording.samples.length);
  assert.equal(preview.fps.samples.length, recording.fps.samples.length);
  assert.deepEqual(preview.samples[10], { time: 10.12, interval: 1, cpuPercent: 123.5, memoryBytes: 4_862_137_897, threads: [] });
  assert.deepEqual(preview.fps.samples[10], { time: 10.51, interval: 1, fps: 59.9 });
  const size = JSON.stringify(preview).length;
  assert.ok(size <= RECORDING_PREVIEW_BYTES, `the longest recording previews in ${size} bytes`);
  assert.ok(JSON.stringify(recording).length > 10 * size, "threads make up most of a recording");
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

test("previews are left out when the recordings together do not fit", () => {
  assert.equal(recordingPreviews([recordingFixture(), recordingFixture()])?.length, 2);
  const longest = longestRecording();
  const second = { ...longestRecording(), id: "44b7030b-a74e-466f-aeb0-bcd3ae8af972" };
  assert.equal(recordingPreviews([longest, second]), undefined);
});
