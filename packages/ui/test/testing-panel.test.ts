import test from "node:test";
import assert from "node:assert/strict";
import type { HostBridge } from "../src/host-bridge.ts";
import type { DeviceAppsStore } from "../src/device-apps.ts";
import { TestingPanel } from "../src/testing-panel.ts";
import { testRecorder } from "../src/test-recorder.ts";
import type { ScreenComponent } from "../../shared/src/screen-annotations.ts";

const UDID = "11111111-2222-3333-4444-555555555555";
const PROJECT = "/Users/someone/app";

const tab: ScreenComponent = {
  name: "Explore", label: "Explore", role: "AXButton", depth: 1, source: "accessibility", nodeId: "explore",
  bounds: { x: 0, y: 800, width: 100, height: 40 },
};

// Saving touches no device, so the store is a stub: the real one binds to the document.
const deviceApps = { subscribe: () => () => undefined, getSnapshot: () => ({ device: undefined }) } as unknown as DeviceAppsStore;

/**
 * The calls the save and run path makes, with the panel's own background plumbing left out.
 *
 * An open panel also reports its selection to the server, polls for an agent recording — see
 * `packages/core/src/testing-agent.ts` — and lists the recordings it has kept unsaved. None of the
 * three is part of what saving or running does; they are asserted where they belong, in
 * `testing-agent-panel.test.ts` and `testing-drafts-panel.test.ts`.
 */
const BACKGROUND = new Set([
  "mobile_testing_set_context", "mobile_testing_agent_state", "mobile_testing_projects", "mobile_testing_drafts",
]);
const flow = (calls: { name: string }[]) => calls.map(call => call.name).filter(name => !BACKGROUND.has(name));

function host(responses: Record<string, unknown>, calls: { name: string; arguments: Record<string, unknown> }[]) {
  return {
    async callServerTool({ name, arguments: input }: { name: string; arguments: Record<string, unknown> }) {
      calls.push({ name, arguments: input });
      return { content: [], structuredContent: responses[name] ?? {} };
    },
  } as unknown as HostBridge;
}

async function recordOneStep(panel: TestingPanel) {
  testRecorder.attach(UDID, { readComponents: async () => [tab], screen: () => ({ width: 402, height: 874 }) });
  testRecorder.start(UDID);
  // A left click records nothing now; a step comes from the element menu.
  await testRecorder.openMenu({ x: 50, y: 820 });
  await testRecorder.chooseOffer("tap");
  assert.equal(testRecorder.getSnapshot().steps.length, 1);
  assert.equal(panel.dirty, true);
}

test("a saved recording stops recording, so the next tap is not an unsaved step", async () => {
  const calls: { name: string; arguments: Record<string, unknown> }[] = [];
  const panel = new TestingPanel(host({ mobile_testing_write_file: { written: true, existed: false, path: `${PROJECT}/tests/flow.e2e.ts` } }, calls), deviceApps);
  panel.setAvailable(true);
  (panel as unknown as { update(fields: Record<string, unknown>): void }).update({ projectPath: PROJECT, fileName: "flow" });
  await recordOneStep(panel);

  await panel.saveTest();

  assert.deepEqual(flow(calls), ["mobile_testing_write_file"]);
  assert.equal(testRecorder.getSnapshot().recordingUdid, "", "recording must end with the file it produced");
  assert.equal(panel.getSnapshot().savedPath, `${PROJECT}/tests/flow.e2e.ts`);
  assert.equal(panel.dirty, false);
  // The steps stay, so the user can add to the flow and save again — they just are not armed.
  assert.equal(testRecorder.getSnapshot().steps.length, 1);
  testRecorder.clearSteps();
  testRecorder.detach(UDID);
  panel.dispose();
});

test("a save blocked by an existing file leaves the recording running", async () => {
  const calls: { name: string; arguments: Record<string, unknown> }[] = [];
  const panel = new TestingPanel(host({ mobile_testing_write_file: { written: false, existed: true, path: `${PROJECT}/tests/flow.e2e.ts` } }, calls), deviceApps);
  panel.setAvailable(true);
  (panel as unknown as { update(fields: Record<string, unknown>): void }).update({ projectPath: PROJECT, fileName: "flow" });
  await recordOneStep(panel);

  await panel.saveTest();

  assert.equal(panel.getSnapshot().overwritePath, `${PROJECT}/tests/flow.e2e.ts`);
  assert.equal(testRecorder.getSnapshot().recordingUdid, UDID, "nothing was written, so nothing is finished");
  testRecorder.stop();
  testRecorder.clearSteps();
  testRecorder.detach(UDID);
  panel.dispose();
});

