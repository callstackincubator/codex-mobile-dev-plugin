import test from "node:test";
import assert from "node:assert/strict";
import type { HostBridge } from "../src/host-bridge.ts";
import type { DeviceAppsStore } from "../src/device-apps.ts";
import { TestingPanel } from "../src/testing-panel.ts";
import { testRecorder } from "../src/test-recorder.ts";
import { clampLimit, laneLabel, matrixFinished, matrixSummary, parseMatrix, parseMatrixDevices } from "../src/testing-matrix.ts";
import type { MatrixLane, MatrixView } from "../src/testing-matrix.ts";

const PROJECT = "/Users/someone/app";
const deviceApps = { subscribe: () => () => undefined, getSnapshot: () => ({ device: undefined }) } as unknown as DeviceAppsStore;
const lane = (state: MatrixLane["state"], extra: Partial<MatrixLane> = {}): MatrixLane => ({ runId: `r-${state}-${Math.random()}`, deviceId: "d", deviceName: "Phone", platform: "ios", state, progress: [], ...extra });
const view = (...lanes: MatrixLane[]): MatrixView => ({ matrixId: "m", lanes, limit: 3, startedAt: 1 });

test("lane labels show the step the lane is on", () => {
  assert.equal(laneLabel(lane("queued")), "Queued");
  assert.equal(laneLabel(lane("booting")), "Booting");
  assert.equal(laneLabel(lane("installing")), "Installing");
  assert.equal(laneLabel(lane("running")), "Running");
  const running = lane("running", { progress: [{ stepIndex: 0, phase: "start" }, { stepIndex: 0, phase: "end", status: "passed" }, { stepIndex: 1, phase: "start" }] });
  assert.equal(laneLabel(running, 7), "Running step 2 of 7");
  assert.equal(laneLabel(lane("error")), "Error");
});

test("the summary counts what has finished", () => {
  assert.equal(matrixSummary(view(lane("passed"), lane("passed"), lane("failed"))), "2 passed · 1 failed");
  assert.equal(matrixSummary(view(lane("passed"), lane("running"), lane("queued"))), "1 passed · 2 in progress");
  assert.equal(matrixFinished(view(lane("passed"), lane("cancelled"))), true);
  assert.equal(matrixFinished(view(lane("passed"), lane("queued"))), false);
});

test("the limit is kept between 1 and 8", () => { assert.deepEqual([clampLimit(0), clampLimit(3), clampLimit(50), clampLimit(NaN)], [1, 3, 8, 3]); });

test("the server's lanes are read defensively", () => {
  const parsed = parseMatrix({ matrixId: "m", limit: 2, startedAt: 5, lanes: [
    { runId: "a", deviceId: "avd:Pixel", resolvedDeviceId: "emulator-5554", deviceName: "Pixel", platform: "android", state: "running", progress: [{ stepIndex: 0, phase: "start" }, { nope: 1 }] },
    { runId: "b", deviceId: "B", platform: "android", state: "passed", progress: [], result: { status: "passed", steps: [{ line: 4, status: "passed" }, { line: 0, status: "x" }], durationMs: 12 } },
    { runId: "c", platform: "windows", state: "running" }, { runId: "d", platform: "ios", state: "weird" },
  ] });
  assert.equal(parsed?.lanes.length, 2);
  assert.equal(parsed?.lanes[0]?.progress.length, 1);
  assert.equal(parsed?.lanes[0]?.resolvedDeviceId, "emulator-5554");
  assert.deepEqual(parsed?.lanes[1]?.result?.steps, [{ line: 4, status: "passed" }]);
  assert.equal(parseMatrix({ lanes: [] }), null);
});

