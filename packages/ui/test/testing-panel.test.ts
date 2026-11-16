import test from "node:test";
import assert from "node:assert/strict";
import type { HostBridge } from "../src/host-bridge.ts";
import type { DeviceAppsStore } from "../src/device-apps.ts";
import { TestingPanel } from "../src/testing-panel.ts";
import { OPEN_STEP, testRecorder } from "../src/test-recorder.ts";
import type { ScreenComponent } from "../../shared/src/screen-annotations.ts";

const UDID = "11111111-2222-3333-4444-555555555555";
const PROJECT = "/Users/someone/app";

const tab: ScreenComponent = {
  name: "Explore", label: "Explore", role: "AXButton", depth: 1, source: "accessibility", nodeId: "explore",
  bounds: { x: 0, y: 800, width: 100, height: 40 },
};

// Saving touches no device, so the store is a stub: the real one binds to the document.
/** A booted simulator with an app in front, for runs that need an app to pin. */
const frontApps = { subscribe: () => () => undefined, getSnapshot: () => ({ device: { udid: "udid", name: "iPhone", state: "Booted", platform: "ios", kind: "simulator" }, apps: [], foregroundApp: { bundleId: "com.example.app", pid: 1 }, ready: false }) } as unknown as DeviceAppsStore;
const deviceApps = { subscribe: () => () => undefined, getSnapshot: () => ({ device: undefined }) } as unknown as DeviceAppsStore;

/**
 * The calls the save and run path makes, with the panel's own background plumbing left out.
 *
 * An open panel also reports its selection to the server, polls for an agent recording — see
 * `packages/core/src/testing-agent.ts` — and lists both halves of its own list: the recordings it
 * has kept unsaved and the tests the project already holds. None of them is part of what saving or
 * running does; they are asserted where they belong, in `testing-agent-panel.test.ts` and
 * `testing-drafts-panel.test.ts`.
 */
const BACKGROUND = new Set([
  "mobile_testing_set_context", "mobile_testing_agent_state", "mobile_testing_projects", "mobile_testing_drafts",
  "mobile_testing_tests",
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
  testRecorder.attach(UDID, "ios", { readComponents: async () => [tab], screen: () => ({ width: 402, height: 874 }) });
  testRecorder.start(UDID, "ios");
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
  assert.equal(testRecorder.getSnapshot().recordingDeviceId, "", "recording must end with the file it produced");
  assert.equal(panel.getSnapshot().savedPath, `${PROJECT}/tests/flow.e2e.ts`);
  assert.equal(panel.dirty, false);
  // The steps stay, so the user can add to the flow and save again — they just are not armed.
  assert.equal(testRecorder.getSnapshot().steps.length, 1);
  testRecorder.clearSteps();
  testRecorder.detach(UDID, "ios");
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
  assert.equal(testRecorder.getSnapshot().recordingDeviceId, UDID, "nothing was written, so nothing is finished");
  testRecorder.stop();
  testRecorder.clearSteps();
  testRecorder.detach(UDID, "ios");
  panel.dispose();
});

test("Run stages the current preview without saving, and hands the device back first", async () => {
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
  assert.deepEqual(flow(calls), ["mobile_testing_release_device", "mobile_testing_run_test"]);
  assert.equal(testRecorder.getSnapshot().recordingDeviceId, "", "a recording left armed would take the session straight back");
  const run = calls.findLast(call => call.name === "mobile_testing_run_test")?.arguments ?? {};
  assert.equal(run.projectPath, PROJECT);
  assert.equal(run.relativePath, "tests/flow.e2e.ts");
  assert.equal(run.untilSource, testRecorder.source);
  assert.equal(panel.dirty, true, "Run remains independent from Save");
  assert.equal(panel.getSnapshot().running, false);
  assert.equal(testRecorder.getSnapshot().run?.state, "passed");
  assert.deepEqual(testRecorder.getSnapshot().run?.lines, { 8: "passed" });
  testRecorder.clearRun();
  testRecorder.clearSteps();
  testRecorder.detach(UDID, "ios");
  panel.dispose();
});

