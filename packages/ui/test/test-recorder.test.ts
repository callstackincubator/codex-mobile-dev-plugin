import test from "node:test";
import assert from "node:assert/strict";
import type { ScreenComponent } from "../../shared/src/screen-annotations.ts";
import { TestRecorder, formatRunDuration } from "../src/test-recorder.ts";
import { agentActSuggestion } from "../../shared/src/test-recording.ts";

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
  recorder.attach(UDID, "ios", { ...reader([tab("Explore", 800)], reads), perform: action => { done.push(action); } });
  recorder.start(UDID, "ios");

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
  recorder.attach(UDID, "ios", reader([tab("Explore", 800)], reads));
  recorder.start(UDID, "ios");

  await recorder.openMenu({ x: 50, y: 820 });
  const offers = recorder.getSnapshot().menu?.offers ?? [];
  // One row per kind of thing to do, not one per variant of the same selector.
  assert.deepEqual(offers.map(offer => offer.kind), ["tap", "assertVisible", "scrollUntilVisible"]);
  assert.equal(offers.find(offer => offer.kind === "assertVisible")?.source,
    'expect(screen.getByRole("button", "Explore")).toBeVisible()');
  await recorder.chooseOffer("assertVisible", undefined, 30_000);

  assert.equal(recorder.getSnapshot().menu, undefined, "choosing a row closes the menu");
  assert.equal(recorder.getSnapshot().steps[0].kind, "assertVisible");
  assert.equal(recorder.getSnapshot().steps[0].timeoutMs, 30_000);
  assert.match(recorder.source, /toBeVisible\(\{ timeout: 30000 \}\)/);
  assert.equal(reads.count, 1, "the menu and the step it records share one read");
});

test("the tree is re-read after a tap but not after an assertion", async () => {
  const reads = { count: 0 };
  const recorder = new TestRecorder();
  recorder.attach(UDID, "ios", reader([tab("Explore", 800)], reads));
  recorder.start(UDID, "ios");

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
  recorder.attach(UDID, "ios", reader([tab("Explore", 800)], reads));

  await pick(recorder, { x: 50, y: 820 });

  assert.equal(recorder.getSnapshot().steps.length, 0);
  assert.equal(reads.count, 0, "nothing is recording, so nothing is even read");
});

test("a failed screen read drops the step and says why", async () => {
  const recorder = new TestRecorder();
  recorder.attach(UDID, "ios", { readComponents: async () => { throw new Error("device is gone"); }, screen: () => SCREEN });
  recorder.start(UDID, "ios");

  await pick(recorder, { x: 50, y: 820 });

  assert.equal(recorder.getSnapshot().steps.length, 0);
  assert.match(recorder.getSnapshot().error, /device is gone/);
});

test("steps can be removed and the source re-emits from what is left", async () => {
  const reads = { count: 0 };
  const recorder = new TestRecorder();
  recorder.attach(UDID, "ios", reader([tab("Explore", 800), tab("Home", 900)], reads));
  recorder.start(UDID, "ios");
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
  recorder.attach(UDID, "ios", reader([], reads));
  recorder.start(UDID, "ios");
  assert.equal(recorder.isRecording(UDID, "ios"), true);

  recorder.detach(UDID, "ios");
  assert.equal(recorder.isRecording(UDID, "ios"), false);
});

test("hovering previews the element a tap would name", async () => {
  const reads = { count: 0 };
  const recorder = new TestRecorder();
  recorder.attach(UDID, "ios", reader([tab("Explore", 800)], reads));

  // Nothing is outlined until recording starts: the mirror is a plain mirror the rest of the time.
  await recorder.hover({ x: 50, y: 820 });
  assert.equal(recorder.getSnapshot().hover, undefined);
  assert.equal(reads.count, 0, "hovering must not read the device when not recording");

  recorder.start(UDID, "ios");
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
  recorder.attach(UDID, "ios", reader([tab("Explore", 800)], reads));
  recorder.start(UDID, "ios");
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
  recorder.attach(UDID, "ios", reader(CARD, reads));
  recorder.start(UDID, "ios");

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
  recorder.attach(UDID, "ios", reader([tab("Explore", 800)], reads));
  recorder.start(UDID, "ios");

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
  recorder.attach(UDID, "ios", reader([tab("Explore", 800)], reads));
  recorder.start(UDID, "ios");

  await pick(recorder, { x: 300, y: 200 });

  const step = recorder.getSnapshot().steps.at(-1);
  assert.equal(step?.selector.kind, "point");
  assert.deepEqual(step?.anchor, { kind: "text", text: "Explore" });
  assert.match(recorder.source, /toBeVisible\(\);\n\s+await screen\.tapAt/);
});

