import test from "node:test";
import assert from "node:assert/strict";
import type { ScreenComponent } from "../../shared/src/screen-annotations.ts";
import { TestRecorder } from "../src/test-recorder.ts";

const UDID = "11111111-2222-3333-4444-555555555555";
const SCREEN = { width: 402, height: 874 };

function reader(components: ScreenComponent[], reads: { count: number; released?: number }) {
  return {
    readComponents: async () => { reads.count++; return components; },
    screen: () => SCREEN,
    release: () => { reads.released = (reads.released ?? 0) + 1; },
  };
}

/** One element as the e2e runner reports it: its own role, and its accessible name in `label`. */
const tab = (label: string, y: number): ScreenComponent => ({
  name: label, label, text: label, role: "button", depth: 1, source: "accessibility", nodeId: label,
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

const CARD: ScreenComponent[] = [
  { name: "card", label: "Open city", identifier: "city-card", role: "button", depth: 1, source: "accessibility", nodeId: "card", bounds: { x: 0, y: 100, width: 300, height: 80 } },
  { name: "Paris", label: "Paris", text: "Paris", role: "text", depth: 2, source: "accessibility", nodeId: "label", parentId: "card", bounds: { x: 10, y: 110, width: 100, height: 20 } },
];

test("the outline walks out to the enclosing element and records what it shows", async () => {
  const reads = { count: 0 };
  const recorder = new TestRecorder();
  recorder.attach(UDID, reader(CARD, reads));
  recorder.start(UDID);

  await recorder.hover({ x: 50, y: 120 });
  assert.equal(recorder.getSnapshot().hover?.label, 'Tap "Paris"');
  assert.equal(recorder.getSnapshot().hover?.levels, 2);

  recorder.walkHover(true);
  assert.equal(recorder.getSnapshot().hover?.label, "Tap #city-card");
  assert.equal(recorder.getSnapshot().hover?.level, 1);
  assert.equal(reads.count, 1, "walking re-resolves from the cache, it does not re-read the device");

  // The step is what the outline showed, not what the pointer was over.
  await recorder.record({ x: 50, y: 120 });
  assert.deepEqual(recorder.getSnapshot().steps.at(-1)?.selector, { kind: "testId", testId: "city-card" });

  // It cannot walk past the outermost element, nor inside the innermost.
  await recorder.hover({ x: 50, y: 120 });
  recorder.walkHover(false);
  assert.equal(recorder.getSnapshot().hover?.level, 0);
  recorder.walkHover(false);
  assert.equal(recorder.getSnapshot().hover?.level, 0);
});

test("an assertion on a point with nothing to name is refused, not recorded as comments", async () => {
  const reads = { count: 0 };
  const recorder = new TestRecorder();
  recorder.attach(UDID, reader([tab("Explore", 800)], reads));
  recorder.start(UDID);
  recorder.setAssertMode(true);

  const forward = await recorder.record({ x: 300, y: 200 });

  assert.equal(forward, false, "an assertion never touches the app, refused or not");
  assert.deepEqual(recorder.getSnapshot().steps, [], "nothing emittable, so nothing recorded");
  assert.match(recorder.getSnapshot().error, /nothing to assert/);
  assert.equal(recorder.getSnapshot().assertMode, true, "assert stays armed so the next try is one tap");
});

test("a coordinate tap carries a wait for the screen it was recorded on", async () => {
  const reads = { count: 0 };
  const recorder = new TestRecorder();
  recorder.attach(UDID, reader([tab("Explore", 800)], reads));
  recorder.start(UDID);

  await recorder.record({ x: 300, y: 200 });

  const step = recorder.getSnapshot().steps.at(-1);
  assert.equal(step?.selector.kind, "point");
  assert.deepEqual(step?.anchor, { kind: "text", text: "Explore" });
  assert.match(recorder.source, /toBeVisible\(\);\n\s+await screen\.tapAt/);
});

test("recording again after a save starts a new flow rather than extending the saved one", async () => {
  const reads = { count: 0 };
  const recorder = new TestRecorder();
  recorder.attach(UDID, reader([tab("Explore", 800)], reads));
  recorder.start(UDID);
  await recorder.record({ x: 50, y: 820 });
  recorder.stop();
  assert.equal(recorder.getSnapshot().steps.length, 1);

  // What the Testing panel passes when the steps on screen are already in a file.
  recorder.start(UDID);
  assert.deepEqual(recorder.getSnapshot().steps, []);

  // And what it passes when they are not: stopping to scroll and carrying on keeps the flow.
  await recorder.record({ x: 50, y: 820 });
  recorder.stop();
  recorder.start(UDID, true);
  assert.equal(recorder.getSnapshot().steps.length, 1);
});

test("the outline is drawn even where nothing can be named", async () => {
  const reads = { count: 0 };
  const recorder = new TestRecorder();
  recorder.attach(UDID, reader([tab("Explore", 800)], reads));
  recorder.start(UDID);

  await recorder.hover({ x: 300, y: 200 });

  // Silence reads as a broken recorder; the mark says what a tap here would actually record.
  const hover = recorder.getSnapshot().hover;
  assert.match(hover?.label ?? "", /at 300, 200/);
  assert.deepEqual(hover?.bounds, { x: 288, y: 188, width: 24, height: 24 });
});

test("the device is given back on every path out of recording", async () => {
  // Reading the runner's tree holds a session, and the runner allows one per device, so a session
  // left open here makes the user's next `e2e run` fail with "device is already in use".
  const reads = { count: 0, released: 0 };
  const recorder = new TestRecorder();
  recorder.attach(UDID, reader([tab("Explore", 800)], reads));
  recorder.start(UDID);
  await recorder.record({ x: 50, y: 820 });

  recorder.stop();
  assert.equal(reads.released, 1, "stopping releases");

  // Detaching with nothing recording still has a session to hand back.
  recorder.detach(UDID);
  assert.equal(reads.released, 2, "detaching releases");
});

test("detaching mid-recording stops and releases", async () => {
  const reads = { count: 0, released: 0 };
  const recorder = new TestRecorder();
  recorder.attach(UDID, reader([tab("Explore", 800)], reads));
  recorder.start(UDID);

  recorder.detach(UDID);

  assert.equal(recorder.isRecording(UDID), false);
  assert.equal(reads.released, 1, "the device must not be held by a recording that no longer exists");
});

test("replacing the reader hands the old device back first", async () => {
  const first = { count: 0, released: 0 };
  const second = { count: 0, released: 0 };
  const recorder = new TestRecorder();
  recorder.attach(UDID, reader([tab("Explore", 800)], first));
  recorder.attach(UDID, reader([tab("Explore", 800)], second));
  assert.equal(first.released, 1, "the reader being replaced was holding a session");
  assert.equal(second.released, 0);
});
