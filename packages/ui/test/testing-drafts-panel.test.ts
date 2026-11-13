import test from "node:test";
import assert from "node:assert/strict";
import type { HostBridge } from "../src/host-bridge.ts";
import type { DeviceAppsStore } from "../src/device-apps.ts";
import { TestingPanel } from "../src/testing-panel.ts";
import { testRecorder } from "../src/test-recorder.ts";
import type { ScreenComponent } from "../../shared/src/screen-annotations.ts";

const UDID = "11111111-2222-3333-4444-555555555555";
const PROJECT = "/Users/someone/app";
const DRAFT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const tab: ScreenComponent = {
  name: "Explore", label: "Explore", role: "AXButton", depth: 1, source: "accessibility", nodeId: "explore",
  bounds: { x: 0, y: 800, width: 100, height: 40 },
};

const deviceApps = { subscribe: () => () => undefined, getSnapshot: () => ({ device: undefined }) } as unknown as DeviceAppsStore;

function host(responses: Record<string, unknown>, calls: { name: string; arguments: Record<string, unknown> }[]) {
  return {
    async callServerTool({ name, arguments: input }: { name: string; arguments: Record<string, unknown> }) {
      calls.push({ name, arguments: input });
      return { content: [], structuredContent: responses[name] ?? {} };
    },
  } as unknown as HostBridge;
}

function open(responses: Record<string, unknown>, calls: { name: string; arguments: Record<string, unknown> }[]) {
  const panel = new TestingPanel(host(responses, calls), deviceApps);
  panel.setAvailable(true);
  (panel as unknown as { update(fields: Record<string, unknown>): void }).update({ projectPath: PROJECT });
  return panel;
}

async function recordOneStep() {
  testRecorder.attach(UDID, "ios", { readComponents: async () => [tab], screen: () => ({ width: 402, height: 874 }) });
  testRecorder.start(UDID, "ios");
  await testRecorder.openMenu({ x: 50, y: 820 });
  await testRecorder.chooseOffer("tap");
}

/** The panel's own autosave, without waiting out its debounce. */
function keep(panel: TestingPanel): Promise<void> {
  return (panel as unknown as { keepDraft(): Promise<void> }).keepDraft();
}

const named = (calls: { name: string }[], name: string) => calls.filter(call => call.name === name);

test("the flow on screen is kept, so switching away does not lose it", async () => {
  const calls: { name: string; arguments: Record<string, unknown> }[] = [];
  const panel = open({ mobile_testing_draft_save: { id: DRAFT, updatedAt: "2026-01-01T00:00:00.000Z" } }, calls);
  await recordOneStep();

  await keep(panel);

  const saved = named(calls, "mobile_testing_draft_save");
  assert.equal(saved.length, 1);
  assert.equal(saved[0].arguments.projectPath, PROJECT);
  assert.equal((saved[0].arguments.steps as unknown[]).length, 1);
  assert.equal(saved[0].arguments.id, undefined, "the first keep creates the draft");
  assert.equal(panel.getSnapshot().draftId, DRAFT);

  // The next keep replaces the same draft rather than leaving a second copy of one flow.
  await testRecorder.openMenu({ x: 50, y: 820 });
  await testRecorder.chooseOffer("assertVisible");
  await keep(panel);
  const again = named(calls, "mobile_testing_draft_save");
  assert.equal(again.length, 2);
  assert.equal(again[1].arguments.id, DRAFT);
  panel.dispose();
});

test("an unchanged flow is not rewritten, and an empty one is never kept", async () => {
  const calls: { name: string; arguments: Record<string, unknown> }[] = [];
  const panel = open({ mobile_testing_draft_save: { id: DRAFT } }, calls);
  testRecorder.stop();
  testRecorder.clearSteps();

  await keep(panel);
  assert.deepEqual(named(calls, "mobile_testing_draft_save"), [], "nothing to keep with no steps");

  await recordOneStep();
  await keep(panel);
  await keep(panel);
  assert.equal(named(calls, "mobile_testing_draft_save").length, 1, "an unchanged flow is already kept");
  panel.dispose();
});