test("recording again after a save starts a new flow rather than extending the saved one", async () => {
  const reads = { count: 0 };
  const recorder = new TestRecorder();
  recorder.attach(UDID, "ios", reader([tab("Explore", 800)], reads));
  recorder.start(UDID, "ios");
  await pick(recorder, { x: 50, y: 820 });
  recorder.stop();
  assert.equal(recorder.getSnapshot().steps.length, 1);

  // What the Testing panel passes when the steps on screen are already in a file.
  recorder.start(UDID, "ios");
  assert.deepEqual(recorder.getSnapshot().steps, []);

  // And what it passes when they are not: stopping to scroll and carrying on keeps the flow.
  await pick(recorder, { x: 50, y: 820 });
  recorder.stop();
  recorder.start(UDID, "ios", true);
  assert.equal(recorder.getSnapshot().steps.length, 1);
});

test("the outline is drawn even where nothing can be named", async () => {
  const reads = { count: 0 };
  const recorder = new TestRecorder();
  recorder.attach(UDID, "ios", reader([tab("Explore", 800)], reads));
  recorder.start(UDID, "ios");

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
  recorder.attach(UDID, "ios", reader([tab("Explore", 800)], reads));
  recorder.start(UDID, "ios");
  await pick(recorder, { x: 50, y: 820 });

  recorder.stop();
  assert.equal(reads.released, 1, "stopping releases");

  // Detaching with nothing recording still has a session to hand back.
  recorder.detach(UDID, "ios");
  assert.equal(reads.released, 2, "detaching releases");
});

test("detaching mid-recording stops and releases", async () => {
  const reads = { count: 0, released: 0 };
  const recorder = new TestRecorder();
  recorder.attach(UDID, "ios", reader([tab("Explore", 800)], reads));
  recorder.start(UDID, "ios");

  recorder.detach(UDID, "ios");

  assert.equal(recorder.isRecording(UDID, "ios"), false);
  assert.equal(reads.released, 1, "the device must not be held by a recording that no longer exists");
});

test("replacing the reader hands the old device back first", async () => {
  const first = { count: 0, released: 0 };
  const second = { count: 0, released: 0 };
  const recorder = new TestRecorder();
  recorder.attach(UDID, "ios", reader([tab("Explore", 800)], first));
  recorder.attach(UDID, "ios", reader([tab("Explore", 800)], second));
  assert.equal(first.released, 1, "the reader being replaced was holding a session");
  assert.equal(second.released, 0);
});

test("recording selects the reader for that simulator instead of the last panel refreshed", async () => {
  const recorder = new TestRecorder();
  const ios = { count: 0 };
  const android = { count: 0 };
  recorder.attach(UDID, "ios", reader([tab("iOS", 100)], ios));
  recorder.attach("emulator-5554", "android", reader([tab("Android", 100)], android));

  recorder.start(UDID, "ios");
  await recorder.openMenu({ x: 50, y: 120 });

  assert.equal(recorder.getSnapshot().menu?.target?.label, "iOS");
  assert.ok(ios.count > 0);
  assert.equal(android.count, 0);
  const androidReleases = android.released;
  recorder.detach("emulator-5554", "android");
  assert.equal(android.released, androidReleases, "another panel disappearing cannot release the active recording");
  recorder.detach(UDID, "ios");
});

test("a pointer move during the menu's own read does not drop the menu", async () => {
  const reads = { count: 0 };
  const recorder = new TestRecorder();
  let release = () => {};
  const pending = new Promise<void>(resolve => { release = resolve; });
  recorder.attach(UDID, "ios", {
    readComponents: async () => { reads.count++; await pending; return [tab("Explore", 800)]; },
    screen: () => SCREEN,
    release: () => undefined,
  });
  recorder.start(UDID, "ios");

  const opening = recorder.openMenu({ x: 50, y: 820 });
  // A browser sends a pointermove after the right-click. It used to bump the recorder's token and
  // the menu, resolved against a token that no longer matched, was silently dropped.
  await recorder.hover({ x: 51, y: 821 });
  release();
  await opening;

  assert.ok(recorder.getSnapshot().menu, "the menu survived the move that landed during its read");
  assert.equal(recorder.getSnapshot().menu?.offers[0]?.kind, "tap");
  recorder.detach(UDID, "ios");
});