test("a project test polls live progress against its own source lines", async () => {
  const calls: { name: string; arguments: Record<string, unknown> }[] = [];
  let finishRun!: (value: unknown) => void;
  const pendingRun = new Promise(resolve => { finishRun = resolve; });
  const app = {
    async callServerTool({ name, arguments: input }: { name: string; arguments: Record<string, unknown> }) {
      calls.push({ name, arguments: input });
      if (name === "mobile_testing_run_test") {
        const structuredContent = await pendingRun;
        return { content: [], structuredContent };
      }
      if (name === "mobile_testing_run_progress") return { content: [], structuredContent: { progress: [
        { stepIndex: 0, phase: "start" }, { stepIndex: 0, phase: "end", status: "passed" },
        { stepIndex: 1, phase: "start" },
      ] } };
      return { content: [], structuredContent: {} };
    },
  } as unknown as HostBridge;
  const panel = new TestingPanel(app, deviceApps);
  panel.setAvailable(true);
  const source = 'test("stored", async ({ app, screen }) => {\n  await app.open();\n  await screen.getByText("Done").tap();\n});';
  (panel as unknown as { update(fields: Record<string, unknown>): void }).update({
    projectPath: PROJECT, runtimeMode: "project", selectedTestPath: "tests/stored.e2e.ts", selectedTestSource: source, configPath: `${PROJECT}/e2e.config.ts`,
  });

  const running = panel.runStoredTest();
  const deadline = Date.now() + 1_500;
  while (!calls.some(call => call.name === "mobile_testing_run_progress") && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 25));
  }

  assert.ok(calls.some(call => call.name === "mobile_testing_run_progress"), "project runs poll while the runner is in flight");
  assert.deepEqual(testRecorder.getSnapshot().run?.lines, { 2: "passed", 3: "running" },
    "runner indexes map to the awaited calls in the saved project's source");
  finishRun({ status: "passed", exitCode: 0, steps: [{ line: 2, status: "passed" }, { line: 3, status: "passed" }] });
  await running;

  testRecorder.clearRun();
  panel.dispose();
});

test("Play until here runs the flow cut short, and never writes the test", async () => {
  const calls: { name: string; arguments: Record<string, unknown> }[] = [];
  const panel = new TestingPanel(host({
    mobile_testing_run_test: { status: "passed", exitCode: 0, steps: [{ line: 8, status: "passed" }] },
  }, calls), deviceApps);
  panel.setAvailable(true);
  (panel as unknown as { update(fields: Record<string, unknown>): void }).update({ projectPath: PROJECT, fileName: "flow" });
  await recordOneStep(panel);
  // A second step, so there is something below the one being played to.
  await testRecorder.openMenu({ x: 50, y: 820 });
  await testRecorder.chooseOffer("tap");
  const [first] = testRecorder.getSnapshot().steps;
  const full = testRecorder.source.split("\n");

  await panel.runTest({ untilStepId: first!.id });

  // No write at all: a half-run must not raise the overwrite question, and must not leave the
  // saved test cut down to the part that was tried.
  assert.deepEqual(flow(calls), ["mobile_testing_release_device", "mobile_testing_run_test"]);
  assert.equal(panel.dirty, true, "nothing was saved, so the recording is still ahead of the file");
  const sent = calls.findLast(call => call.name === "mobile_testing_run_test")?.arguments ?? {};
  assert.equal(sent.relativePath, "tests/flow.e2e.ts");
  // The copy is the file's own text with the second step's line taken out and nothing else moved:
  // every line it keeps is at the line number it has in the full file, which is what lets the
  // runner's report mark the preview's own lines with no translation.
  assert.deepEqual(String(sent.untilSource).split("\n"), [...full.slice(0, 8), ...full.slice(9)]);
  assert.equal(testRecorder.getSnapshot().run?.state, "passed");
  assert.equal(testRecorder.getSnapshot().run?.untilLine, 8, "a verdict about part of the flow has to say so");

  // The app opening on its own: the header's own call, with none of the steps under it.
  await panel.runTest({ untilStepId: OPEN_STEP });
  const opening = String(calls.findLast(call => call.name === "mobile_testing_run_test")?.arguments.untilSource);
  assert.equal(opening.includes("await app.open();"), true);
  assert.deepEqual(opening.split("\n").filter(line => line.includes("await ")), ["  await app.open();"],
    "nothing is driven after it, which is the whole of what this run asks");
  assert.equal(testRecorder.getSnapshot().run?.untilLine, 6);
  testRecorder.clearRun();
  testRecorder.clearSteps();
  testRecorder.detach(UDID, "ios");
  panel.dispose();
});