test("opening a kept recording puts its steps back without arming the recorder", async () => {
  const calls: { name: string; arguments: Record<string, unknown> }[] = [];
  const steps = [
    { id: "s1", kind: "tap", label: 'Tap "Explore" (tab)', selector: { kind: "role", role: "tab", name: "Explore" } },
    { id: "s2", kind: "assertVisible", label: 'Expect "Paris"', selector: { kind: "text", text: "Paris" } },
  ];
  const panel = open({
    mobile_testing_draft_save: { id: "11111111-1111-4111-8111-111111111111" },
    mobile_testing_draft_read: { draft: { id: DRAFT, title: "the explore screen", fileName: "explore", steps } },
    mobile_testing_drafts: { drafts: [] },
  }, calls);
  await recordOneStep();

  await panel.openDraft(DRAFT);

  assert.equal(testRecorder.getSnapshot().steps.length, 2);
  assert.equal(testRecorder.getSnapshot().title, "the explore screen");
  assert.equal(testRecorder.getSnapshot().recordingDeviceId, "", "reopening a flow must not start recording");
  assert.equal(panel.getSnapshot().draftId, DRAFT);
  assert.equal(panel.getSnapshot().fileName, "explore");
  // The flow that was on screen is kept before it is replaced, so swapping drafts loses nothing.
  assert.equal(named(calls, "mobile_testing_draft_save").length, 1);
  // And the restored flow is not immediately written back as a change of its own.
  await keep(panel);
  assert.equal(named(calls, "mobile_testing_draft_save").length, 1);
  panel.dispose();
});

test("deleting the recording on screen clears the panel with it", async () => {
  const calls: { name: string; arguments: Record<string, unknown> }[] = [];
  const panel = open({ mobile_testing_draft_save: { id: DRAFT }, mobile_testing_drafts: { drafts: [] } }, calls);
  await recordOneStep();
  await keep(panel);
  assert.equal(panel.getSnapshot().draftId, DRAFT);

  await panel.deleteDraft(DRAFT);

  assert.deepEqual(named(calls, "mobile_testing_draft_delete").map(call => call.arguments.id), [DRAFT]);
  assert.equal(panel.getSnapshot().draftId, "");
  assert.equal(testRecorder.getSnapshot().steps.length, 0);
  // And the cleared panel is not kept straight back as an empty draft.
  await keep(panel);
  assert.equal(named(calls, "mobile_testing_draft_save").length, 1);
  panel.dispose();
});

test("saving into the project forgets the draft it was standing in for", async () => {
  const calls: { name: string; arguments: Record<string, unknown> }[] = [];
  const panel = open({
    mobile_testing_draft_save: { id: DRAFT },
    mobile_testing_drafts: { drafts: [] },
    mobile_testing_write_file: { written: true, existed: false, path: `${PROJECT}/tests/flow.e2e.ts` },
  }, calls);
  (panel as unknown as { update(fields: Record<string, unknown>): void }).update({ fileName: "flow" });
  await recordOneStep();
  await keep(panel);

  await panel.saveTest();
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.deepEqual(named(calls, "mobile_testing_draft_delete").map(call => call.arguments.id), [DRAFT]);
  assert.equal(panel.getSnapshot().draftId, "");
  assert.equal(testRecorder.getSnapshot().steps.length, 1, "the steps stay on screen; only the kept copy goes");
  panel.dispose();
});

test("nothing is kept while the agent is recording: the server holds that flow", async () => {
  const calls: { name: string; arguments: Record<string, unknown> }[] = [];
  const panel = open({ mobile_testing_draft_save: { id: DRAFT } }, calls);
  // After the panel's first agent poll, which reports no session and would otherwise clear this.
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));
  (panel as unknown as { update(fields: Record<string, unknown>): void }).update({
    agent: { active: true, status: "recording", title: "a flow", goal: "explore", steps: 1, note: "", draftId: "" },
  });
  await recordOneStep();

  await keep(panel);

  assert.deepEqual(named(calls, "mobile_testing_draft_save"), []);
  panel.dispose();
});

test("recording a second flow keeps a second draft rather than overwriting the first", async () => {
  // The bug this covers: Record starts a new flow, the panel kept the finished one's id, and the
  // next autosave wrote the new recording over the old one's file. Two recordings, one row.
  const calls: { name: string; arguments: Record<string, unknown> }[] = [];
  const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
  let next = 0;
  const panel = new TestingPanel({
    async callServerTool({ name, arguments: input }: { name: string; arguments: Record<string, unknown> }) {
      calls.push({ name, arguments: input });
      if (name === "mobile_testing_draft_save") return { content: [], structuredContent: { id: input.id ?? ids[next++] } };
      return { content: [], structuredContent: {} };
    },
  } as unknown as HostBridge, deviceApps);
  panel.setAvailable(true);
  (panel as unknown as { update(fields: Record<string, unknown>): void }).update({ projectPath: PROJECT });

  await recordOneStep();
  await keep(panel);
  assert.equal(panel.getSnapshot().draftId, ids[0]);

  // Record again, without resuming: a different recording, from the first step on.
  testRecorder.start(UDID, "ios");
  assert.equal(panel.getSnapshot().draftId, "", "the finished flow's draft is let go as the new one begins");
  await testRecorder.openMenu({ x: 50, y: 820 });
  await testRecorder.chooseOffer("assertVisible");
  await keep(panel);

  const saved = named(calls, "mobile_testing_draft_save");
  assert.equal(saved.length, 2);
  assert.equal(saved[1].arguments.id, undefined, "the second flow must not replace the first one's draft");
  assert.equal(panel.getSnapshot().draftId, ids[1]);
  panel.dispose();
});