test("the verdict stays, the ticks go, and a failing mark stays with them gone", async () => {
  const recorder = new TestRecorder();
  recorder.attach(UDID, "ios", reader([tab("Explore", 800)], { count: 0 }));
  recorder.start(UDID, "ios");
  await pick(recorder, { x: 50, y: 820 });

  recorder.beginRun();
  // A run starts with nothing marked: the runner says which step it is on, so nothing is guessed.
  assert.deepEqual(recorder.getSnapshot().run?.lines, {});
  recorder.applyRunProgress([{ stepIndex: 1, phase: "start" }]);
  assert.deepEqual(recorder.getSnapshot().run?.lines, { 8: "running" });
  recorder.finishRun({ status: "passed", steps: [{ line: 8, status: "passed" }], durationMs: 8410 });
  assert.equal(recorder.getSnapshot().run?.fading, undefined, "the tick is held first, so it can be caught");

  await new Promise(resolve => setTimeout(resolve, 2_700));
  assert.equal(recorder.getSnapshot().run?.fading, true);
  await new Promise(resolve => setTimeout(resolve, 800));
  // The ticks go; the verdict and the duration are what the user came back for, and they stay.
  assert.deepEqual(recorder.getSnapshot().run?.lines, {}, "the preview is the test, not a scoreboard");
  assert.equal(recorder.getSnapshot().run?.state, "passed");
  assert.equal(recorder.getSnapshot().run?.durationMs, 8410);
  assert.equal(recorder.getSnapshot().run?.fading, undefined);

  // A mixed run: the ticks around the failure go, the failure itself does not. It is the only
  // thing on screen that says *where*, so nothing times it out.
  recorder.beginRun();
  recorder.finishRun({ status: "failed", durationMs: 420, steps: [
    { line: 8, status: "passed" }, { line: 9, status: "failed", error: "Timed out" },
  ] });
  assert.deepEqual(recorder.getSnapshot().run?.lines, { 8: "passed", 9: "failed" });
  await new Promise(resolve => setTimeout(resolve, 3_500));
  assert.deepEqual(recorder.getSnapshot().run?.lines, { 9: "failed" });
  assert.equal(recorder.getSnapshot().run?.state, "failed");
  assert.equal(recorder.getSnapshot().run?.durationMs, 420, "and how long it took before it broke");
  recorder.clearRun();
  recorder.detach(UDID, "ios");
});

test("a run's marks go when the steps move out from under them, and the verdict is flagged", async () => {
  const recorder = new TestRecorder();
  recorder.attach(UDID, "ios", reader([tab("Explore", 800)], { count: 0 }));
  recorder.start(UDID, "ios");
  await pick(recorder, { x: 50, y: 820 });
  recorder.finishRun({ status: "passed", steps: [{ line: 8, status: "passed" }], durationMs: 8410 });

  // The marks are claims about lines of the file as it was emitted, so the first edit to the steps
  // moves the lines out from under them — well before the ticks would have faded on their own.
  // The verdict and the duration are about a run that did happen, so they stay, flagged, so
  // nothing reads as a verdict on what is on screen now.
  await pick(recorder, { x: 50, y: 820 });
  const edited = recorder.getSnapshot().run;
  assert.deepEqual(edited?.lines, {}, "no mark points at a line that has since changed");
  assert.equal(edited?.state, "passed");
  assert.equal(edited?.durationMs, 8410);
  assert.equal(edited?.stale, true);

  // Every other way the steps move says the same thing, including a failing mark: it says where
  // the run broke in a file that no longer has that line.
  for (const edit of [
    () => recorder.duplicateStep(recorder.getSnapshot().steps[0]!.id),
    () => recorder.moveStep(recorder.getSnapshot().steps[0]!.id, 1),
    () => recorder.removeStep(recorder.getSnapshot().steps[0]!.id),
  ]) {
    recorder.finishRun({ status: "failed", steps: [{ line: 8, status: "failed", error: "Timed out" }] });
    assert.deepEqual(recorder.getSnapshot().run?.lines, { 8: "failed" });
    edit();
    assert.deepEqual(recorder.getSnapshot().run?.lines, {});
    assert.equal(recorder.getSnapshot().run?.stale, true);
  }

  // Starting a recording is the other way out: see `start`.
  recorder.finishRun({ status: "passed", steps: [{ line: 8, status: "passed" }] });
  recorder.start(UDID, "ios", true);
  assert.equal(recorder.getSnapshot().run, undefined);
  recorder.detach(UDID, "ios");
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
  recorder.attach(UDID, "ios", reader([card, row], reads));
  recorder.start(UDID, "ios");

  await recorder.openMenu({ x: 50, y: 110 });
  assert.match(recorder.getSnapshot().menu!.offers[0].source, /getByText\("Paris"\)/, "the menu starts on the element under the pointer");

  recorder.walkHover(true);

  assert.match(recorder.getSnapshot().menu!.offers[0].source, /getByRole\("button", "Open Paris"\)/, "and follows the outline out to the card");
  assert.deepEqual(recorder.getSnapshot().menu!.bounds, card.bounds, "including the rectangle it is anchored to");
  recorder.detach(UDID, "ios");
});