test("Run saves, hands the device back, and only then runs", async () => {
  const calls: { name: string; arguments: Record<string, unknown> }[] = [];
  const panel = new TestingPanel(host({
    mobile_testing_write_file: { written: true, existed: false, path: `${PROJECT}/tests/flow.e2e.ts` },
    mobile_testing_run_test: { status: "passed", exitCode: 0, steps: [{ line: 8, status: "passed" }] },
  }, calls), deviceApps);
  panel.setAvailable(true);
  (panel as unknown as { update(fields: Record<string, unknown>): void }).update({ projectPath: PROJECT, fileName: "flow" });
  await recordOneStep(panel);

  await panel.runTest();

  // The order is the feature: the recorder holds the one agent-device session the device allows,
  // so a run spawned while it is held fails with "Device is already in use".
  assert.deepEqual(flow(calls),
    ["mobile_testing_write_file", "mobile_testing_release_device", "mobile_testing_run_test"]);
  assert.equal(testRecorder.getSnapshot().recordingUdid, "", "a recording left armed would take the session straight back");
  assert.deepEqual(calls.findLast(call => call.name === "mobile_testing_run_test")?.arguments,
    { projectPath: PROJECT, relativePath: "tests/flow.e2e.ts" });
  assert.equal(panel.getSnapshot().running, false);
  assert.equal(testRecorder.getSnapshot().run?.state, "passed");
  assert.deepEqual(testRecorder.getSnapshot().run?.lines, { 8: "passed" });
  testRecorder.clearRun();
  testRecorder.clearSteps();
  testRecorder.detach(UDID);
  panel.dispose();
});

test("Run never replaces a file without being asked, and resumes from the answer", async () => {
  const calls: { name: string; arguments: Record<string, unknown> }[] = [];
  const responses: Record<string, unknown> = {
    mobile_testing_write_file: { written: false, existed: true, path: `${PROJECT}/tests/flow.e2e.ts` },
    mobile_testing_run_test: { status: "passed", exitCode: 0, steps: [{ line: 8, status: "passed" }] },
  };
  const panel = new TestingPanel(host(responses, calls), deviceApps);
  panel.setAvailable(true);
  (panel as unknown as { update(fields: Record<string, unknown>): void }).update({ projectPath: PROJECT, fileName: "flow" });
  await recordOneStep(panel);

  await panel.runTest();

  assert.equal(panel.getSnapshot().overwritePath, `${PROJECT}/tests/flow.e2e.ts`);
  assert.deepEqual(flow(calls), ["mobile_testing_write_file"], "nothing ran over a file the user has not agreed to replace");

  responses.mobile_testing_write_file = { written: true, existed: true, path: `${PROJECT}/tests/flow.e2e.ts` };
  await panel.saveTest(true);
  // Saving does not block on a run that may take minutes, so the resumed run lands after it.
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));
  // The answer finishes what Run began, so the user does not press Run twice.
  assert.deepEqual(flow(calls),
    ["mobile_testing_write_file", "mobile_testing_write_file", "mobile_testing_release_device", "mobile_testing_run_test"]);
  testRecorder.clearRun();
  testRecorder.clearSteps();
  testRecorder.detach(UDID);
  panel.dispose();
});

test("a failing run keeps its mark on the line the report blames", async () => {
  const calls: { name: string; arguments: Record<string, unknown> }[] = [];
  const panel = new TestingPanel(host({
    mobile_testing_write_file: { written: true, existed: false, path: `${PROJECT}/tests/flow.e2e.ts` },
    mobile_testing_run_test: { status: "failed", exitCode: 1, steps: [{ line: 8, status: "passed" }, { line: 9, status: "failed", error: "Timed out" }] },
  }, calls), deviceApps);
  panel.setAvailable(true);
  (panel as unknown as { update(fields: Record<string, unknown>): void }).update({ projectPath: PROJECT, fileName: "flow" });
  await recordOneStep(panel);

  await panel.runTest();

  const run = testRecorder.getSnapshot().run;
  assert.equal(run?.state, "failed");
  assert.deepEqual(run?.lines, { 8: "passed", 9: "failed" });
  assert.equal(run?.error, "Timed out");
  assert.equal(run?.stale, undefined, "the result is about the file as it was just emitted");
  testRecorder.clearRun();
  testRecorder.clearSteps();
  testRecorder.detach(UDID);
  panel.dispose();
});
