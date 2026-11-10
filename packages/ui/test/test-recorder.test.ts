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

/**
 * Records a step the way the panel does now: right-click the element, then pick a row. A left click
 * records nothing at all, so there is no other way in.
 */
async function pick(recorder: TestRecorder, point: { x: number; y: number }, kind = "tap", value?: string) {
  await recorder.openMenu(point);
  await (recorder as unknown as { chooseOffer(kind: string, value?: string): Promise<void> }).chooseOffer(kind, value);
}

test("a tap row records the step and takes it on the device", async () => {
  const reads = { count: 0 };
  const recorder = new TestRecorder();
  const done: unknown[] = [];
  recorder.attach(UDID, { ...reader([tab("Explore", 800)], reads), perform: action => { done.push(action); } });
  recorder.start(UDID);

  await pick(recorder, { x: 50, y: 820 });

  const [step] = recorder.getSnapshot().steps;
  assert.equal(step.kind, "tap");
  assert.deepEqual(step.selector, { kind: "role", role: "button", name: "Explore" });
  // A step that is recorded but never taken leaves the flow on the screen before it, so the row
  // acts too — at the element's own centre, where the runner's locator action lands.
  assert.deepEqual(done, [{ kind: "tap", point: { x: 50, y: 820 } }]);
});

test("an assertion is recorded from the element menu without touching the app", async () => {
  const reads = { count: 0 };
  const recorder = new TestRecorder();
  recorder.attach(UDID, reader([tab("Explore", 800)], reads));
  recorder.start(UDID);

  await recorder.openMenu({ x: 50, y: 820 });
  const offers = recorder.getSnapshot().menu?.offers ?? [];
  // One row per kind of thing to do, not one per variant of the same selector.
  assert.deepEqual(offers.map(offer => offer.kind), ["tap", "assertVisible", "scrollUntilVisible"]);
  assert.equal(offers.find(offer => offer.kind === "assertVisible")?.source,
    'expect(screen.getByRole("button", "Explore")).toBeVisible()');
  await recorder.chooseOffer("assertVisible");

  assert.equal(recorder.getSnapshot().menu, undefined, "choosing a row closes the menu");
  assert.equal(recorder.getSnapshot().steps[0].kind, "assertVisible");
  assert.equal(reads.count, 1, "the menu and the step it records share one read");
});

test("the tree is re-read after a tap but not after an assertion", async () => {
  const reads = { count: 0 };
  const recorder = new TestRecorder();
  recorder.attach(UDID, reader([tab("Explore", 800)], reads));
  recorder.start(UDID);

  await recorder.openMenu({ x: 50, y: 820 });
  await recorder.chooseOffer("assertVisible");
  assert.equal(reads.count, 1);

  // An assertion left the screen alone, so the cached tree still describes it.
  await recorder.openMenu({ x: 50, y: 820 });
  await recorder.chooseOffer("assertVisible");
  assert.equal(reads.count, 1);

  // A tap can navigate, so the next step must be named from a fresh read.
  await pick(recorder, { x: 50, y: 820 });
  assert.equal(reads.count, 1, "the tap itself is named from the screen it landed on");
  await pick(recorder, { x: 50, y: 820 });
  assert.equal(reads.count, 2, "the step after a tap re-reads the screen");
});

test("nothing is recorded when no recording is running", async () => {
  const reads = { count: 0 };
  const recorder = new TestRecorder();
  recorder.attach(UDID, reader([tab("Explore", 800)], reads));

  await pick(recorder, { x: 50, y: 820 });

  assert.equal(recorder.getSnapshot().steps.length, 0);
  assert.equal(reads.count, 0, "nothing is recording, so nothing is even read");
});

test("a failed screen read drops the step and says why", async () => {
  const recorder = new TestRecorder();
  recorder.attach(UDID, { readComponents: async () => { throw new Error("device is gone"); }, screen: () => SCREEN });
  recorder.start(UDID);

  await pick(recorder, { x: 50, y: 820 });

  assert.equal(recorder.getSnapshot().steps.length, 0);
  assert.match(recorder.getSnapshot().error, /device is gone/);
});

test("steps can be removed and the source re-emits from what is left", async () => {
  const reads = { count: 0 };
  const recorder = new TestRecorder();
  recorder.attach(UDID, reader([tab("Explore", 800), tab("Home", 900)], reads));
  recorder.start(UDID);
  recorder.setTitle("two taps");

  await pick(recorder, { x: 50, y: 820 });
  await pick(recorder, { x: 50, y: 920 });
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

  await pick(recorder, { x: 50, y: 820 });
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
  await pick(recorder, { x: 50, y: 120 });
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

  await recorder.openMenu({ x: 300, y: 200 });
  // A coordinate has nothing to be visible, so the menu offers the tap alone.
  assert.deepEqual(recorder.getSnapshot().menu?.offers.map(offer => offer.kind), ["tap"]);
  await recorder.chooseOffer("assertVisible");

  assert.deepEqual(recorder.getSnapshot().steps, [], "nothing emittable, so nothing recorded");
  assert.match(recorder.getSnapshot().error, /nothing to act on but the coordinate/);
});

