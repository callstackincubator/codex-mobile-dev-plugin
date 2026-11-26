import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TestingAgentRecordings, registerTestingAgentTools } from "../src/testing-agent.ts";
import { registerTestingTools } from "../src/testing-tools.ts";
import { MatrixRegistry } from "../src/testing-matrix.ts";
import { TestDraftStore } from "../src/testing-drafts.ts";
import { compactElements, describeFailure, failedStep } from "../src/testing-failure.ts";
import { listTestFiles, readTestFile, readTestTarget, studioWorkspacePath, writeTestFile, writeTestTarget } from "../src/testing-projects.ts";
import type { DeviceOps } from "../src/testing-prepare.ts";
import type { TestRunResult } from "../src/testing-run.ts";
import type { TestingDevices } from "../src/testing-device.ts";

const SOURCE = `import { test } from "@e2e-dev/mobile";
import { expect } from "e2e";

test("flow", async ({ app, screen }) => {
  await app.open();
  await screen.getByTestId("Home").tap();
  await expect(screen.getByTestId("Home")).toBeVisible();
});
`;

type Tool = { config: Record<string, any>; handler: (input: any) => Promise<any> };

/** A server that only remembers what was registered, so a test can call a tool as the model would. */
function fakeServer() {
  const tools = new Map<string, Tool>();
  const server = { registerTool: (name: string, config: Record<string, any>, handler: Tool["handler"]) => { tools.set(name, { config, handler }); }, registerResource: () => undefined } as never;
  const call = async (name: string, input: Record<string, unknown> = {}) => tools.get(name)!.handler(input);
  return { server, tools, call };
}

/** Runs `body` with Testing Studio's storage in a temp folder, so nothing touches the user's own tests. */
async function withStudio(body: (studio: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "studio-agent-"));
  const previous = process.env.MOBILE_DEV_TESTING_DIRECTORY;
  process.env.MOBILE_DEV_TESTING_DIRECTORY = root;
  try { await body(studioWorkspacePath()); }
  finally {
    if (previous === undefined) delete process.env.MOBILE_DEV_TESTING_DIRECTORY; else process.env.MOBILE_DEV_TESTING_DIRECTORY = previous;
    await rm(root, { recursive: true, force: true });
  }
}

const PROJECTS = { list: async () => [], choose: async () => undefined, record: async () => undefined } as never;
const NO_DEVICES = { release: async () => undefined, releaseOn: async () => undefined, read: async () => { throw new Error("no device"); } } as unknown as TestingDevices;

function setup(options: { ops?: DeviceOps; run?: (...args: any[]) => Promise<TestRunResult>; devices?: TestingDevices; pollMs?: number; panel?: boolean } = {}) {
  const { server, tools, call } = fakeServer();
  const devices = options.devices ?? NO_DEVICES;
  const recordings = new TestingAgentRecordings(devices, new TestDraftStore(join(tmpdir(), `drafts-${process.pid}`)));
  const registry = new MatrixRegistry();
  registerTestingTools(server, PROJECTS, devices, undefined, {
    registry, ...(options.ops ? { ops: options.ops } : {}), ...(options.run ? { run: options.run as never } : {}),
    ...(options.pollMs ? { pollMs: options.pollMs } : {}), ...(options.panel === false ? {} : { panel: recordings }),
  });
  registerTestingAgentTools(server, devices, recordings);
  return { tools, call, recordings, registry };
}

const MODEL_TOOLS = ["run_test", "run_matrix", "run_progress", "cancel", "set_target", "read_file", "tests", "wait_for_app", "branch_line"];
const APP_ONLY = ["write_file", "stage_file", "save_staged_file", "discard_staged_file", "delete_file", "release_device", "projects", "choose_project", "project_config", "read_tree", "drafts", "setup_apply"];

test("the tools an agent drives Testing Studio with are model-visible; writing and deleting files stay the panel's", () => {
  const { tools } = setup();
  for (const name of MODEL_TOOLS) assert.deepEqual(tools.get(`mobile_testing_${name}`)?.config._meta?.ui?.visibility, ["app", "model"], name);
  for (const name of APP_ONLY) assert.deepEqual(tools.get(`mobile_testing_${name}`)?.config._meta?.ui?.visibility, ["app"], name);
});

