import test from "node:test";
import assert from "node:assert/strict";
import type { HostBridge } from "../src/host-bridge.ts";
import type { DeviceAppsStore } from "../src/device-apps.ts";
import { TestingPanel, launchErrorMessage } from "../src/testing-panel.ts";
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
  finishRun({ status: "passed", exitCode: 0, steps: [{ stepIndex: 0, status: "passed" }, { stepIndex: 1, status: "passed" }] });
  await running;
  assert.deepEqual(testRecorder.getSnapshot().run?.lines, { 2: "passed", 3: "passed" },
    "a runner that omitted source locations still marks the final result against its awaited calls");

  testRecorder.clearRun();
  panel.dispose();
});

test("step indexes in an edited recording use the saved source's awaited calls", async () => {
  const panel = new TestingPanel(host({
    mobile_testing_write_file: { written: true, existed: false, path: `${PROJECT}/tests/flow.e2e.ts` },
    mobile_testing_run_test: { status: "failed", steps: [
      { stepIndex: 1, status: "failed", error: "Button missing" }, { stepIndex: 0, status: "passed" },
    ] },
  }, []), deviceApps);
  panel.setAvailable(true);
  (panel as unknown as { update(fields: Record<string, unknown>): void }).update({ projectPath: PROJECT, fileName: "flow" });
  testRecorder.editSource('test("flow", async ({ app, screen }) => {\n  await app.open();\n\n  await screen.getByText("Done").tap();\n});');
  try {
    await panel.runTest();
    assert.deepEqual(testRecorder.getSnapshot().run?.lines, { 2: "passed", 4: "failed" });
    assert.equal(testRecorder.getSnapshot().run?.error, "Button missing");
  } finally {
    testRecorder.clearRun();
    testRecorder.clearSteps();
    panel.dispose();
  }
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
  assert.match(panel.targetMismatch, /runs on iOS, but the mirror shows an Android emulator/);
  update({ targetName: "android" });
  assert.equal(panel.targetMismatch, "");
});

test("Testing Studio does not flash a mirror mismatch while the switched device's app is still unknown", () => {
  // Switching the mirror clears the foreground app and re-reads Testing Studio's target once it is found.
  // In between, the target is still the other platform's: warning then makes the message flicker.
  const emulator = { udid: "emulator-5554", name: "Pixel", state: "Booted", runtime: "", platform: "android", kind: "emulator" };
  let snapshot: Record<string, unknown> = { device: emulator, apps: [], foregroundApp: null, ready: false };
  const store = { subscribe: () => () => undefined, getSnapshot: () => snapshot } as unknown as DeviceAppsStore;
  const panel = new TestingPanel(host({}, []), store);
  const update = (panel as unknown as { update(fields: Record<string, unknown>): void }).update.bind(panel);
  update({ studioPath: PROJECT, projectPath: PROJECT, targets: [{ name: "ios", platform: "ios", bundleId: "com.ios" }], targetName: "ios" });
  assert.equal(panel.targetMismatch, "", "device just switched: nothing is known yet");
  snapshot = { ...snapshot, ready: true, foregroundApp: { bundleId: "com.android", pid: 1 } };
  assert.equal(panel.targetMismatch, "", "the foreground app is found but its target has not been re-read");
  update({ targets: [{ name: "android", platform: "android", bundleId: "com.android" }], targetName: "android" });
  assert.equal(panel.targetMismatch, "");
  // Steady when it truly applies: the app in front is the target and it is on the other platform.
  update({ targets: [{ name: "ios", platform: "ios", bundleId: "com.android" }], targetName: "ios" });
  assert.match(panel.targetMismatch, /The mirror shows an Android emulator/);
  panel.dispose();
});

