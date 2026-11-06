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
  await testRecorder.record({ x: 50, y: 820 });
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

  assert.equal(calls.at(-1)?.name, "mobile_testing_write_file");
  assert.equal(testRecorder.getSnapshot().recordingUdid, "", "recording must end with the file it produced");
  assert.equal(panel.getSnapshot().savedPath, `${PROJECT}/tests/flow.e2e.ts`);
  assert.equal(panel.dirty, false);
  // The steps stay, so the user can add to the flow and save again — they just are not armed.
  assert.equal(testRecorder.getSnapshot().steps.length, 1);
  testRecorder.clearSteps();
  testRecorder.detach(UDID);
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
});