test("every model-visible tool refuses until the Testing Studio tab has reported a project, then defaults to it", async () => {
  await withStudio(async studio => {
    const { call, recordings } = setup({ ops: {} as never });
    const inputs: Record<string, Record<string, unknown>> = {
      run_test: { relativePath: "tests/a.e2e.ts" }, run_matrix: { relativePath: "tests/a.e2e.ts", devices: [{ deviceId: "d", platform: "ios" }] },
      run_progress: {}, cancel: { matrixId: "x" }, set_target: { relativePath: "tests/a.e2e.ts", platform: "ios", bundleId: "a" },
      read_file: { relativePath: "tests/a.e2e.ts" }, tests: {}, wait_for_app: { platform: "ios", timeoutMs: 100 },
      branch_line: { relativePath: "tests/a.e2e.ts", line: 6, platform: "android", locator: 'screen.getByText("x")' },
    };
    for (const name of MODEL_TOOLS) {
      const result = await call(`mobile_testing_${name}`, inputs[name]);
      assert.equal(result.isError, true, name);
      assert.match(result.content[0].text, /Testing Studio tab is not open/, name);
    }
    await writeTestFile(studio, "tests/a.e2e.ts", SOURCE);
    recordings.setPanelProject(studio);
    const listed = await call("mobile_testing_tests");
    assert.equal(listed.isError, undefined);
    assert.deepEqual(listed.structuredContent.tests.map((entry: any) => entry.relativePath), ["tests/a.e2e.ts"]);
    const read = await call("mobile_testing_read_file", { relativePath: "tests/a.e2e.ts" });
    assert.match(read.structuredContent.source, /app\.open/);
    recordings.setPanelProject("");
    assert.equal((await call("mobile_testing_tests")).isError, true, "a panel that reports no project is a closed tab");
  });
});

test("set_target add pins the other platform's app and reports the id it added", async () => {
  await withStudio(async studio => {
    const { call, recordings } = setup();
    recordings.setPanelProject(studio);
    await writeTestFile(studio, "tests/a.e2e.ts", SOURCE);
    await writeTestTarget(studio, "tests/a.e2e.ts", { platform: "ios", bundleId: "com.app" });
    const result = await call("mobile_testing_set_target", { relativePath: "tests/a.e2e.ts", platform: "android", bundleId: "com.app.android", mode: "add" });
    assert.deepEqual(result.structuredContent.added, { platform: "android", bundleId: "com.app.android", mode: "add" });
    assert.match(result.content[0].text, /android com\.app\.android/);
    assert.deepEqual(await readTestTarget(studio, "tests/a.e2e.ts"), { platform: "ios", bundleId: "com.app", apps: { android: "com.app.android" } });
  });
});

// ---- finish saves ------------------------------------------------------------------------------------------------

const TREE = {
  screen: { width: 402, height: 874 },
  tree: [{ nodeId: "home", name: "Home", role: "button", label: "Home", bounds: { x: 0, y: 100, width: 300, height: 40 }, depth: 0, source: "accessibility" as const }],
  refs: { home: "e-home" },
};
const fakeTreeDevices = () => ({ read: async () => TREE, perform: async () => undefined, release: async () => undefined, releaseOn: async () => undefined }) as unknown as TestingDevices;

async function recordHome(recordings: TestingAgentRecordings, studio: string, title = "the home screen") {
  recordings.setContext({ projectPath: studio, deviceId: "11111111-2222-3333-4444-555555555555", platform: "android", bundleId: "com.app.android" });
  await recordings.begin({ title, goal: "g" });
  const screen = await recordings.screen();
  await recordings.step({ ref: screen.elements[0]!.ref, kind: "assertVisible" });
  return recordings.finish({ note: "n" });
}