test("the checklist reads simulators and emulators and skips physical iPhones", () => {
  const ios = parseMatrixDevices("ios", { devices: [{ udid: "A", name: "iPhone 17", state: "Booted", runtime: "iOS 26.0" }, { udid: "P", name: "My phone", state: "connected", kind: "physical" }] });
  assert.deepEqual(ios.map(device => [device.deviceId, device.booted]), [["A", true]]);
  const android = parseMatrixDevices("android", { devices: [{ udid: "emulator-5554", name: "Pixel", state: "Booted", kind: "emulator" }, { udid: "avd:Old", name: "Old", state: "Shutdown", kind: "emulator" }] });
  assert.deepEqual(android.map(device => [device.deviceId, device.booted]), [["emulator-5554", true], ["avd:Old", false]]);
});

/** A host that plays a matrix: the first poll shows two lanes running and a third queued, the next ends them. */
function matrixHost(calls: { name: string; arguments: Record<string, unknown> }[]) {
  let polls = 0;
  const lanes = (states: string[]) => states.map((state, i) => ({ runId: `r${i}`, deviceId: `d${i}`, deviceName: `Phone ${i}`, platform: "ios", state, progress: state === "passed" ? [{ stepIndex: 0, phase: "end", status: "passed" }] : [],
    ...(state === "passed" ? { result: { status: "passed", steps: [{ line: 3, status: "passed" }] } } : {}) }));
  return { async callServerTool({ name, arguments: input }: { name: string; arguments: Record<string, unknown> }) {
    calls.push({ name, arguments: input });
    const structuredContent = name === "mobile_testing_run_matrix" ? { matrixId: "m1", limit: 2, startedAt: 1, lanes: lanes(["queued", "queued", "queued"]) }
      : name === "mobile_testing_run_progress" ? { matrixId: "m1", limit: 2, startedAt: 1, lanes: lanes(++polls < 2 ? ["running", "running", "queued"] : ["passed", "passed", "passed"]) }
      : name === "mobile_list_simulators" ? { devices: [0, 1, 2].map(i => ({ udid: `d${i}`, name: `Phone ${i}`, state: "Booted", runtime: "iOS 26" })) }
      : name === "mobile_list_apps" ? { apps: [{ bundleId: "com.example.app", name: "App" }] } : {};
    return { content: [], structuredContent };
  } } as unknown as HostBridge;
}

test("a run on three devices starts one matrix with the limit, polls its lanes and ends with all of them", async () => {
  const calls: { name: string; arguments: Record<string, unknown> }[] = [];
  const panel = new TestingPanel(matrixHost(calls), deviceApps);
  const set = (fields: Record<string, unknown>) => (panel as unknown as { update(fields: Record<string, unknown>): void }).update(fields);
  panel.setAvailable(true);
  set({ projectPath: PROJECT, runtimeMode: "bundled", targets: [{ name: "ios", platform: "ios", bundleId: "com.example.app" }], selectedTestPath: "tests/a.e2e.ts", selectedTestSource: 'test("x", async () => {});\n', tests: [{ relativePath: "tests/a.e2e.ts", name: "a", updatedAt: "", sizeBytes: 1, target: { platform: "ios", bundleId: "com.example.app" } }] });
  await panel.loadMatrixDevices();
  assert.equal(panel.getSnapshot().matrixDevices.every(device => device.installed === true), true, "booted devices are checked for the app");
  panel.setMatrixSelection(["d0", "d1", "d2"]);
  panel.setMatrixLimit(2);
  assert.equal(panel.matrixRunCount, 3);

  await panel.runStoredTest();

  const start = calls.find(call => call.name === "mobile_testing_run_matrix")!;
  assert.equal(start.arguments.limit, 2);
  assert.deepEqual(start.arguments.apps, { ios: "com.example.app" });
  assert.deepEqual((start.arguments.devices as { deviceId: string }[]).map(device => device.deviceId), ["d0", "d1", "d2"]);
  assert.equal(calls.some(call => call.name === "mobile_testing_run_test"), false, "the single-device path is not used");
  assert.ok(calls.filter(call => call.name === "mobile_testing_run_progress").every(call => call.arguments.matrixId === "m1"));
  const state = panel.getSnapshot();
  assert.equal(state.running, false);
  assert.deepEqual(state.matrix?.lanes.map(entry => entry.state), ["passed", "passed", "passed"]);
  assert.deepEqual(testRecorder.getSnapshot().run?.lines, { 3: "passed" }, "the selected lane's steps are on the preview");
  panel.dismissMatrix();
  assert.equal(panel.getSnapshot().matrix, null);
  panel.dispose();
});