test("resuming a flow goes on writing the same draft", async () => {
  const calls: { name: string; arguments: Record<string, unknown> }[] = [];
  const panel = open({ mobile_testing_draft_save: { id: DRAFT } }, calls);
  await recordOneStep();
  await keep(panel);

  // Record with `keepSteps`: the same recording, carried on.
  testRecorder.start(UDID, "ios", true);
  await testRecorder.openMenu({ x: 50, y: 820 });
  await testRecorder.chooseOffer("assertVisible");
  await keep(panel);

  const saved = named(calls, "mobile_testing_draft_save");
  assert.equal(saved.length, 2);
  assert.equal(saved[1].arguments.id, DRAFT);
  assert.equal((saved[1].arguments.steps as unknown[]).length, 2);
  panel.dispose();
});

test("Clear starts a flow of its own, so the cleared recording stays in the list", async () => {
  const calls: { name: string; arguments: Record<string, unknown> }[] = [];
  const panel = open({ mobile_testing_draft_save: { id: DRAFT }, mobile_testing_drafts: { drafts: [] } }, calls);
  await recordOneStep();
  await keep(panel);

  testRecorder.clearSteps();
  assert.equal(panel.getSnapshot().draftId, "");
  await recordOneStep();
  await keep(panel);

  const saved = named(calls, "mobile_testing_draft_save");
  assert.equal(saved.length, 2);
  assert.equal(saved[1].arguments.id, undefined);
  panel.dispose();
});

test("a saved recording moves into the project's half of the list rather than leaving it", async () => {
  // The bug this covers: the draft is deleted when the flow is written into the project, and
  // nothing else listed the file, so pressing Save made the test vanish from the panel's list.
  const calls: { name: string; arguments: Record<string, unknown> }[] = [];
  const panel = open({
    mobile_testing_draft_save: { id: DRAFT },
    mobile_testing_drafts: { drafts: [] },
    mobile_testing_tests: { tests: [{ relativePath: "tests/flow.e2e.ts", name: "flow.e2e.ts", updatedAt: "2026-01-01T00:00:00.000Z", sizeBytes: 420 }] },
    mobile_testing_write_file: { written: true, existed: false, path: `${PROJECT}/tests/flow.e2e.ts` },
  }, calls);
  (panel as unknown as { update(fields: Record<string, unknown>): void }).update({ fileName: "flow" });
  await recordOneStep();
  await keep(panel);

  await panel.saveTest();
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.ok(named(calls, "mobile_testing_tests").length > 0, "the project's tests are read again after a save");
  assert.deepEqual(panel.getSnapshot().tests.map(entry => entry.relativePath), ["tests/flow.e2e.ts"]);
  assert.deepEqual(panel.getSnapshot().drafts, [], "and it is no longer one of the unstored recordings");
  panel.dispose();
});

test("deleting one of the project's tests removes the file and re-reads the folder", async () => {
  const calls: { name: string; arguments: Record<string, unknown> }[] = [];
  const panel = open({
    mobile_testing_tests: { tests: [] },
    mobile_testing_delete_file: { path: `${PROJECT}/tests/flow.e2e.ts`, removed: true },
  }, calls);
  (panel as unknown as { update(fields: Record<string, unknown>): void }).update({
    savedPath: `${PROJECT}/tests/flow.e2e.ts`, savedRevision: 3,
  });

  await panel.deleteTest("tests/flow.e2e.ts");

  assert.deepEqual(named(calls, "mobile_testing_delete_file").map(call => call.arguments),
    [{ projectPath: PROJECT, relativePath: "tests/flow.e2e.ts" }]);
  assert.equal(panel.getSnapshot().deletingTest, "", "the row stops spinning when the delete lands");
  assert.equal(panel.getSnapshot().savedPath, "", "the \"Saved to …\" line is not left pointing at a file that is gone");
  assert.ok(named(calls, "mobile_testing_tests").length > 0);
  panel.dispose();
});