test("finishing in Testing Studio saves the test, pinned to the recorded platform and app, and returns its path", async () => {
  await withStudio(async studio => {
    const recordings = new TestingAgentRecordings(fakeTreeDevices(), new TestDraftStore(join(studio, "drafts")));
    const result = await recordHome(recordings, studio);
    assert.equal(result.saved, true);
    assert.equal(result.relativePath, "tests/the-home-screen.e2e.ts");
    assert.equal(result.path, "Testing Studio/tests/the-home-screen.e2e.ts");
    assert.match(result.next, /mobile_testing_run_matrix/);
    assert.equal(await readTestFile(studio, "tests/the-home-screen.e2e.ts"), result.source);
    assert.deepEqual(await readTestTarget(studio, "tests/the-home-screen.e2e.ts"), { platform: "android", bundleId: "com.app.android" });
    // The panel's list reads this folder, so the test is listed.
    assert.deepEqual((await listTestFiles(studio)).map(entry => entry.relativePath), ["tests/the-home-screen.e2e.ts"]);
    const state = recordings.state();
    assert.equal(state.savedPath, "tests/the-home-screen.e2e.ts");
    assert.equal(state.draftId, "", "a saved test is not also an unsaved draft");
    assert.equal(await new TestDraftStore(join(studio, "drafts")).list(studio).then(list => list.length), 0);
  });
});

test("a second recording with the same title is a new test, never a replacement", async () => {
  await withStudio(async studio => {
    const recordings = new TestingAgentRecordings(fakeTreeDevices(), new TestDraftStore(join(studio, "drafts")));
    const first = await recordHome(recordings, studio);
    const second = await recordHome(recordings, studio);
    assert.equal(first.relativePath, "tests/the-home-screen.e2e.ts");
    assert.equal(second.relativePath, "tests/the-home-screen-2.e2e.ts");
    assert.equal((await listTestFiles(studio)).length, 2);
  });
});

test("an empty recording saves nothing", async () => {
  await withStudio(async studio => {
    const recordings = new TestingAgentRecordings(fakeTreeDevices(), new TestDraftStore(join(studio, "drafts")));
    recordings.setContext({ projectPath: studio, deviceId: "11111111-2222-3333-4444-555555555555", platform: "ios", bundleId: "com.app" });
    await recordings.begin({ title: "nothing", goal: "g" });
    const result = await recordings.finish({});
    assert.equal(result.saved, false);
    assert.deepEqual(await listTestFiles(studio), []);
  });
});

// ---- wait_for_app ------------------------------------------------------------------------------------------------

function appOps(script: Record<string, (string | null)[]>, booted: { deviceId: string; name: string }[] = [{ deviceId: "emulator-5554", name: "Pixel" }]): DeviceOps {
  const seen = new Map<string, number>();
  return {
    isBooted: async () => true, boot: async (_p, id) => id, hasApp: async () => true, copyApp: async () => undefined, launch: async () => undefined,
    bootedDevices: async platform => platform === "android" ? booted : [],
    foregroundApp: async (_platform, id) => { const index = seen.get(id) ?? 0; seen.set(id, index + 1); const steps = script[id] ?? [null]; return steps[Math.min(index, steps.length - 1)] ?? null; },
  };
}

test("wait_for_app returns the app once one is in the foreground, skipping the home screen and launchers", async () => {
  await withStudio(async studio => {
    const { call, recordings } = setup({ ops: appOps({ "emulator-5554": [null, "com.google.android.apps.nexuslauncher", "com.example.shop"] }), pollMs: 5 });
    recordings.setPanelProject(studio);
    const result = await call("mobile_testing_wait_for_app", { platform: "android", timeoutMs: 5_000 });
    assert.deepEqual(result.structuredContent, { found: true, platform: "android", deviceId: "emulator-5554", deviceName: "Pixel", bundleId: "com.example.shop" });
    const ios = await call("mobile_testing_wait_for_app", { platform: "ios", timeoutMs: 100 });
    assert.equal(ios.structuredContent.found, false, "iOS has no booted device in this script");
  });
});