test("re-attaching the same reader leaves the outline and the menu where they are", async () => {
  const reads = { count: 0 };
  const recorder = new TestRecorder();
  // The simulator panel re-attaches on every device-list refresh, with the same reader object.
  // Treating that as a change threw away the cached tree and, through `clearHover`, took the
  // outline and any open menu with it about a second after the user saw them.
  const source = reader([tab("Explore", 800)], reads);
  recorder.attach(UDID, "ios", source);
  recorder.start(UDID, "ios");
  await recorder.openMenu({ x: 50, y: 820 });
  assert.ok(recorder.getSnapshot().menu);
  assert.equal(reads.count, 1);

  recorder.attach(UDID, "ios", source);

  assert.ok(recorder.getSnapshot().menu, "a refresh is not a reason to close the menu");
  assert.ok(recorder.getSnapshot().hover, "nor to drop the outline");
  await recorder.hover({ x: 50, y: 821 });
  assert.equal(reads.count, 1, "nor to read the screen again");
  recorder.detach(UDID, "ios");
});

test("live step events mark the line the step is on, by index not by guess", async () => {
  const recorder = new TestRecorder();
  recorder.attach(UDID, "ios", reader([tab("Explore", 800), tab("Home", 900)], { count: 0 }));
  recorder.start(UDID, "ios");
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
  recorder.detach(UDID, "ios");
});

test("progress from a finished run is ignored, so the report has the last word", async () => {
  const recorder = new TestRecorder();
  recorder.attach(UDID, "ios", reader([tab("Explore", 800)], { count: 0 }));
  recorder.start(UDID, "ios");
  await pick(recorder, { x: 50, y: 820 });

  recorder.beginRun();
  recorder.finishRun({ status: "passed", steps: [{ line: 8, status: "passed" }] });
  recorder.applyRunProgress([{ stepIndex: 1, phase: "start" }]);

  assert.deepEqual(recorder.getSnapshot().run?.lines, { 8: "passed" }, "a late poll cannot restart a finished run");
  recorder.clearRun();
  recorder.detach(UDID, "ios");
});