test("model selection resumes the exact pending run once, and cancel drops it", async () => {
  const calls: { name: string; arguments: Record<string, unknown> }[] = [];
  const responses: Record<string, unknown> = {
    mobile_testing_model_preference: { saved: true },
    mobile_testing_run_test: { status: "passed", exitCode: 0, steps: [{ line: 8, status: "passed" }] },
  };
  const panel = new TestingPanel(host(responses, calls), deviceApps);
  panel.setAvailable(true);
  (panel as unknown as { update(fields: Record<string, unknown>): void }).update({ projectPath: PROJECT, fileName: "flow", runtimeMode: "bundled", targets: [{ name: "ios", platform: "ios", bundleId: "com.example.app" }], targetName: "ios" });
  testRecorder.clearSteps();
  testRecorder.editSource('import { test } from "e2e";\ntest("agent", async ({ agent }) => {\n  await agent.act("open settings");\n});\n');

  await panel.runTest();
  assert.equal(panel.getSnapshot().modelPickerOpen, true);
  assert.deepEqual(flow(calls), []);
  await Promise.all([
    panel.saveModelPreference({ provider: "chatgpt", model: "gpt-6-luna" }),
    panel.saveModelPreference({ provider: "chatgpt", model: "gpt-6-luna" }),
  ]);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(flow(calls).filter(name => name === "mobile_testing_run_test").length, 1);
  assert.equal(flow(calls).filter(name => name === "mobile_testing_model_preference").length, 1, "double Use model cannot duplicate the pending run");

  (panel as unknown as { update(fields: Record<string, unknown>): void }).update({ modelPreference: undefined });
  await panel.runTest();
  panel.closeModelPicker();
  await panel.saveModelPreference({ provider: "chatgpt", model: "gpt-6-luna" });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(flow(calls).filter(name => name === "mobile_testing_run_test").length, 1, "cancelled pending work does not resume");
  testRecorder.clearRun();
  testRecorder.clearSteps();
  testRecorder.detach(UDID, "ios");
  panel.dispose();
});

test("stored Play until here resumes with the same cutoff after model selection", async () => {
  const calls: { name: string; arguments: Record<string, unknown> }[] = [];
  const source = 'test("stored", async ({ agent }) => {\n  await agent.act("first");\n  await agent.act("second");\n});\n';
  const panel = new TestingPanel(host({
    mobile_testing_model_preference: { saved: true },
    mobile_testing_run_test: { status: "passed", exitCode: 0, steps: [{ line: 2, status: "passed" }] },
  }, calls), frontApps);
  panel.setAvailable(true);
  (panel as unknown as { update(fields: Record<string, unknown>): void }).update({
    projectPath: PROJECT, runtimeMode: "bundled", selectedTestPath: "tests/stored.e2e.ts", selectedTestSource: source,
    targets: [{ name: "ios", platform: "ios", bundleId: "com.example.app" }], targetName: "ios",
  });

  await panel.runStoredTest(2);
  assert.equal(panel.getSnapshot().modelPickerOpen, true);
  await panel.saveModelPreference({ provider: "chatgpt", model: "gpt-6-luna" });
  await new Promise(resolve => setTimeout(resolve, 0));
  const run = calls.find(call => call.name === "mobile_testing_run_test")!;
  assert.match(String(run.arguments.untilSource), /agent\.act\("first"\)/);
  assert.match(String(run.arguments.untilSource), /agent\.act\("first"\);\n  return;\n  await agent\.act\("second"\)/,
    "the cutoff preserves line mapping and makes later calls unreachable");
  assert.equal(calls.filter(call => call.name === "mobile_testing_run_test").length, 1);
  testRecorder.clearRun();
  panel.dispose();
});