test("a Testing Studio test with no app pins the one in front on its first run, then runs against the pin", async () => {
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

test("a Testing Studio save pins the app in front, not a stale target from an earlier app", async () => {
  const calls: { name: string; arguments: Record<string, unknown> }[] = [];
  const panel = new TestingPanel(host({ mobile_testing_write_file: { written: true, existed: false, path: `${PROJECT}/tests/flow.e2e.ts` } }, calls), frontApps);
  panel.setAvailable(true);
  (panel as unknown as { update(fields: Record<string, unknown>): void }).update({ projectPath: PROJECT, fileName: "flow", runtimeMode: "bundled", targets: [{ name: "foreground", platform: "ios", bundleId: "com.stale.app" }], targetName: "foreground" });
  await recordOneStep(panel);
  await panel.saveTest();
  const write = calls.find(call => call.name === "mobile_testing_write_file")!;
  assert.deepEqual([write.arguments.platform, write.arguments.bundleId], ["ios", "com.example.app"]);
  testRecorder.clearSteps();
  testRecorder.detach(UDID, "ios");
  panel.dispose();
});

test("a Testing Studio save shows its pin at once, even when the next listing has not caught up", async () => {
  const calls: { name: string; arguments: Record<string, unknown> }[] = [];
  const listed = { relativePath: "tests/flow.e2e.ts", name: "flow.e2e.ts", updatedAt: "", sizeBytes: 1 };
  const panel = new TestingPanel(host({ mobile_testing_write_file: { written: true, existed: false, path: "Testing Studio/tests/flow.e2e.ts" }, mobile_testing_tests: { tests: [listed] } }, calls), frontApps);
  const update = (panel as unknown as { update(fields: Record<string, unknown>): void }).update.bind(panel);
  panel.setAvailable(true);
  update({ projectPath: PROJECT, fileName: "flow", runtimeMode: "bundled", tests: [listed] });
  await recordOneStep(panel);
  await panel.saveTest();
  const path = calls.find(call => call.name === "mobile_testing_write_file")!.arguments.relativePath as string;
  assert.equal(path, listed.relativePath);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(calls.some(call => call.name === "mobile_testing_tests"), "the list is re-read after a save");
  update({ selectedTestPath: path });
  assert.deepEqual(panel.storedTarget, { platform: "ios", bundleId: "com.example.app" });
  testRecorder.clearSteps();
  testRecorder.detach(UDID, "ios");
  panel.dispose();
});

test("a Testing Studio test pinned by its first run shows the pin while the run is still going", async () => {
  const source = 'test("stored", async ({ app }) => {\n  await app.open();\n});\n';
  let duringRun: unknown;
  let panel: TestingPanel;
  const bridge = {
    async callServerTool({ name }: { name: string }) {
      if (name === "mobile_testing_run_test") duringRun = panel.storedTarget;
      return { content: [], structuredContent: name === "mobile_testing_run_test" ? { status: "passed", exitCode: 0, steps: [] } : {} };
    },
  } as unknown as HostBridge;
  panel = new TestingPanel(bridge, frontApps);
  panel.setAvailable(true);
  (panel as unknown as { update(fields: Record<string, unknown>): void }).update({ projectPath: PROJECT, runtimeMode: "bundled", selectedTestPath: "tests/stored.e2e.ts", selectedTestSource: source, tests: [{ relativePath: "tests/stored.e2e.ts", name: "stored.e2e.ts", updatedAt: "", sizeBytes: 1 }] });
  await panel.runStoredTest();
  assert.deepEqual(duringRun, { platform: "ios", bundleId: "com.example.app" });
  panel.dispose();
});

test("a pinned Testing Studio test can run when its app is installed but not running", () => {
  const running = { subscribe: () => () => undefined, getSnapshot: () => ({ device: { udid: "udid", name: "iPhone", state: "Booted", platform: "ios", kind: "simulator" }, apps: [{ bundleId: "com.other.app", pid: 2 }], foregroundApp: { bundleId: "com.other.app", pid: 2 }, ready: true }) } as unknown as DeviceAppsStore;
  const panel = new TestingPanel(host({}, []), running);
  panel.setAvailable(true);
  (panel as unknown as { update(fields: Record<string, unknown>): void }).update({ projectPath: PROJECT, runtimeMode: "bundled", selectedTestPath: "tests/stored.e2e.ts", selectedTestSource: "x", tests: [{ relativePath: "tests/stored.e2e.ts", name: "stored.e2e.ts", updatedAt: "", sizeBytes: 1, target: { platform: "ios", bundleId: "com.pinned.app" } }] });
  assert.equal(panel.storedRunHint, "");
  assert.equal(panel.canRunStored, true);
  panel.dispose();
});

test("a Testing Studio test pinned to iOS only offers and runs on iOS devices", () => {
  const panel = new TestingPanel(host({}, []), frontApps);
  panel.setAvailable(true);
  (panel as unknown as { update(fields: Record<string, unknown>): void }).update({
    projectPath: PROJECT, runtimeMode: "bundled", selectedTestPath: "tests/stored.e2e.ts", selectedTestSource: "x",
    tests: [{ relativePath: "tests/stored.e2e.ts", name: "stored.e2e.ts", updatedAt: "", sizeBytes: 1, target: { platform: "ios", bundleId: "com.pinned.app" } }],
    targets: [{ name: "android", platform: "android", bundleId: "com.stale.android" }],
    matrixDevices: [{ deviceId: "sim", platform: "ios", name: "iPhone" }, { deviceId: "emu", platform: "android", name: "Pixel" }],
  });
  panel.setMatrixSelection(["sim", "emu"]);
  try {
    assert.equal(panel.matrixPlatform, "ios");
    assert.deepEqual(panel.matrixSelection.map(device => device.deviceId), ["sim"]);
    assert.deepEqual(panel.matrixApps(), { ios: "com.pinned.app" });
  } finally { panel.dispose(); }
});

const androidFront = { subscribe: () => () => undefined, getSnapshot: () => ({ device: { udid: "emulator-5554", name: "Pixel", state: "Booted", runtime: "", platform: "android", kind: "emulator" }, apps: [], foregroundApp: { bundleId: "com.example.android", pid: 3 }, ready: true }) } as unknown as DeviceAppsStore;
const iosOnly = { relativePath: "tests/stored.e2e.ts", name: "stored.e2e.ts", updatedAt: "", sizeBytes: 1, target: { platform: "ios", bundleId: "com.pinned.app" } };

test("an iOS-only Testing Studio test on an Android mirror says so and adds the Android app in front", async () => {
  const calls: { name: string; arguments: Record<string, unknown> }[] = [];
  const panel = new TestingPanel(host({ mobile_testing_set_target: { pinned: true } }, calls), androidFront);
  panel.setAvailable(true);
  (panel as unknown as { update(fields: Record<string, unknown>): void }).update({ projectPath: PROJECT, runtimeMode: "bundled", selectedTestPath: "tests/stored.e2e.ts", selectedTestSource: "x", tests: [iosOnly] });
  assert.match(panel.storedRunHint, /recorded on iOS and has no Android app yet. Add com\.example\.android/);
  assert.equal(panel.canAddForegroundApp, true);
  assert.equal(panel.canRunStored, false);
  await panel.repinStoredTest();
  const set = calls.find(call => call.name === "mobile_testing_set_target")!;
  assert.deepEqual([set.arguments.platform, set.arguments.bundleId, set.arguments.mode], ["android", "com.example.android", "add"]);
  panel.dispose();
});

test("a Testing Studio test with apps on both platforms runs the mirrored platform's app and offers both in the matrix", async () => {
  const calls: { name: string; arguments: Record<string, unknown> }[] = [];
  const source = 'test("stored", async ({ app }) => {\n  await app.open();\n});\n';
  const panel = new TestingPanel(host({ mobile_testing_run_test: { status: "passed", exitCode: 0, steps: [] } }, calls), androidFront);
  panel.setAvailable(true);
  (panel as unknown as { update(fields: Record<string, unknown>): void }).update({ projectPath: PROJECT, runtimeMode: "bundled", selectedTestPath: "tests/stored.e2e.ts", selectedTestSource: source,
    tests: [{ ...iosOnly, target: { ...iosOnly.target, apps: { android: "com.pinned.android" } } }] });
  assert.equal(panel.storedRunHint, "");
  assert.equal(panel.matrixPlatform, undefined);
  assert.deepEqual(panel.matrixApps(), { ios: "com.pinned.app", android: "com.pinned.android" });
  await panel.runStoredTest();
  const run = calls.find(call => call.name === "mobile_testing_run_test")!;
  assert.deepEqual([run.arguments.platform, run.arguments.bundleId, run.arguments.pin], ["android", "com.pinned.android", undefined]);
  panel.dispose();
});

test("a line that failed on Android is re-recorded there behind a platform branch, and saved", async () => {
  const calls: { name: string; arguments: Record<string, unknown> }[] = [];
  const source = 'import { test } from "@e2e-dev/mobile";\nimport { expect } from "e2e";\ntest("flow", async ({ app, screen }) => {\n  await app.open();\n  await expect(screen.getByTestId("Home")).toBeVisible();\n});\n';
  const panel = new TestingPanel(host({ mobile_testing_save_staged_file: { saved: true, originalHash: "h2" } }, calls), androidFront);
  panel.setAvailable(true);
  (panel as unknown as { update(fields: Record<string, unknown>): void }).update({ projectPath: PROJECT, runtimeMode: "bundled", selectedTestPath: "tests/stored.e2e.ts", selectedTestSource: source, selectedTestOriginalHash: "h1",
    tests: [{ ...iosOnly, target: { ...iosOnly.target, apps: { android: "com.example.android" } } }] });
  testRecorder.attach("emulator-5554", "android", { readComponents: async () => [{ name: "Home", label: "Home", text: "Home", role: "text", depth: 1, source: "accessibility", nodeId: "home", bounds: { x: 0, y: 100, width: 200, height: 40 } }], screen: () => ({ width: 402, height: 874 }) });
  testRecorder.beginRun();
  testRecorder.finishRun({ status: "failed", steps: [{ line: 5, status: "failed", error: "Not found" }] });
  assert.equal(panel.reRecordLine, 5);
  await panel.reRecordStoredLine(5);
  assert.equal(testRecorder.getSnapshot().picking, true);
  await testRecorder.openMenu({ x: 100, y: 120 });
  testRecorder.confirmPick();
  await new Promise(resolve => setTimeout(resolve, 0));
  const staged = calls.find(call => call.name === "mobile_testing_stage_file")!;
  assert.match(staged.arguments.source as string, /async \(\{ app, screen, platform \}\)/);
  assert.match(staged.arguments.source as string, /expect\(platform === "android" \? screen\.getByText\("Home"\) : screen\.getByTestId\("Home"\)\)/);
  assert.ok(calls.some(call => call.name === "mobile_testing_save_staged_file"), "the change is saved");
  testRecorder.detach("emulator-5554", "android");
  panel.dispose();
});

test("re-recording a line that failed on an Android lane brings the Android mirror forward first", async () => {
  const iosFront = { subscribe: () => () => undefined, getSnapshot: () => ({ device: { udid: "sim", name: "iPhone", state: "Booted", runtime: "", platform: "ios", kind: "simulator" }, apps: [], foregroundApp: { bundleId: "com.pinned.app", pid: 3 }, ready: true }) } as unknown as DeviceAppsStore;
  const source = 'test("flow", async ({ app, screen }) => {\n  await app.open();\n  await expect(screen.getByTestId("Home")).toBeVisible();\n});\n';
  const panel = new TestingPanel(host({}, []), iosFront);
  panel.setAvailable(true);
  (panel as unknown as { update(fields: Record<string, unknown>): void }).update({ projectPath: PROJECT, runtimeMode: "bundled", selectedTestPath: "tests/stored.e2e.ts", selectedTestSource: source,
    tests: [{ ...iosOnly, target: { ...iosOnly.target, apps: { android: "com.example.android" } } }] });
  // What showLane records for the Android lane of a matrix run.
  (panel as unknown as { runPlatform: string }).runPlatform = "android";
  testRecorder.beginRun();
  testRecorder.finishRun({ status: "failed", steps: [{ line: 3, status: "failed", error: "Not found" }] });
  const focused: string[] = [];
  panel.setMirrorFocus(platform => { focused.push(platform); return false; });
  try {
    assert.deepEqual(panel.reRecord, { line: 3, platform: "android", ready: false });
    await panel.reRecordStoredLine(3);
    assert.deepEqual(focused, ["android"], "the Android mirror is brought forward");
    assert.match(panel.getSnapshot().error ?? "", /Show a booted Android emulator in the mirror to re-record line 3/);
  } finally { panel.dispose(); }
});

test("opening an app on the mirror keeps the open Testing Studio test selected", async () => {
  const listeners = new Set<() => void>();
  let snapshot: Record<string, unknown> = { device: { udid: "emulator-5554", name: "Pixel", state: "Booted", runtime: "", platform: "android", kind: "emulator" }, apps: [], foregroundApp: null, ready: true };
  const apps = { subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); }, getSnapshot: () => snapshot } as unknown as DeviceAppsStore;
  const calls: { name: string; arguments: Record<string, unknown> }[] = [];
  const panel = new TestingPanel(host({ mobile_testing_project_config: { runtimeMode: "bundled", targets: [{ name: "android", platform: "android", bundleId: "com.example.android" }] } }, calls), apps);
  panel.setAvailable(true);
  (panel as unknown as { update(fields: Record<string, unknown>): void }).update({ projectPath: PROJECT, runtimeMode: "bundled", targets: [], selectedTestPath: "tests/stored.e2e.ts", selectedTestSource: "x", tests: [iosOnly] });
  snapshot = { ...snapshot, foregroundApp: { bundleId: "com.example.android", pid: 3 } };
  for (const listener of listeners) listener();
  await new Promise(resolve => setTimeout(resolve, 0));
  try {
    assert.equal(panel.getSnapshot().selectedTestPath, "tests/stored.e2e.ts");
    assert.deepEqual(panel.getSnapshot().targets.map(target => target.bundleId), ["com.example.android"]);
  } finally { panel.dispose(); }
});