test("wait_for_app times out with a message the agent can relay, saying what is missing", async () => {
  await withStudio(async studio => {
    const none = setup({ ops: appOps({}, []), pollMs: 5 });
    none.recordings.setPanelProject(studio);
    const noDevice = await none.call("mobile_testing_wait_for_app", { platform: "android", timeoutMs: 100 });
    assert.equal(noDevice.isError, undefined, "waiting out is not a failure");
    assert.equal(noDevice.structuredContent.timedOut, true);
    assert.match(noDevice.structuredContent.message, /No Android emulator is booted/);

    const idle = setup({ ops: appOps({ "emulator-5554": ["com.android.systemui"] }), pollMs: 5 });
    idle.recordings.setPanelProject(studio);
    const noApp = await idle.call("mobile_testing_wait_for_app", { platform: "android", timeoutMs: 100 });
    assert.match(noApp.structuredContent.message, /Nothing is open on the Android emulator\. Ask the user to open the app/);
  });
});

// ---- branch_line -------------------------------------------------------------------------------------------------

test("branch_line gives one platform its own locator on one line, writes it, and returns the source", async () => {
  await withStudio(async studio => {
    const { call, recordings } = setup();
    recordings.setPanelProject(studio);
    await writeTestFile(studio, "tests/a.e2e.ts", SOURCE);
    const result = await call("mobile_testing_branch_line", { relativePath: "tests/a.e2e.ts", line: 7, platform: "android", locator: 'screen.getByText("Home")' });
    assert.equal(result.isError, undefined);
    const written = await readTestFile(studio, "tests/a.e2e.ts");
    assert.equal(result.structuredContent.source, written);
    assert.match(written, /await expect\(platform === "android" \? screen\.getByText\("Home"\) : screen\.getByTestId\("Home"\)\)\.toBeVisible\(\);/);
    // The assertion is the same assertion, and the line above is untouched.
    assert.match(written, /await screen\.getByTestId\("Home"\)\.tap\(\);/);
    assert.match(written, /async \(\{ app, screen, platform \}\)/, "the platform fixture is added for the branch to read");
  });
});

test("branch_line refuses a line it cannot rewrite, and a locator that is not one expression", async () => {
  await withStudio(async studio => {
    const { call, recordings } = setup();
    recordings.setPanelProject(studio);
    await writeTestFile(studio, "tests/a.e2e.ts", SOURCE);
    const before = await readTestFile(studio, "tests/a.e2e.ts");
    const input = { relativePath: "tests/a.e2e.ts", platform: "android", locator: 'screen.getByText("Home")' };
    const notAStep = await call("mobile_testing_branch_line", { ...input, line: 1 });
    assert.equal(notAStep.isError, true);
    assert.match(notAStep.content[0].text, /Line 1 .* cannot be rewritten/);
    const appOpen = await call("mobile_testing_branch_line", { ...input, line: 5 });
    assert.equal(appOpen.isError, true, "app.open has no locator");
    for (const locator of ['screen.getByText("a"); process.exit()', 'screen.getByText("a")\nawait x', "tapAt(1)", 'screen.getByText("a"']) {
      const refused = await call("mobile_testing_branch_line", { ...input, line: 7, locator });
      assert.equal(refused.isError, true, locator);
      assert.match(refused.content[0].text, /one screen\.getBy/);
    }
    assert.equal(await readTestFile(studio, "tests/a.e2e.ts"), before, "a refused branch writes nothing");
    // A `;` inside a string is text, not a second statement.
    const fine = await call("mobile_testing_branch_line", { ...input, line: 7, locator: 'screen.getByText("Save; exit")' });
    assert.equal(fine.isError, undefined);
  });
});

// ---- failure context ---------------------------------------------------------------------------------------------

const FAILED: TestRunResult = {
  status: "failed", exitCode: 1, error: "Locator not found: getByTestId(\"Home\")",
  steps: [
    { line: 6, api: "locator.tap", label: "tap", status: "passed" },
    { line: 7, api: "expect.toBeVisible", label: "toBeVisible", status: "failed", error: "Element not found" },
  ],
};

