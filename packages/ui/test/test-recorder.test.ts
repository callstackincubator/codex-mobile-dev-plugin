import test from "node:test";
import assert from "node:assert/strict";
import type { ScreenComponent } from "../../shared/src/screen-annotations.ts";
import { TestRecorder } from "../src/test-recorder.ts";

const UDID = "11111111-2222-3333-4444-555555555555";
const SCREEN = { width: 402, height: 874 };

function reader(components: ScreenComponent[], reads: { count: number }) {
  return {
    readComponents: async () => { reads.count++; return components; },
    screen: () => SCREEN,
  };
}

const tab = (label: string, y: number): ScreenComponent => ({
  name: label, label, role: "AXButton", depth: 1, source: "accessibility", nodeId: label,
  bounds: { x: 0, y, width: 100, height: 40 },
});

test("a tap is recorded as a step and forwarded to the device", async () => {
  const reads = { count: 0 };
  const recorder = new TestRecorder();
  recorder.attach(UDID, reader([tab("Explore", 800)], reads));
  recorder.start(UDID);

  const forward = await recorder.record({ x: 50, y: 820 });

  assert.equal(forward, true, "the app must still receive the tap");
  const [step] = recorder.getSnapshot().steps;
  assert.equal(step.kind, "tap");
  assert.deepEqual(step.selector, { kind: "role", role: "button", name: "Explore" });
});

test("an assertion is recorded without touching the app", async () => {
  const reads = { count: 0 };
  const recorder = new TestRecorder();
  recorder.attach(UDID, reader([tab("Explore", 800)], reads));
  recorder.start(UDID);
  recorder.setAssertMode(true);

  const forward = await recorder.record({ x: 50, y: 820 });

  assert.equal(forward, false, "asserting must not act on the screen it asserts");
  assert.equal(recorder.getSnapshot().steps[0].kind, "assertVisible");
  assert.equal(recorder.getSnapshot().assertMode, false, "assert mode is one shot");
});

test("the tree is re-read after a tap but not after an assertion", async () => {
  const reads = { count: 0 };
  const recorder = new TestRecorder();
  recorder.attach(UDID, reader([tab("Explore", 800)], reads));
  recorder.start(UDID);

  recorder.setAssertMode(true);
  await recorder.record({ x: 50, y: 820 });
  assert.equal(reads.count, 1);

  // An assertion left the screen alone, so the cached tree still describes it.
  recorder.setAssertMode(true);
  await recorder.record({ x: 50, y: 820 });
  assert.equal(reads.count, 1);

  // A tap can navigate, so the next step must be named from a fresh read.
  await recorder.record({ x: 50, y: 820 });
  assert.equal(reads.count, 1, "the tap itself is named from the screen it landed on");
  await recorder.record({ x: 50, y: 820 });
  assert.equal(reads.count, 2, "the step after a tap re-reads the screen");
});

test("nothing is recorded when no recording is running", async () => {
  const reads = { count: 0 };
  const recorder = new TestRecorder();
  recorder.attach(UDID, reader([tab("Explore", 800)], reads));

  const forward = await recorder.record({ x: 50, y: 820 });

  assert.equal(forward, true);
  assert.equal(recorder.getSnapshot().steps.length, 0);
  assert.equal(reads.count, 0);
});

test("a failed screen read drops the step and still lets the tap through", async () => {
  const recorder = new TestRecorder();
  recorder.attach(UDID, { readComponents: async () => { throw new Error("device is gone"); }, screen: () => SCREEN });
  recorder.start(UDID);

  const forward = await recorder.record({ x: 50, y: 820 });

  assert.equal(forward, true, "a broken recorder must not freeze the mirror");
  assert.equal(recorder.getSnapshot().steps.length, 0);
  assert.match(recorder.getSnapshot().error, /device is gone/);
});

test("steps can be removed and the source re-emits from what is left", async () => {
  const reads = { count: 0 };
  const recorder = new TestRecorder();
  recorder.attach(UDID, reader([tab("Explore", 800), tab("Home", 900)], reads));
  recorder.start(UDID);
  recorder.setTitle("two taps");

  await recorder.record({ x: 50, y: 820 });
  await recorder.record({ x: 50, y: 920 });
  assert.match(recorder.source, /Explore/);
  assert.match(recorder.source, /Home/);

  recorder.removeStep(recorder.getSnapshot().steps[0].id);
  assert.doesNotMatch(recorder.source, /Explore/);
  assert.match(recorder.source, /test\("two taps"/);
});

test("losing the device stops the recording", () => {
  const reads = { count: 0 };
  const recorder = new TestRecorder();
  recorder.attach(UDID, reader([], reads));
  recorder.start(UDID);
  assert.equal(recorder.isRecording(UDID), true);

  recorder.detach(UDID);
  assert.equal(recorder.isRecording(UDID), false);
});

test("hovering previews the element a tap would name", async () => {
  const reads = { count: 0 };
  const recorder = new TestRecorder();
  recorder.attach(UDID, reader([tab("Explore", 800)], reads));

  // Nothing is outlined until recording starts: the mirror is a plain mirror the rest of the time.
  await recorder.hover({ x: 50, y: 820 });
  assert.equal(recorder.getSnapshot().hover, undefined);
  assert.equal(reads.count, 0, "hovering must not read the device when not recording");

  recorder.start(UDID);
  await recorder.hover({ x: 50, y: 820 });
  const hover = recorder.getSnapshot().hover;
  assert.equal(hover?.label, 'Tap "Explore" (button)');
  assert.deepEqual(hover?.bounds, { x: 0, y: 800, width: 100, height: 40 });
  assert.deepEqual(hover?.screen, SCREEN);

  // A warm tree answers further moves without another read.
  await recorder.hover({ x: 60, y: 830 });
  assert.equal(reads.count, 1);

  await recorder.hover();
  assert.equal(recorder.getSnapshot().hover, undefined);
});

test("the outline is dropped when the screen it was resolved against is gone", async () => {
  const reads = { count: 0 };
  const recorder = new TestRecorder();
  recorder.attach(UDID, reader([tab("Explore", 800)], reads));
  recorder.start(UDID);
  await recorder.hover({ x: 50, y: 820 });
  assert.ok(recorder.getSnapshot().hover);

  await recorder.record({ x: 50, y: 820 });
  assert.equal(recorder.getSnapshot().hover, undefined, "a tap changes the screen under the pointer");

  await recorder.hover({ x: 50, y: 820 });
  assert.ok(recorder.getSnapshot().hover);
  recorder.stop();
  assert.equal(recorder.getSnapshot().hover, undefined);
});