test("the full command list is offered beside the short one, and records what it says", async () => {
  const reads = { count: 0 };
  const recorder = new TestRecorder();
  const done: unknown[] = [];
  recorder.attach(UDID, "ios", { ...reader([tab("Explore", 800)], reads), perform: action => { done.push(action); } });
  recorder.start(UDID, "ios");

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

test("a step can be duplicated, re-pointed at another command, and dragged into place", async () => {
  const recorder = new TestRecorder();
  const field: ScreenComponent = {
    name: "Search", label: "Search", role: "textbox", value: "hi", depth: 1, source: "accessibility",
    nodeId: "search", bounds: { x: 0, y: 100, width: 100, height: 40 },
  };
  recorder.attach(UDID, "ios", reader([tab("Explore", 800), field], { count: 0 }));
  recorder.start(UDID, "ios");
  await pick(recorder, { x: 50, y: 820 });
  await pick(recorder, { x: 50, y: 120 });

  const [explore, search] = recorder.getSnapshot().steps;
  // What the element carried is kept with the step, so its own menu can offer the same commands
  // the mirror's did long after that screen has gone.
  assert.equal(search.target?.role, "textbox");
  assert.equal(search.target?.value, "hi");

  recorder.duplicateStep(explore.id);
  let steps = recorder.getSnapshot().steps;
  assert.equal(steps.length, 3);
  assert.notEqual(steps[2].id, explore.id, "a copy is its own step, not the same one twice");
  assert.deepEqual(steps[2].selector, explore.selector);

  // The command changes; the element it named does not.
  recorder.changeStepCommand(steps[2].id, "assertNotVisible", undefined, 30_000);
  steps = recorder.getSnapshot().steps;
  assert.equal(steps[2].kind, "assertNotVisible");
  assert.equal(steps[2].label, 'Expect not visible "Explore" (button)');
  assert.deepEqual(steps[2].selector, explore.selector);
  assert.match(recorder.source, /await expect\(screen\.getByRole\("button", "Explore"\)\)\.not\.toBeVisible\(\{ timeout: 30000 \}\);/);

  // A kind that carries text takes it; swapping back drops it rather than leaving it to emit.
  recorder.changeStepCommand(steps[2].id, "assertText", "Explore");
  assert.equal(recorder.getSnapshot().steps[2].value, "Explore");
  recorder.changeStepCommand(steps[2].id, "assertVisible");
  assert.equal(recorder.getSnapshot().steps[2].value, undefined);

  // Reordering is the emitted order, so the file follows the list.
  recorder.moveStep(steps[2].id, 0);
  assert.deepEqual(recorder.getSnapshot().steps.map(step => step.id), [steps[2].id, explore.id, search.id]);
  const lines = recorder.source.split("\n").filter(line => line.includes("await screen") || line.includes("await expect"));
  assert.match(lines[0], /toBeVisible/);
  assert.match(lines[1], /\.tap\(\)/);

  // Everything else about the list keeps working on top of the edits.
  recorder.removeStep(explore.id);
  assert.equal(recorder.getSnapshot().steps.length, 2);
  recorder.clearSteps();
  assert.equal(recorder.getSnapshot().steps.length, 0);
  recorder.detach(UDID, "ios");
});

test("an agentic step is recorded from a sentence, even where nothing can be named", async () => {
  const reads = { count: 0 };
  const recorder = new TestRecorder();
  const done: unknown[] = [];
  recorder.attach(UDID, "ios", { ...reader([tab("Explore", 800)], reads), perform: action => { done.push(action); } });
  recorder.start(UDID, "ios");

  // The menu over an element carries what it is, so the Act row can draft a sentence out of it.
  await recorder.openMenu({ x: 50, y: 820 });
  assert.equal(recorder.getSnapshot().menu?.target?.label, "Explore");
  assert.equal(agentActSuggestion(recorder.getSnapshot().menu?.target), 'tap the "Explore" button');

  recorder.recordAgentStep({ kind: "agentAct", instruction: '  tap the "Explore" tab  ' });
  const [act] = recorder.getSnapshot().steps;
  assert.equal(act.kind, "agentAct");
  assert.equal(act.instruction, 'tap the "Explore" tab', "the sentence is trimmed, not the element's");
  assert.equal(act.selector, undefined, "an agent step names no element");
  assert.equal(act.label, 'Agent "tap the \\"Explore\\" tab"');
  // Nothing is sent to the device: running the instruction would be a run, not a recording.
  assert.deepEqual(done, []);
  // Opening the menu is what closes it; recording the step closes it too.
  assert.equal(recorder.getSnapshot().menu, undefined);

  // Empty space resolves to a coordinate, which the pinned rows refuse — and which is exactly
  // where describing the step is the only way to write it.
  await recorder.openMenu({ x: 300, y: 200 });
  recorder.recordAgentStep({ kind: "agentAssert", instruction: "the city list is showing", vision: "only" });
  const assertStep = recorder.getSnapshot().steps.at(-1);
  assert.equal(assertStep?.kind, "agentAssert");
  assert.equal(assertStep?.vision, "only");
  assert.equal(recorder.getSnapshot().error, "", "nothing refused the step");

  // A blank sentence is not a step.
  recorder.recordAgentStep({ kind: "agentAct", instruction: "   " });
  assert.equal(recorder.getSnapshot().steps.length, 2);

  // Params ride on the act step and nothing else; no params means no options object at all.
  recorder.recordAgentStep({ kind: "agentAct", instruction: "sign in", params: { email: "a@b.com", attempts: "3" } });
  const signIn = recorder.getSnapshot().steps.at(-1);
  assert.deepEqual(signIn?.params, { email: "a@b.com", attempts: "3" });
  assert.match(recorder.source, /await agent\.act\("sign in", \{ params: \{ email: "a@b\.com", attempts: 3 \} \}\);/);
  recorder.removeStep(signIn!.id);

  const source = recorder.source;
  assert.match(source, /async \(\{ agent, app, screen \}\)/);
  assert.match(source, /await agent\.act\("tap the \\"Explore\\" tab"\);/);
  assert.match(source, /await agent\.assert\("the city list is showing", \{ vision: "only" \}\);/);

  // The editing an agent step does support still works on it; what it cannot do is take a locator.
  recorder.duplicateStep(act.id);
  assert.equal(recorder.getSnapshot().steps.length, 3);
  recorder.changeStepCommand(act.id, "assertVisible");
  assert.equal(recorder.getSnapshot().steps[0].kind, "agentAct", "no command swap invents a locator");
  recorder.moveStep(act.id, 2);
  assert.equal(recorder.getSnapshot().steps.at(-1)?.id, act.id);
  recorder.detach(UDID, "ios");
});

test("a swipe is recorded and taken on the device, scoped to the element or to the viewport", async () => {
  const reads = { count: 0 };
  const recorder = new TestRecorder();
  const done: any[] = [];
  recorder.attach(UDID, "ios", { ...reader([tab("Explore", 800)], reads), perform: action => { done.push(action); } });
  recorder.start(UDID, "ios");

  // Scoped: the gesture runs inside the element's own rectangle, well in from its edges, since a
  // gesture begun on an edge is an edge gesture to the OS rather than the swipe the step means.
  await pick(recorder, { x: 50, y: 820 }, "swipe", "left");
  const scoped = recorder.getSnapshot().steps.at(-1);
  assert.equal(scoped?.kind, "swipe");
  assert.equal(scoped?.direction, "left");
  assert.equal(scoped?.label, 'Swipe left on "Explore" (button)');
  assert.deepEqual(done.at(-1), { kind: "swipe", from: { x: 85, y: 820 }, to: { x: 15, y: 820 } });
  assert.match(recorder.source, /await screen\.getByRole\("button", "Explore"\)\.swipe\(\{ direction: "left" \}\);/);

  // The viewport form, on a point nothing can name — the refusal every other non-tap command
  // still gets must let this one through, because it is not about an element at all.
  await pick(recorder, { x: 300, y: 200 }, "swipe", "up");
  const viewport = recorder.getSnapshot().steps.at(-1);
  assert.equal(viewport?.selector.kind, "point");
  assert.equal(viewport?.direction, "up");
  assert.equal(recorder.getSnapshot().error, "", "nothing refused it");
  // The middle 70% of the whole screen, since there is no element to scope it to.
  const { from, to } = done.at(-1);
  assert.equal(from.x, SCREEN.width / 2);
  assert.ok(Math.abs(from.y - (SCREEN.height / 2 + SCREEN.height * 0.35)) < 0.01);
  assert.ok(Math.abs(to.y - (SCREEN.height / 2 - SCREEN.height * 0.35)) < 0.01, "the finger travels upwards");
  assert.match(recorder.source, /await screen\.swipe\(\{ direction: "up" \}\);/);
  // Still a coordinate's screen, so it keeps the wait a point step needs.
  assert.deepEqual(viewport?.anchor, { kind: "text", text: "Explore" });

  // An unknown direction is not a reason to record a broken step; the menu's first one stands.
  await pick(recorder, { x: 50, y: 820 }, "swipe", "sideways");
  assert.equal(recorder.getSnapshot().steps.at(-1)?.direction, "up");

  // Swapping a swipe for a command that is not one drops the direction with it.
  const swipe = recorder.getSnapshot().steps.at(-1)!;
  recorder.changeStepCommand(swipe.id, "assertVisible");
  assert.equal(recorder.getSnapshot().steps.at(-1)?.direction, undefined);
  recorder.detach(UDID, "ios");
});

test("waitFor is recorded like the other judgements and emits the agent's own call", async () => {
  const recorder = new TestRecorder();
  recorder.attach(UDID, "ios", reader([tab("Explore", 800)], { count: 0 }));
  recorder.start(UDID, "ios");
  recorder.recordAgentStep({ kind: "agentWaitFor", instruction: "the spinner is gone" });
  recorder.recordAgentStep({ kind: "agentWaitFor", instruction: "the list has loaded", vision: "only" });
  const steps = recorder.getSnapshot().steps;
  assert.deepEqual(steps.map(step => step.kind), ["agentWaitFor", "agentWaitFor"]);
  assert.equal(steps[0].label, 'Agent wait "the spinner is gone"');
  assert.equal(steps[0].vision, undefined, "off is the runner's default, so it is not stored");
  assert.match(recorder.source, /await agent\.waitFor\("the spinner is gone"\);/);
  assert.match(recorder.source, /await agent\.waitFor\("the list has loaded", \{ vision: "only" \}\);/);
  assert.match(recorder.source, /async \(\{ agent, app, screen \}\)/);
  recorder.detach(UDID, "ios");
});

test("Record asks what to do with the steps already there, and either answer leaves a clean state", async () => {
  const reads = { count: 0 };
  const recorder = new TestRecorder();
  recorder.attach(UDID, "ios", reader([tab("Explore", 800)], reads));
  recorder.start(UDID, "ios");
  await pick(recorder, { x: 50, y: 820 });
  recorder.stop();

  // A finished run's marks are a verdict on the file as it was.
  recorder.finishRun({ status: "passed", steps: [{ line: 8, status: "passed" }], durationMs: 8410 });
  assert.equal(recorder.getSnapshot().run?.state, "passed");
  assert.equal(recorder.getSnapshot().run?.durationMs, 8410);

  // Resume keeps the flow and adds to the end of it — this is the case that used to wipe, because
  // saving clears the dirty flag and the old Record read that flag to decide.
  recorder.start(UDID, "ios", true);
  assert.equal(recorder.getSnapshot().steps.length, 1, "the recorded flow survives");
  assert.equal(recorder.getSnapshot().run, undefined, "and no stale overlay marks lines it no longer describes");
  await pick(recorder, { x: 50, y: 820 });
  assert.equal(recorder.getSnapshot().steps.length, 2, "the next step lands after the ones already there");

  // New is the other answer, and it is now a thing the user asked for rather than a default.
  recorder.finishRun({ status: "failed", steps: [], durationMs: 420 });
  recorder.start(UDID, "ios", false);
  assert.deepEqual(recorder.getSnapshot().steps, []);
  assert.equal(recorder.getSnapshot().run, undefined);
  recorder.detach(UDID, "ios");
});

test("a run's duration reads the way the runner's own CLI writes it", () => {
  assert.equal(formatRunDuration(8410), "8.41s");
  assert.equal(formatRunDuration(1000), "1.00s");
  assert.equal(formatRunDuration(125_300), "125.30s");
  // Under a second it is milliseconds: `0.84s` reads as a rounding of something longer.
  assert.equal(formatRunDuration(840), "840ms");
  assert.equal(formatRunDuration(999), "999ms");
  assert.equal(formatRunDuration(0), "0ms");
  assert.equal(formatRunDuration(-1), "");
  assert.equal(formatRunDuration(Number.NaN), "");
});

test("recording an Android emulator reads the tree with its serial and platform", async () => {
  const recorder = new TestRecorder();
  const seen: unknown[] = [];
  recorder.useTreeSource({ read: async (deviceId, platform) => { seen.push([deviceId, platform]); return { tree: [tab("Home", 100)] }; }, release: () => undefined });
  recorder.attach("emulator-5554", "android", { readComponents: async () => (await recorder.readTree("emulator-5554", "android")).tree, screen: () => SCREEN });
  recorder.start("emulator-5554", "android");
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(recorder.isRecording("emulator-5554", "android"), true);
  assert.equal(recorder.isRecording("emulator-5554", "ios"), false, "the same string on another platform is another device");
  assert.deepEqual(seen[0], ["emulator-5554", "android"]);
  recorder.stop();
});