test("the failure carries the failing line and the screen as locator rows", () => {
  assert.equal(failedStep(FAILED.steps)?.line, 7);
  assert.equal(describeFailure({ ...FAILED, status: "passed" }, SOURCE), undefined);
  assert.deepEqual(describeFailure(FAILED, SOURCE), { line: 7, source: 'await expect(screen.getByTestId("Home")).toBeVisible();', error: "Element not found" });
  // No step of its own, e.g. the app would not open: the run's error stands in, with no line.
  assert.deepEqual(describeFailure({ status: "failed", exitCode: 1, steps: [], error: "app.open failed" }, SOURCE), { line: 0, source: "", error: "app.open failed" });

  const { elements, omitted } = compactElements(TREE.tree, TREE.screen, 5);
  assert.deepEqual(elements, ['button "Home" → screen.getByRole("button", "Home")']);
  assert.equal(omitted, 0);
});

async function studioWithTest(studio: string) {
  await writeTestFile(studio, "tests/a.e2e.ts", SOURCE);
  await writeTestTarget(studio, "tests/a.e2e.ts", { platform: "ios", bundleId: "com.app" });
  await writeTestTarget(studio, "tests/a.e2e.ts", { platform: "android", bundleId: "com.app.android" }, "add");
}

test("run_test on a failing test reports the failing line and the device's screen without another call", async () => {
  await withStudio(async studio => {
    const reads: unknown[] = [];
    const devices = { read: async (target: unknown) => { reads.push(target); return TREE; }, release: async () => undefined, releaseOn: async () => undefined } as unknown as TestingDevices;
    const { call, recordings } = setup({ devices, run: async () => FAILED });
    recordings.setPanelProject(studio);
    recordings.setContext({ projectPath: studio, deviceId: "11111111-2222-3333-4444-555555555555", platform: "ios", bundleId: "com.app" });
    await studioWithTest(studio);
    const result = await call("mobile_testing_run_test", { relativePath: "tests/a.e2e.ts" });
    assert.equal(result.isError, undefined);
    assert.equal(result.structuredContent.status, "failed");
    assert.equal(result.structuredContent.failure.line, 7);
    assert.match(result.structuredContent.failure.source, /toBeVisible/);
    assert.deepEqual(result.structuredContent.failure.elements, ['button "Home" → screen.getByRole("button", "Home")']);
    assert.equal((reads[0] as any).bundleId, "com.app", "it ran the app the test is pinned to, with no platform given");
  });
});

test("a passing run has no failure, and a device that cannot be read still reports the line", async () => {
  await withStudio(async studio => {
    const passing = setup({ run: async () => ({ status: "passed", exitCode: 0, steps: [] }) });
    passing.recordings.setPanelProject(studio);
    await studioWithTest(studio);
    assert.equal((await passing.call("mobile_testing_run_test", { relativePath: "tests/a.e2e.ts" })).structuredContent.failure, undefined);

    const failing = setup({ run: async () => FAILED });
    failing.recordings.setPanelProject(studio);
    const result = await failing.call("mobile_testing_run_test", { relativePath: "tests/a.e2e.ts" });
    assert.equal(result.structuredContent.failure.line, 7);
    assert.match(result.structuredContent.failure.elementsError, /runner chose the device/);
  });
});

test("run_matrix defaults the apps from the test's pins and each failed lane carries its own device's screen", async () => {
  await withStudio(async studio => {
    const readFor: string[] = [];
    const devices = { read: async (target: { deviceId: string }) => { readFor.push(target.deviceId); return TREE; }, release: async () => undefined, releaseOn: async () => undefined } as unknown as TestingDevices;
    const ran: any[] = [];
    const run = async (request: any) => { ran.push(request.bundledTarget); return request.bundledTarget.platform === "ios" ? ({ status: "passed", exitCode: 0, steps: [] } as TestRunResult) : FAILED; };
    const { call, recordings, registry } = setup({ devices, run, ops: appOps({}) });
    recordings.setPanelProject(studio);
    await studioWithTest(studio);
    const started = await call("mobile_testing_run_matrix", { relativePath: "tests/a.e2e.ts", devices: [
      { deviceId: "11111111-2222-3333-4444-555555555555", platform: "ios", name: "iPhone" },
      { deviceId: "emulator-5554", platform: "android", name: "Pixel" },
    ] });
    assert.equal(started.isError, undefined, started.content?.[0]?.text);
    const run_ = registry.get(started.structuredContent.matrixId)!;
    for (let index = 0; index < 200 && run_.lanes.some(entry => !["passed", "failed", "error", "cancelled"].includes(entry.state)); index++) await new Promise(resolve => setTimeout(resolve, 5));
    const progress = await call("mobile_testing_run_progress", { matrixId: started.structuredContent.matrixId });
    const [ios, android] = progress.structuredContent.lanes;
    assert.equal(progress.structuredContent.running, false);
    assert.equal(ios.state, "passed");
    assert.equal(ios.failure, undefined);
    assert.equal(android.state, "failed");
    assert.equal(android.failure.line, 7);
    assert.equal(android.failure.elements.length, 1);
    assert.deepEqual(readFor, ["emulator-5554"], "only the failed lane's device is read");
    assert.deepEqual(ran.map(entry => [entry.platform, entry.bundleId]).sort(), [["android", "com.app.android"], ["ios", "com.app"]]);
  });
});