test("OAuth links use the host open-link boundary and reject non-web schemes", async () => {
  const opened: string[] = [];
  const app = {
    async callServerTool() { return { content: [], structuredContent: {} }; },
    async openLink({ url }: { url: string }) { opened.push(url); return {}; },
  } as unknown as HostBridge;
  const panel = new TestingPanel(app, deviceApps);
  await panel.openLoginUrl("https://auth.example.test/start");
  assert.deepEqual(opened, ["https://auth.example.test/start"]);
  await assert.rejects(panel.openLoginUrl("file:///tmp/oauth"), /web sign-in/);
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
  testRecorder.detach(UDID, "ios");
  panel.dispose();
});

test("a booted Android emulator is recordable and a target of the wrong platform is reported", () => {
  const emulator = { udid: "emulator-5554", name: "Pixel", state: "Booted", runtime: "", platform: "android", kind: "emulator" };
  const store = { subscribe: () => () => undefined, getSnapshot: () => ({ device: emulator }) } as unknown as DeviceAppsStore;
  const panel = new TestingPanel(host({}, []), store);
  const update = (panel as unknown as { update(fields: Record<string, unknown>): void }).update.bind(panel);
  update({ targets: [{ name: "ios", platform: "ios", bundleId: "a" }, { name: "android", platform: "android", bundleId: "a" }], targetName: "ios" });
  assert.match(panel.targetMismatch, /is ios, but the mirror shows an Android device/);
  update({ targetName: "android" });
  assert.equal(panel.targetMismatch, "");
});

test("a Studio test with no app pins the one in front on its first run, then runs against the pin", async () => {
  const calls: { name: string; arguments: Record<string, unknown> }[] = [];
  const source = 'test("stored", async ({ app }) => {\n  await app.open();\n});\n';
  const panel = new TestingPanel(host({ mobile_testing_run_test: { status: "passed", exitCode: 0, steps: [] } }, calls), frontApps);
  panel.setAvailable(true);
  (panel as unknown as { update(fields: Record<string, unknown>): void }).update({ projectPath: PROJECT, runtimeMode: "bundled", selectedTestPath: "tests/stored.e2e.ts", selectedTestSource: source, tests: [{ relativePath: "tests/stored.e2e.ts", name: "stored.e2e.ts", updatedAt: "", sizeBytes: 1 }] });
  await panel.runStoredTest();
  const first = calls.find(call => call.name === "mobile_testing_run_test")!;
  assert.deepEqual([first.arguments.platform, first.arguments.bundleId, first.arguments.pin], ["ios", "com.example.app", true]);
  calls.length = 0;
  (panel as unknown as { update(fields: Record<string, unknown>): void }).update({ tests: [{ relativePath: "tests/stored.e2e.ts", name: "stored.e2e.ts", updatedAt: "", sizeBytes: 1, target: { platform: "ios", bundleId: "com.pinned.app" } }] });
  await panel.runStoredTest();
  assert.ok(calls.some(call => call.name === "mobile_launch_app" && call.arguments.bundleId === "com.pinned.app"), "the pinned app is opened when it is not in front");
  const second = calls.find(call => call.name === "mobile_testing_run_test")!;
  assert.deepEqual([second.arguments.bundleId, second.arguments.pin], ["com.pinned.app", undefined]);
  panel.dispose();
});

test("Run is unavailable for a Studio test with neither a pinned app nor one in front", () => {
  const panel = new TestingPanel(host({}, []), deviceApps);
  panel.setAvailable(true);
  (panel as unknown as { update(fields: Record<string, unknown>): void }).update({ projectPath: PROJECT, runtimeMode: "bundled", selectedTestPath: "tests/stored.e2e.ts", selectedTestSource: "x" });
  assert.equal(panel.canRunStored, false);
  assert.match(panel.storedRunHint, /Open the app in the mirror/);
  panel.dispose();
});