test("a coordinate tap carries a wait for the screen it was recorded on", async () => {
  const reads = { count: 0 };
  const recorder = new TestRecorder();
  recorder.attach(UDID, reader([tab("Explore", 800)], reads));
  recorder.start(UDID);

  await pick(recorder, { x: 300, y: 200 });

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
  await pick(recorder, { x: 50, y: 820 });
  recorder.stop();
  assert.equal(recorder.getSnapshot().steps.length, 1);

  // What the Testing panel passes when the steps on screen are already in a file.
  recorder.start(UDID);
  assert.deepEqual(recorder.getSnapshot().steps, []);

  // And what it passes when they are not: stopping to scroll and carrying on keeps the flow.
  await pick(recorder, { x: 50, y: 820 });
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
  await pick(recorder, { x: 50, y: 820 });

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

test("a pointer move during the menu's own read does not drop the menu", async () => {
  const reads = { count: 0 };
  const recorder = new TestRecorder();
  let release = () => {};
  const pending = new Promise<void>(resolve => { release = resolve; });
  recorder.attach(UDID, {
    readComponents: async () => { reads.count++; await pending; return [tab("Explore", 800)]; },
    screen: () => SCREEN,
    release: () => undefined,
  });
  recorder.start(UDID);

  const opening = recorder.openMenu({ x: 50, y: 820 });
  // A browser sends a pointermove after the right-click. It used to bump the recorder's token and
  // the menu, resolved against a token that no longer matched, was silently dropped.
  await recorder.hover({ x: 51, y: 821 });
  release();
  await opening;

  assert.ok(recorder.getSnapshot().menu, "the menu survived the move that landed during its read");
  assert.equal(recorder.getSnapshot().menu?.offers[0]?.kind, "tap");
  recorder.detach(UDID);
});

test("a passing run holds its marks, then lets them go; a failing one keeps them", async () => {
  const recorder = new TestRecorder();
  recorder.attach(UDID, reader([tab("Explore", 800)], { count: 0 }));
  recorder.start(UDID);
  await pick(recorder, { x: 50, y: 820 });

  recorder.beginRun();
  // A run starts with nothing marked: the runner says which step it is on, so nothing is guessed.
  assert.deepEqual(recorder.getSnapshot().run?.lines, {});
  recorder.applyRunProgress([{ stepIndex: 1, phase: "start" }]);
  assert.deepEqual(recorder.getSnapshot().run?.lines, { 8: "running" });
  recorder.finishRun({ status: "passed", steps: [{ line: 8, status: "passed" }] });
  assert.equal(recorder.getSnapshot().run?.fading, undefined, "the checkmark is held first, so it can be caught");

  // The preview is the test, not a scoreboard, so a pass gives the lines back.
  await new Promise(resolve => setTimeout(resolve, 2_700));
  assert.equal(recorder.getSnapshot().run?.fading, true);
  await new Promise(resolve => setTimeout(resolve, 800));
  assert.equal(recorder.getSnapshot().run, undefined);

  recorder.beginRun();
  recorder.finishRun({ status: "failed", steps: [{ line: 8, status: "failed", error: "Timed out" }] });
  await new Promise(resolve => setTimeout(resolve, 3_500));
  assert.deepEqual(recorder.getSnapshot().run?.lines, { 8: "failed" }, "a failure stays until the next run");
  recorder.clearRun();
  recorder.detach(UDID);
});

test("walking the outline out re-asks the menu about the element it walked to", async () => {
  const reads = { count: 0 };
  const recorder = new TestRecorder();
  const row = {
    name: "Paris", label: "Paris", text: "Paris", role: "text", depth: 2, source: "accessibility" as const,
    nodeId: "label", parentId: "card", bounds: { x: 20, y: 100, width: 80, height: 20 },
  };
  const card = {
    name: "Open Paris", label: "Open Paris", role: "button", depth: 1, source: "accessibility" as const,
    nodeId: "card", bounds: { x: 10, y: 90, width: 200, height: 60 },
  };
  recorder.attach(UDID, reader([card, row], reads));
  recorder.start(UDID);

  await recorder.openMenu({ x: 50, y: 110 });
  assert.match(recorder.getSnapshot().menu!.offers[0].source, /getByText\("Paris"\)/, "the menu starts on the element under the pointer");

  recorder.walkHover(true);

  assert.match(recorder.getSnapshot().menu!.offers[0].source, /getByRole\("button", "Open Paris"\)/, "and follows the outline out to the card");
  assert.deepEqual(recorder.getSnapshot().menu!.bounds, card.bounds, "including the rectangle it is anchored to");
  recorder.detach(UDID);
});

test("re-attaching the same reader leaves the outline and the menu where they are", async () => {
  const reads = { count: 0 };
  const recorder = new TestRecorder();
  // The simulator panel re-attaches on every device-list refresh, with the same reader object.
  // Treating that as a change threw away the cached tree and, through `clearHover`, took the
  // outline and any open menu with it about a second after the user saw them.
  const source = reader([tab("Explore", 800)], reads);
  recorder.attach(UDID, source);
  recorder.start(UDID);
  await recorder.openMenu({ x: 50, y: 820 });
  assert.ok(recorder.getSnapshot().menu);
  assert.equal(reads.count, 1);

  recorder.attach(UDID, source);

  assert.ok(recorder.getSnapshot().menu, "a refresh is not a reason to close the menu");
  assert.ok(recorder.getSnapshot().hover, "nor to drop the outline");
  await recorder.hover({ x: 50, y: 821 });
  assert.equal(reads.count, 1, "nor to read the screen again");
  recorder.detach(UDID);
});

test("live step events mark the line the step is on, by index not by guess", async () => {
  const recorder = new TestRecorder();
  recorder.attach(UDID, reader([tab("Explore", 800), tab("Home", 900)], { count: 0 }));
  recorder.start(UDID);
  await pick(recorder, { x: 50, y: 820 });
  await pick(recorder, { x: 50, y: 920 });

  // `await app.open()` is a step the runner reports too, so index 0 is the header's line.
  assert.deepEqual(recorder.emitted.calls, [6, 8, 9]);

  recorder.beginRun();
  assert.deepEqual(recorder.getSnapshot().run?.lines, {}, "nothing has started, so nothing is marked");

  recorder.applyRunProgress([
    { stepIndex: 0, phase: "start" }, { stepIndex: 0, phase: "end", status: "passed" },
    { stepIndex: 1, phase: "start" },
  ]);
  assert.deepEqual(recorder.getSnapshot().run?.lines, { 6: "passed", 8: "running" },
    "the line the runner is on spins while the ones behind it are done");

  recorder.applyRunProgress([
    { stepIndex: 0, phase: "start" }, { stepIndex: 0, phase: "end", status: "passed" },
    { stepIndex: 1, phase: "start" }, { stepIndex: 1, phase: "end", status: "failed", error: "Timed out" },
  ]);
  assert.deepEqual(recorder.getSnapshot().run?.lines, { 6: "passed", 8: "failed" });
  assert.equal(recorder.getSnapshot().run?.error, "Timed out");

  // An index past the file's awaited calls names no line rather than marking the wrong one.
  recorder.applyRunProgress([{ stepIndex: 9, phase: "start" }]);
  assert.deepEqual(recorder.getSnapshot().run?.lines, {});
  recorder.clearRun();
  recorder.detach(UDID);
});

test("progress from a finished run is ignored, so the report has the last word", async () => {
  const recorder = new TestRecorder();
  recorder.attach(UDID, reader([tab("Explore", 800)], { count: 0 }));
  recorder.start(UDID);
  await pick(recorder, { x: 50, y: 820 });

  recorder.beginRun();
  recorder.finishRun({ status: "passed", steps: [{ line: 8, status: "passed" }] });
  recorder.applyRunProgress([{ stepIndex: 1, phase: "start" }]);

  assert.deepEqual(recorder.getSnapshot().run?.lines, { 8: "passed" }, "a late poll cannot restart a finished run");
  recorder.clearRun();
  recorder.detach(UDID);
});

test("the full command list is offered beside the short one, and records what it says", async () => {
  const reads = { count: 0 };
  const recorder = new TestRecorder();
  const done: unknown[] = [];
  recorder.attach(UDID, { ...reader([tab("Explore", 800)], reads), perform: action => { done.push(action); } });
  recorder.start(UDID);

  await recorder.openMenu({ x: 50, y: 820 });
  const commands = recorder.getSnapshot().menu?.commands ?? [];
  // The short list stays short; everything else the runner can express is here.
  assert.deepEqual(recorder.getSnapshot().menu?.offers.map(offer => offer.kind), ["tap", "assertVisible", "scrollUntilVisible"]);
  assert.ok(commands.length > 3);
  assert.equal(commands.find(offer => offer.kind === "assertNotVisible")?.source,
    'expect(screen.getByRole("button", "Explore")).not.toBeVisible()');

  await recorder.chooseOffer("doubleTap");
  assert.equal(recorder.getSnapshot().steps[0].kind, "doubleTap");
  assert.match(recorder.source, /await screen\.getByRole\("button", "Explore"\)\.doubleTap\(\);/);
  // The app has to end up on the screen the next step is resolved against, and the panel's input
  // path has one tap in it, so the gesture is sent as two.
  assert.deepEqual(done, [{ kind: "tap", point: { x: 50, y: 820 } }, { kind: "tap", point: { x: 50, y: 820 } }]);
});