test("run_matrix names the fix when a platform has no app yet, and refuses before booting anything", async () => {
  await withStudio(async studio => {
    let booted = 0;
    const ops = { ...appOps({}), boot: async (_p: string, id: string) => { booted++; return id; } } as DeviceOps;
    const { call, recordings } = setup({ ops, run: async () => FAILED });
    recordings.setPanelProject(studio);
    await writeTestFile(studio, "tests/a.e2e.ts", SOURCE);
    await writeTestTarget(studio, "tests/a.e2e.ts", { platform: "ios", bundleId: "com.app" });
    const result = await call("mobile_testing_run_matrix", { relativePath: "tests/a.e2e.ts", devices: [{ deviceId: "emulator-5554", platform: "android" }] });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /no android app yet.*open the app.*mobile_testing_wait_for_app.*mobile_testing_set_target mode "add".*run again/s);
    assert.equal(booted, 0);
  });
});

test("a tab that stops reporting is closed: open, then stale, then refused, and a heartbeat revives it", async () => {
  await withStudio(async studio => {
    let clock = 1_000;
    const { server, call } = fakeServer();
    const recordings = new TestingAgentRecordings(fakeTreeDevices(), new TestDraftStore(join(studio, "drafts")), { now: () => clock, expiryMs: 15_000 });
    registerTestingTools(server, PROJECTS, fakeTreeDevices(), undefined, { registry: new MatrixRegistry(), panel: recordings });
    registerTestingAgentTools(server, fakeTreeDevices(), recordings);
    const report = () => call("mobile_testing_set_context", { projectPath: studio, deviceId: "11111111-2222-3333-4444-555555555555", platform: "ios", bundleId: "com.app" });

    await report();
    assert.equal((await call("mobile_testing_tests")).isError, undefined, "open");
    clock += 14_000;
    assert.equal((await call("mobile_testing_tests")).isError, undefined, "still within the expiry");

    clock += 2_000;
    const stale = await call("mobile_testing_tests");
    assert.equal(stale.isError, true, "stale");
    assert.match(stale.content[0].text, /Testing Studio tab is not open.*mobile_open_simulator/);
    assert.equal(recordings.panelContext(), undefined, "the device selection goes with it");
    await assert.rejects(() => recordings.begin({ title: "t", goal: "g" }), /call mobile_open_simulator with workspaceTool "testing" once to open it, then begin again/, "agent_begin refuses too");

    await report();
    assert.equal((await call("mobile_testing_tests")).isError, undefined, "a heartbeat revives it");
    await recordings.begin({ title: "t", goal: "g" });

    // Beating again keeps it alive past what one report would have lasted.
    for (let beat = 0; beat < 4; beat++) { clock += 10_000; await report(); }
    assert.equal((await call("mobile_testing_tests")).isError, undefined);
    // And leaving tells the server at once, without waiting out the expiry.
    await call("mobile_testing_set_context", { projectPath: "", deviceId: "", bundleId: "" });
    assert.equal((await call("mobile_testing_tests")).isError, true);
  });
});