test("Run is unavailable for a Testing Studio test with neither a pinned app nor one in front", () => {
  const panel = new TestingPanel(host({}, []), deviceApps);
  panel.setAvailable(true);
  (panel as unknown as { update(fields: Record<string, unknown>): void }).update({ projectPath: PROJECT, runtimeMode: "bundled", selectedTestPath: "tests/stored.e2e.ts", selectedTestSource: "x" });
  assert.equal(panel.canRunStored, false);
  assert.match(panel.storedRunHint, /Open the app in the mirror/);
  panel.dispose();
});

test("a launch of a missing app says to build and install it, and other launch errors pass through", () => {
  assert.equal(launchErrorMessage("com.app is not installed or has no launcher activity.", "com.app", "android"),
    "com.app is not installed on this emulator. Build and install it (for an Expo app, `npx expo run:android`), then launch again.");
  assert.match(launchErrorMessage("com.app is not installed or could not open.", "com.app", "ios"), /this simulator.*npx expo run:ios/);
  assert.equal(launchErrorMessage("The device is busy.", "com.app", "ios"), "The device is busy.");
});

test("an Apple app in front replaces the last app's target in No project mode instead of keeping it", async () => {
  const listeners = new Set<() => void>();
  let snapshot: Record<string, unknown> = { device: { udid: "sim", name: "iPhone", state: "Booted", runtime: "", platform: "ios", kind: "simulator" }, apps: [], foregroundApp: { bundleId: "com.bare.rn", pid: 2 }, ready: true };
  const apps = { subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); }, getSnapshot: () => snapshot } as unknown as DeviceAppsStore;
  const calls: { name: string; arguments: Record<string, unknown> }[] = [];
  const panel = new TestingPanel(host({ mobile_testing_project_config: { runtimeMode: "bundled", targetSource: "foreground", targets: [{ name: "ios", platform: "ios", bundleId: "com.apple.Fitness" }] } }, calls), apps);
  panel.setAvailable(true);
  (panel as unknown as { update(fields: Record<string, unknown>): void }).update({ projectPath: PROJECT, studioPath: PROJECT, runtimeMode: "bundled", targetSource: "foreground", targets: [{ name: "ios", platform: "ios", bundleId: "com.bare.rn" }] });
  // The device list names only apps it can monitor, so Fitness arrives as a pid alone.
  snapshot = { ...snapshot, foregroundApp: { bundleId: null, pid: 9 } };
  for (const listener of listeners) listener();
  await new Promise(resolve => setTimeout(resolve, 0));
  try {
    const read = calls.find(call => call.name === "mobile_testing_project_config");
    assert.deepEqual(read?.arguments, { projectPath: PROJECT, foregroundPlatform: "ios", foregroundDeviceId: "sim", foregroundPid: 9 });
    assert.equal(panel.target?.bundleId, "com.apple.Fitness", "Record attaches to the app in front, not the Bare RN app");
    assert.deepEqual(panel.foregroundTarget, { platform: "ios", bundleId: "com.apple.Fitness" });
    for (const listener of listeners) listener();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(calls.filter(call => call.name === "mobile_testing_project_config").length, 1, "the same unnamed app is read once");
  } finally { panel.dispose(); }
});