test("one selected device runs as a lane unless it is the mirrored device, and a project config runs the matrix too", async () => {
  const mirrored = { subscribe: () => () => undefined, getSnapshot: () => ({ device: { udid: "d0" } }) } as unknown as DeviceAppsStore;
  const panel = new TestingPanel(matrixHost([]), mirrored);
  const set = (fields: Record<string, unknown>) => (panel as unknown as { update(fields: Record<string, unknown>): void }).update(fields);
  panel.setAvailable(true);
  set({ projectPath: PROJECT, runtimeMode: "bundled", matrixDevices: [{ deviceId: "d0", name: "P", platform: "ios", runtime: "", booted: true }, { deviceId: "d1", name: "Q", platform: "ios", runtime: "", booted: true }] });
  panel.setMatrixSelection(["d0"]);
  assert.equal(panel.matrixRunCount, 1);
  assert.equal(panel.runsOnMatrix, false, "the mirrored device alone runs the plain way");
  panel.setMatrixSelection(["d1"]);
  assert.equal(panel.runsOnMatrix, true, "one device that is not the mirror runs there, not on the mirror");
  panel.setMatrixSelection([]);
  assert.equal(panel.runsOnMatrix, false);
  panel.setMatrixSelection(["d0", "d1"]);
  assert.equal(panel.matrixRunCount, 2);
  assert.equal(panel.runsOnMatrix, true);
  set({ runtimeMode: "project" });
  assert.equal(panel.matrixEnabled, true);
  assert.equal(panel.matrixRunCount, 2, "a project's lanes run its config's targets on each device");
  panel.dispose();
});

test("the concurrency limit is saved per project but device choices are not", () => {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); } };
  try {
    const first = new TestingPanel(matrixHost([]), deviceApps);
    const set = (panel: TestingPanel, fields: Record<string, unknown>) => (panel as unknown as { update(fields: Record<string, unknown>): void }).update(fields);
    set(first, { projectPath: "/a" });
    first.setMatrixSelection(["x", "y"]); first.setMatrixLimit(4);
    set(first, { projectPath: "/b" });
    assert.deepEqual([first.getSnapshot().matrixSelected, first.getSnapshot().matrixLimit], [[], 3]);
    set(first, { projectPath: "/a" });
    assert.deepEqual([first.getSnapshot().matrixSelected, first.getSnapshot().matrixLimit], [[], 4]);
    const second = new TestingPanel(matrixHost([]), deviceApps);
    set(second, { projectPath: "/a" });
    assert.deepEqual([second.getSnapshot().matrixSelected, second.getSnapshot().matrixLimit], [[], 4], "a new panel restores only concurrency");
    second.dispose();
    first.dispose();
  } finally { delete (globalThis as { localStorage?: unknown }).localStorage; }
});

test("opening another test clears the device choice", async () => {
  const panel = new TestingPanel(matrixHost([]), deviceApps);
  const set = (fields: Record<string, unknown>) => (panel as unknown as { update(fields: Record<string, unknown>): void }).update(fields);
  panel.setAvailable(true);
  set({ projectPath: PROJECT, matrixDevices: [{ deviceId: "d0", name: "Phone", platform: "ios", runtime: "", booted: true }] });
  panel.setMatrixSelection(["d0"]);

  await panel.openTest("tests/next.e2e.ts");

  assert.deepEqual(panel.getSnapshot().matrixSelected, []);
  panel.dispose();
});