test("the default expiry outlasts a throttled background panel and still reports a silent one closed", async () => {
  await withStudio(async studio => {
    let clock = 1_000;
    const { server, call } = fakeServer();
    const recordings = new TestingAgentRecordings(fakeTreeDevices(), new TestDraftStore(join(studio, "drafts")), { now: () => clock });
    registerTestingTools(server, PROJECTS, fakeTreeDevices(), undefined, { registry: new MatrixRegistry(), panel: recordings });
    registerTestingAgentTools(server, fakeTreeDevices(), recordings);
    await call("mobile_testing_set_context", { projectPath: studio, deviceId: "11111111-2222-3333-4444-555555555555", platform: "ios", bundleId: "com.app" });
    clock += 70_000; // an unfocused window beating about once a minute
    assert.equal((await call("mobile_testing_tests")).isError, undefined, "an unfocused panel is still open");
    clock += 70_000;
    assert.equal((await call("mobile_testing_tests")).isError, undefined, "a missed throttled beat is tolerated");
    clock += 120_000;
    assert.equal((await call("mobile_testing_tests")).isError, true, "a panel silent for minutes is closed");
  });
});

// ---- begin resolves what it can --------------------------------------------------------------------------------

const IOS_ID = "11111111-2222-3333-4444-555555555555";
const AUTO_OPS = (front: string | null, booted = [{ deviceId: IOS_ID, name: "iPhone 17 Pro" }]) => ({
  bootedDevices: async (platform: string) => (platform === "ios" ? booted : []),
  foregroundApp: async () => front,
}) as unknown as DeviceOps;

function autoRecordings(studio: string, ops: DeviceOps) {
  return new TestingAgentRecordings(fakeTreeDevices(), new TestDraftStore(join(studio, "drafts")), { ops });
}

test("Testing Studio begin needs only a booted device and a foreground app, and saves the test pinned to it", async () => {
  await withStudio(async studio => {
    const recordings = autoRecordings(studio, AUTO_OPS("com.example.notes"));
    recordings.setPanelProject(studio);
    const begun = await recordings.begin({ title: "open notes", goal: "g" });
    assert.equal(begun.bundleId, "com.example.notes");
    assert.equal(begun.deviceId, IOS_ID);
    assert.match(begun.report ?? "", /com\.example\.notes.*foreground/);
    const screen = await recordings.screen();
    await recordings.step({ ref: screen.elements[0]!.ref, kind: "assertVisible" });
    const done = await recordings.finish({});
    assert.deepEqual(await readTestTarget(studio, done.relativePath!), { platform: "ios", bundleId: "com.example.notes" });
  });
});

test("Testing Studio begin ignores the home screen and says only the app is missing", async () => {
  await withStudio(async studio => {
    const recordings = autoRecordings(studio, AUTO_OPS("com.apple.springboard"));
    recordings.setPanelProject(studio);
    await assert.rejects(() => recordings.begin({ title: "t", goal: "g" }), (error: Error) => {
      assert.match(error.message, /^Cannot start recording yet\. Open the app to record in the foreground/);
      assert.doesNotMatch(error.message, /Boot|Testing Studio tab|project/);
      return true;
    });
  });
});

test("with nothing booted begin asks to boot a device and, in Testing Studio, to open the app", async () => {
  await withStudio(async studio => {
    const recordings = autoRecordings(studio, AUTO_OPS(null, []));
    recordings.setPanelProject(studio);
    await assert.rejects(() => recordings.begin({ title: "t", goal: "g" }), /Boot an iOS simulator or Android emulator.* Open the app to record.* Then begin again\.$/);
  });
});

test("two booted devices and no mirrored one is a real ambiguity, so it asks which", async () => {
  await withStudio(async studio => {
    const recordings = autoRecordings(studio, AUTO_OPS("com.a", [{ deviceId: IOS_ID, name: "iPhone 17 Pro" }, { deviceId: "22222222-2222-3333-4444-555555555555", name: "iPhone 16" }]));
    recordings.setPanelProject(studio);
    await assert.rejects(() => recordings.begin({ title: "t", goal: "g" }), /Say which device to record on: iPhone 17 Pro, iPhone 16\./);
  });
});