test("the project's tests are listed per project, and dropped when the project is left", async () => {
  const calls: { name: string; arguments: Record<string, unknown> }[] = [];
  const panel = open({
    mobile_testing_tests: { tests: [{ relativePath: "tests/flow.e2e.ts", name: "flow.e2e.ts", updatedAt: "2026-01-01T00:00:00.000Z", sizeBytes: 10 }] },
  }, calls);

  await panel.refreshTests();
  assert.deepEqual(named(calls, "mobile_testing_tests").map(call => call.arguments), [{ projectPath: PROJECT }]);
  assert.equal(panel.getSnapshot().tests.length, 1);

  // With no project there is nothing to list: another project's tests must not stay on screen.
  (panel as unknown as { update(fields: Record<string, unknown>): void }).update({ projectPath: "" });
  await panel.refreshTests();
  assert.deepEqual(panel.getSnapshot().tests, []);
  panel.dispose();
});

test("opening a project test previews its source and preserves the recording", async () => {
  const calls: { name: string; arguments: Record<string, unknown> }[] = [];
  const panel = open({
    mobile_testing_draft_save: { id: DRAFT },
    mobile_testing_read_file: { source: 'test("stored", async () => {});\n' },
  }, calls);
  testRecorder.stop();
  testRecorder.clearSteps();
  await recordOneStep();
  const steps = testRecorder.getSnapshot().steps;

  await panel.openTest("tests/stored.e2e.ts");
  assert.equal(panel.getSnapshot().selectedTestPath, "tests/stored.e2e.ts");
  assert.match(panel.getSnapshot().selectedTestSource, /stored/);
  assert.deepEqual(testRecorder.getSnapshot().steps, steps, "previewing leaves the editable flow intact");
  assert.equal(testRecorder.getSnapshot().recordingDeviceId, "", "the mirror stops recording while a project file is previewed");
  assert.equal(named(calls, "mobile_testing_draft_save").length, 1, "the recording is kept before switching");
  assert.deepEqual(named(calls, "mobile_testing_read_file")[0].arguments,
    { projectPath: PROJECT, relativePath: "tests/stored.e2e.ts" });

  await panel.openDraft(DRAFT);
  assert.equal(panel.getSnapshot().selectedTestPath, "", "reopening a draft exits the project preview");
  panel.dispose();
});

test("project test edits stage before Save and Undo discards the working copy", async () => {
  const calls: { name: string; arguments: Record<string, unknown> }[] = [];
  const source = 'test("saved", async () => {});';
  const panel = open({
    mobile_testing_read_file: { source, originalHash: "a".repeat(64), staged: false },
    mobile_testing_tests: { tests: [{ relativePath: "tests/saved.e2e.ts", name: "saved.e2e.ts", updatedAt: "2026-01-01T00:00:00.000Z", sizeBytes: 20 }] },
    mobile_testing_stage_file: { staged: true },
    mobile_testing_save_staged_file: { path: `${PROJECT}/tests/saved.e2e.ts`, originalHash: "b".repeat(64) },
    mobile_testing_discard_staged_file: { source, originalHash: "a".repeat(64) },
  }, calls);
  await panel.openTest("tests/saved.e2e.ts");
  panel.editStoredTest("first edit");
  await panel.saveStoredTest();
  assert.deepEqual(named(calls, "mobile_testing_stage_file").map(call => call.arguments.source), ["first edit"]);
  assert.equal(named(calls, "mobile_testing_save_staged_file").length, 1);
  assert.equal(panel.getSnapshot().selectedTestStaged, false);
  panel.editStoredTest("second edit");
  await panel.undoStoredTest();
  assert.equal(named(calls, "mobile_testing_stage_file")[1].arguments.originalHash, "b".repeat(64), "later edits use the newly saved file as their base");
  assert.equal(panel.getSnapshot().selectedTestSource, source);
  assert.equal(panel.getSnapshot().selectedTestStaged, false);
  assert.equal(named(calls, "mobile_testing_discard_staged_file").length, 1);
  panel.dispose();
});

test("Play until a saved call runs a temporary copy without saving the project file", async () => {
  const calls: { name: string; arguments: Record<string, unknown> }[] = [];
  const source = 'test("flow", async ({ app, screen }) => {\n  await app.open();\n  await screen.getByText("A").tap();\n  await screen.getByText("B").tap();\n});';
  const panel = open({
    mobile_testing_read_file: { source, originalHash: "a".repeat(64), staged: false },
    mobile_testing_run_test: { status: "passed", steps: [{ line: 3, status: "passed" }] },
  }, calls);
  await panel.openTest("tests/flow.e2e.ts");
  await panel.runStoredTest(3);
  const run = named(calls, "mobile_testing_run_test")[0];
  assert.ok(run);
  assert.match(run.arguments.untilSource as string, /await screen\.getByText\("A"\)\.tap\(\);\n  return;/);
  assert.deepEqual(named(calls, "mobile_testing_save_staged_file"), []);
  assert.deepEqual(named(calls, "mobile_testing_write_file"), []);
  assert.equal(testRecorder.getSnapshot().run?.lines[3], "passed");
  panel.dispose();
});