async function projectWith(targets: string[]) {
  const dir = await mkdtemp(join(tmpdir(), "e2e-project-"));
  const { writeFile, mkdir } = await import("node:fs/promises");
  await writeFile(join(dir, "e2e.config.ts"), `export default { targets: [\n${targets.join(",\n")}\n] };\n`);
  // What makes it a project rather than Testing Studio: a project-local e2e CLI and its package version.
  await mkdir(join(dir, "node_modules", ".bin"), { recursive: true });
  await mkdir(join(dir, "node_modules", "e2e"), { recursive: true });
  await writeFile(join(dir, "node_modules", ".bin", "e2e"), "");
  await writeFile(join(dir, "node_modules", "e2e", "package.json"), JSON.stringify({ name: "e2e", version: "1.0.0" }));
  return dir;
}

test("project mode picks the config target the foreground app matches, or the only one", async () => {
  await withStudio(async studio => {
    const dir = await projectWith([`{ name: "app", platform: "ios", bundleId: "com.example.app" }`]);
    try {
      const recordings = autoRecordings(studio, AUTO_OPS("com.example.app"));
      recordings.setPanelProject(dir);
      const { inspectProject } = await import("../src/testing-projects.ts");
      assert.equal((await inspectProject(dir)).runtimeMode, "project");
      assert.equal((await recordings.begin({ title: "t", goal: "g" })).bundleId, "com.example.app");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

test("ambiguous project mode asks which target, naming them", async () => {
  await withStudio(async studio => {
    const dir = await projectWith([`{ name: "alpha", platform: "ios", bundleId: "com.a" }`, `{ name: "beta", platform: "ios", bundleId: "com.b" }`]);
    try {
      const { inspectProject } = await import("../src/testing-projects.ts");
      assert.equal((await inspectProject(dir)).runtimeMode, "project");
      const recordings = autoRecordings(studio, AUTO_OPS("com.other"));
      recordings.setPanelProject(dir);
      await assert.rejects(() => recordings.begin({ title: "t", goal: "g" }), /Say which target to record: alpha, beta/);
      const matching = autoRecordings(studio, AUTO_OPS("com.b"));
      matching.setPanelProject(dir);
      assert.equal((await matching.begin({ title: "t", goal: "g" })).bundleId, "com.b", "the foreground app picks between two targets");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

test("a closed Testing Studio tab is the only thing begin reports", async () => {
  await withStudio(async studio => {
    const recordings = autoRecordings(studio, AUTO_OPS(null, []));
    await assert.rejects(() => recordings.begin({ title: "t", goal: "g" }), (error: Error) => /^The Testing Studio tab is not open\..*do not open another/.test(error.message));
  });
});

test("a call made right after the tab was opened waits for its first report instead of refusing", async () => {
  await withStudio(async studio => {
    const { call, recordings } = setup({ ops: AUTO_OPS("com.example.notes") });
    const auto = autoRecordings(studio, AUTO_OPS("com.example.notes"));
    // Not opened and silent: refused at once.
    await assert.rejects(() => auto.begin({ title: "t", goal: "g" }), /not open/);
    assert.equal((await call("mobile_testing_tests")).isError, true);

    // Opened, and the first heartbeat lands a moment later.
    auto.expectPanel(2_000); recordings.expectPanel(2_000);
    setTimeout(() => { auto.setPanelProject(studio); recordings.setPanelProject(studio); }, 120);
    const begun = await auto.begin({ title: "t", goal: "g" });
    assert.equal(begun.bundleId, "com.example.notes");
    assert.equal((await call("mobile_testing_tests")).isError, undefined);
  });
});

test("an opened tab that never reports is called closed once the grace period ends", async () => {
  await withStudio(async studio => {
    const recordings = autoRecordings(studio, AUTO_OPS("com.a"));
    recordings.expectPanel(150);
    const started = Date.now();
    await assert.rejects(() => recordings.begin({ title: "t", goal: "g" }), /not open/);
    assert.ok(Date.now() - started >= 140);
  });
});
