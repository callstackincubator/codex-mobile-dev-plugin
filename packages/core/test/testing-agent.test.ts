import test from "node:test";
import assert from "node:assert/strict";
import { TestingAgentRecordings, registerTestingAgentTools } from "../src/testing-agent.ts";
import type { TestingDeviceAction, TestingDeviceTarget, TestingDeviceTree } from "../src/testing-device.ts";
import type { TestingDevices } from "../src/testing-device.ts";
import { TestDraftStore } from "../src/testing-drafts.ts";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { udidSchema } from "../../shared/src/protocol.ts";
import { deviceIdSchema, isRecordableDevice } from "../../shared/src/panel-target.ts";

const SCREEN = { width: 402, height: 874 };
const CONTEXT = { projectPath: "/project", deviceId: "11111111-2222-3333-4444-555555555555", platform: "ios" as const, bundleId: "com.example.app" };

type Node = {
  nodeId: string; parentId?: string; role?: string; label?: string; text?: string; value?: string;
  placeholder?: string; identifier?: string; hidden?: boolean; disabled?: boolean; selected?: boolean;
  bounds?: { x: number; y: number; width: number; height: number };
};

/** One element as the runner's projection reports it, plus the agent-device ref a step lands on. */
function tree(nodes: Node[]): TestingDeviceTree {
  return {
    screen: SCREEN,
    tree: nodes.map((node, index) => ({
      name: node.label ?? node.text ?? node.nodeId,
      bounds: node.bounds ?? { x: 0, y: 100 + index * 40, width: 300, height: 40 },
      depth: node.parentId ? 1 : 0,
      source: "accessibility" as const,
      ...node,
    })),
    refs: Object.fromEntries(nodes.map(node => [node.nodeId, `e-${node.nodeId}`])),
  };
}

/** The device, recording what an agent recording asked it to do without talking to a simulator. */
function fakeDevices(screens: TestingDeviceTree[]) {
  const actions: { target: TestingDeviceTarget; action: TestingDeviceAction }[] = [];
  let reads = 0;
  const devices = {
    read: async () => screens[Math.min(reads++, screens.length - 1)],
    perform: async (target: TestingDeviceTarget, action: TestingDeviceAction) => { actions.push({ target, action }); },
    release: async () => undefined,
  } as unknown as TestingDevices;
  return { devices, actions, reads: () => reads };
}

const EXPLORE = tree([
  { nodeId: "bar", role: "tablist", label: "Tab Bar", bounds: { x: 0, y: 800, width: 402, height: 70 } },
  { nodeId: "tab", parentId: "bar", role: "tab", label: "Explore", selected: true, bounds: { x: 100, y: 800, width: 100, height: 70 } },
  { nodeId: "cta", role: "button", label: "Go To Explore List", text: "Go To Explore List" },
  { nodeId: "blank", role: "other" },
  { nodeId: "gone", role: "button", label: "Hidden", hidden: true },
]);

const DETAIL = tree([
  { nodeId: "heat", role: "text", label: "Live activity heatmap" },
  { nodeId: "search", role: "searchbox", placeholder: "Search reviews", value: "" },
  { nodeId: "back", role: "button", identifier: "BackButton", label: "Back" },
]);

async function started(screens: TestingDeviceTree[] = [EXPLORE]) {
  const device = fakeDevices(screens);
  // A real store on a temporary directory: finishing keeps the flow, and the test must not write
  // into the user's own Application Support folder to prove it.
  const drafts = new TestDraftStore(await mkdtemp(join(tmpdir(), "mobile-dev-agent-drafts-")));
  const recordings = new TestingAgentRecordings(device.devices, drafts);
  recordings.setContext(CONTEXT);
  recordings.begin({ title: "the explore details screen", goal: "cover the Explore Details landmarks" });
  return { ...device, recordings, drafts };
}

test("a recording refuses to start when the panel has nothing selected", async () => {
  const { devices } = fakeDevices([EXPLORE]);
  const recordings = new TestingAgentRecordings(devices);
  // No project and no device is not something to pick for the user: the project picker is an OS
  // folder dialog, which must not open inside an agent's turn.
  assert.throws(() => recordings.begin({ title: "t", goal: "g" }), /an e2e project, no a booted simulator/);
  recordings.setContext({ ...CONTEXT, bundleId: "" });
  assert.throws(() => recordings.begin({ title: "t", goal: "g" }), /bundle id/);
  assert.equal(recordings.state().status, "idle");
});

test("a second recording is refused rather than stomping on the first", async () => {
  const { recordings } = await started();
  assert.throws(() => recordings.begin({ title: "another", goal: "g" }), /already in flight/);
  assert.equal(recordings.state().title, "the explore details screen");
});

test("a screen read answers with the selector the recorder would emit, and its rank", async () => {
  const { recordings } = await started();
  const screen = await recordings.screen();
  const rows = Object.fromEntries(screen.elements.map(row => [row.name ?? row.testId, row]));
  // The agent never writes a locator; it reads the one the recorder resolved and names a ref.
  assert.equal(rows["Explore"].selector, 'screen.getByRole("tab", "Explore")');
  assert.equal(rows["Explore"].rank, "role + name");
  assert.equal(rows["Explore"].unique, true);
  assert.equal(rows["Explore"].selected, true);
  assert.equal(rows["Go To Explore List"].selector, 'screen.getByRole("button", "Go To Explore List")');
  // An off-screen node is still something to assert about — `getByText` resolves it either way —
  // so it stays in the read, flagged rather than dropped.
  assert.equal(rows["Hidden"].offScreen, true);
  assert.equal(rows["Explore"].offScreen, undefined);
  // Nothing names the bare container, and the read says so by carrying no selector for it.
  assert.equal(screen.elements.find(row => row.ref.endsWith("-blank"))?.selector, undefined);
  assert.deepEqual(screen.screen, SCREEN);
});

test("a step names the element by ref and is taken on the device", async () => {
  const { recordings, actions } = await started();
  const screen = await recordings.screen();
  const tab = screen.elements.find(row => row.name === "Explore")!;
  const result = await recordings.step({ ref: tab.ref, kind: "tap" });

  assert.equal(result.acted, true);
  assert.equal(result.source, 'screen.getByRole("tab", "Explore").tap()');
  // The step is placed on the element's own agent-device ref, which is where the runner's locator
  // action will land — not on a coordinate computed from a rectangle.
  assert.deepEqual(actions.map(entry => entry.action), [{ kind: "tap", ref: "e-tab" }]);
  assert.deepEqual(actions[0].target, { deviceId: CONTEXT.deviceId, platform: "ios", projectPath: CONTEXT.projectPath, bundleId: CONTEXT.bundleId });
  const [step] = recordings.state().steps;
  assert.equal(step.label, 'Tap "Explore" (tab)');
});

test("an assertion records without touching the device", async () => {
  const { recordings, actions } = await started();
  const screen = await recordings.screen();
  const cta = screen.elements.find(row => row.name === "Go To Explore List")!;
  const result = await recordings.step({ ref: cta.ref, kind: "assertVisible" });
  assert.equal(result.acted, false);
  assert.equal(result.source, 'expect(screen.getByRole("button", "Go To Explore List")).toBeVisible()');
  assert.deepEqual(actions, [], "an assertion reads the screen and changes nothing");
});

test("a ref from an earlier read is refused rather than acted on", async () => {
  const { recordings } = await started([EXPLORE, DETAIL]);
  const screen = await recordings.screen();
  const tab = screen.elements.find(row => row.name === "Explore")!;
  await recordings.step({ ref: tab.ref, kind: "tap" });
  // Every action invalidates the tree, so the refs it was read with go with it.
  await assert.rejects(recordings.step({ ref: tab.ref, kind: "tap" }), /not from the latest screen read/);
  const next = await recordings.screen();
  assert.equal(next.elements.some(row => row.ref === tab.ref), false, "a new read mints new refs");
});

test("a fill types the value through agent-device and the step emits it", async () => {
  const { recordings, actions } = await started([DETAIL]);
  const screen = await recordings.screen();
  const search = screen.elements.find(row => row.placeholder === "Search reviews")!;
  assert.equal(search.selector, 'screen.getByPlaceholder("Search reviews")');
  const result = await recordings.step({ ref: search.ref, kind: "fill", value: "Roaming Rosa" });
  assert.equal(result.source, 'screen.getByPlaceholder("Search reviews").fill("Roaming Rosa")');
  assert.deepEqual(actions.map(entry => entry.action), [{ kind: "type", ref: "e-search", text: "Roaming Rosa" }]);
});

test("a step that needs text is refused without it", async () => {
  const { recordings } = await started([DETAIL]);
  const screen = await recordings.screen();
  const heat = screen.elements.find(row => row.name === "Live activity heatmap")!;
  await assert.rejects(recordings.step({ ref: heat.ref, kind: "assertText" }), /needs a value/);
  await assert.rejects(recordings.step({ ref: heat.ref, kind: "selectOption" }), /not a step the runner has/);
});

test("an element nothing can name is pointed at the sentence instead of a coordinate", async () => {
  const { recordings } = await started();
  const screen = await recordings.screen();
  const blank = screen.elements.find(row => row.ref.endsWith("-blank"))!;
  // The one deliberate difference from the mirror: a tap falls back to `screen.tapAt`, and an
  // agent does not, because it can describe what it cannot name.
  await assert.rejects(recordings.step({ ref: blank.ref, kind: "tap" }), /Record it as a sentence instead/);
});

test("a sentence records an agent step and nothing is sent to the device", async () => {
  const { recordings, actions } = await started();
  const result = await recordings.step({ instruction: "dismiss the onboarding sheet" });
  assert.equal(result.source, 'agent.act("dismiss the onboarding sheet")');
  assert.deepEqual(actions, []);
  assert.equal(recordings.state().steps[0].kind, "agentAct");
  const judged = await recordings.step({ kind: "agentAssert", instruction: "the sheet is gone" });
  assert.equal(judged.source, 'agent.assert("the sheet is gone")');
});

test("a swipe with no element swipes the viewport, well inside its edges", async () => {
  const { recordings, actions } = await started();
  await recordings.screen();
  const result = await recordings.step({ kind: "swipe", direction: "up" });
  assert.equal(result.source, 'screen.swipe({ direction: "up" })');
  // A swipe is as actionable as a tap, so it carries something on the screen to wait for.
  assert.ok((recordings.state().steps[0] as any).anchor?.kind, "something on the screen to wait for");
  // The runner performs `screen.swipe` as agent-device's own `scroll`, so the recorder does too:
  // a trajectory of our own falls outside the viewport the moment the keyboard shrinks it.
  assert.deepEqual(actions[0].action, { kind: "scroll", direction: "up" });
  await assert.rejects(recordings.step({ kind: "tap" }), /needs a ref/);
});

test("the revision moves on every change, which is what the panel adopts on", async () => {
  const { recordings } = await started();
  const begun = recordings.state().revision;
  const screen = await recordings.screen();
  assert.equal(recordings.state().revision, begun, "reading the screen records nothing");
  await recordings.step({ ref: screen.elements.find(row => row.name === "Explore")!.ref, kind: "assertSelected" });
  assert.equal(recordings.state().revision, begun + 1);
  await recordings.finish({ note: "covered the tab bar" });
  assert.equal(recordings.state().revision, begun + 2);
});

test("finishing leaves the steps dirty in the panel and saves nothing", async () => {
  const { recordings } = await started();
  const screen = await recordings.screen();
  await recordings.step({ ref: screen.elements.find(row => row.name === "Explore")!.ref, kind: "tap" });
  const result = await recordings.finish({ note: "the Explore tab" });

  assert.equal(result.steps, 1);
  // The whole file, emitted by the same emitter the panel's preview and Save use.
  assert.match(result.source, /import \{ test \} from "@e2e-dev\/mobile";/);
  assert.match(result.source, /await screen\.getByRole\("tab", "Explore"\)\.tap\(\);/);
  assert.match(result.next, /unsaved/);
  const state = recordings.state();
  assert.equal(state.active, false);
  assert.equal(state.status, "finished");
  // The steps stay: they are the user's to adjust and save.
  assert.equal(state.steps.length, 1);
  await assert.rejects(recordings.screen(), /No agent recording is in flight/);
});

test("aborting keeps what was recorded and lets the next recording start", async () => {
  const { recordings } = await started();
  const screen = await recordings.screen();
  await recordings.step({ ref: screen.elements.find(row => row.name === "Explore")!.ref, kind: "assertVisible" });
  assert.deepEqual(await recordings.abort({ reason: "the user pressed Stop" }), { ok: true, steps: 1, wasRecording: true });
  assert.equal(recordings.state().status, "aborted");
  assert.equal(recordings.state().steps.length, 1, "whatever was recorded is the user's to keep");
  // Aborting an idle recorder is not an error; the panel's Stop button can always be pressed.
  assert.deepEqual(await recordings.abort({ reason: "again" }), { ok: true, steps: 1, wasRecording: false });
  recordings.begin({ title: "another", goal: "g" });
  assert.deepEqual(recordings.state().steps, []);
});

test("a selection the panel cannot act on clears the context rather than half-setting it", () => {
  const { devices } = fakeDevices([EXPLORE]);
  const recordings = new TestingAgentRecordings(devices);
  const server = { registerTool: () => undefined, registerResource: () => undefined } as never;
  registerTestingAgentTools(server, devices, recordings);
  recordings.setContext(CONTEXT);
  recordings.clearContext();
  assert.throws(() => recordings.begin({ title: "t", goal: "g" }), /Testing tab/);
});

test("the five model tools are visible to the model and the panel's two are not", () => {
  const registered: { name: string; config: Record<string, any> }[] = [];
  const server = {
    registerTool: (name: string, config: Record<string, any>) => { registered.push({ name, config }); },
    registerResource: () => undefined,
  } as never;
  const { devices } = fakeDevices([EXPLORE]);
  registerTestingAgentTools(server, devices);
  const visibility = Object.fromEntries(registered.map(entry => [entry.name, entry.config._meta?.ui?.visibility]));
  // A narrow, intention-shaped surface is what keeps write_file and run_test out of the model's
  // hands; see the comment at the top of testing-tools.ts.
  for (const name of ["begin", "screen", "step", "finish", "abort"]) {
    assert.deepEqual(visibility[`mobile_testing_agent_${name}`], ["app", "model"], name);
  }
  assert.deepEqual(visibility["mobile_testing_agent_state"], ["app"]);
  assert.deepEqual(visibility["mobile_testing_set_context"], ["app"]);
});

/** The Explore List, which shares nothing with the Explore screen but the application itself. */
const LIST = tree([
  { nodeId: "nav", role: "navigation", identifier: "explore-list" },
  { nodeId: "title", role: "text", label: "Explore Cities" },
  { nodeId: "search", role: "searchbox", placeholder: "Search transactions" },
]);

/** The Explore screen with a disclosure opened: everything it had, plus what the row revealed. */
const EXPANDED = tree([
  { nodeId: "bar", role: "tablist", label: "Tab Bar", bounds: { x: 0, y: 800, width: 402, height: 70 } },
  { nodeId: "tab", parentId: "bar", role: "tab", label: "Explore", selected: true, bounds: { x: 100, y: 800, width: 100, height: 70 } },
  { nodeId: "cta", role: "button", label: "Go To Explore List", text: "Go To Explore List" },
  { nodeId: "blank", role: "other" },
  { nodeId: "gone", role: "button", label: "Hidden", hidden: true },
  { nodeId: "revealed", role: "text", label: "This app has two screens" },
]);

test("a step that replaces the screen says so, with the recording's own scope", async () => {
  const { recordings } = await started([EXPLORE, LIST]);
  const screen = await recordings.screen();
  const cta = screen.elements.find(row => row.name === "Go To Explore List")!;
  const result = await recordings.step({ ref: cta.ref, kind: "tap" });

  assert.equal(result.navigated, true);
  // The goal comes back with it, because the thing the agent has to weigh is what it was asked to
  // record — a screen name is a boundary, and it only knows that from the sentence it wrote.
  assert.equal(result.goal, "cover the Explore Details landmarks");
  assert.match(result.next!, /assert that you arrived and call mobile_testing_agent_finish/);
});

test("a step that only changes the screen is not a navigation", async () => {
  const { recordings } = await started([EXPLORE, EXPANDED]);
  const screen = await recordings.screen();
  const cta = screen.elements.find(row => row.name === "Go To Explore List")!;
  const result = await recordings.step({ ref: cta.ref, kind: "tap" });

  // Opening a disclosure leaves the screen in place and adds to it. A hint that fired here would
  // end every flow at its first interesting step.
  assert.equal(result.navigated, undefined);
  assert.match(result.next!, /Call mobile_testing_agent_screen before the next step/);
});

test("the hint is advisory: the step is recorded and the recording goes on", async () => {
  const { recordings } = await started([EXPLORE, LIST]);
  const screen = await recordings.screen();
  await recordings.step({ ref: screen.elements.find(row => row.name === "Go To Explore List")!.ref, kind: "tap" });

  // Nothing refuses, nothing counts, nothing stops: a checkout and a sign-in cross screens on
  // purpose, and a recorder that would not let them is worse than one that over-records.
  assert.equal(recordings.state().steps.length, 1);
  const next = await recordings.screen();
  const title = next.elements.find(row => row.name === "Explore Cities")!;
  const arrived = await recordings.step({ ref: title.ref, kind: "assertVisible" });
  assert.equal(arrived.ok, true);
  assert.equal(recordings.state().steps.length, 2);
});

test("the read a step already took is the read the next screen call answers with", async () => {
  const device = fakeDevices([EXPLORE, LIST]);
  const recordings = new TestingAgentRecordings(device.devices);
  recordings.setContext(CONTEXT);
  recordings.begin({ title: "t", goal: "g" });

  const screen = await recordings.screen();
  assert.equal(device.reads(), 1);
  await recordings.step({ ref: screen.elements.find(row => row.name === "Go To Explore List")!.ref, kind: "tap" });
  // The step had to read to answer whether it navigated; the agent's own re-read is that read.
  assert.equal(device.reads(), 2);
  const after = await recordings.screen();
  assert.equal(device.reads(), 2, "one snapshot per step, not two");
  assert.ok(after.elements.some(row => row.name === "Explore Cities"));
  // And the refs it hands out are the ones the step's own read minted, so they are current.
  assert.equal(after.readId, 2);
});

test("arriving at the screen the recording is for is not leaving it", async () => {
  // A tab switch keeps the tab bar and the chrome around it — about two fifths of the read on a
  // real app — and it is usually the navigation *to* the named screen. A boundary warning there
  // would land exactly as the agent arrives.
  const HOME = tree([
    { nodeId: "bar", role: "tablist", label: "Tab Bar", bounds: { x: 0, y: 800, width: 402, height: 70 } },
    { nodeId: "home", parentId: "bar", role: "tab", label: "Home", selected: true, bounds: { x: 0, y: 800, width: 100, height: 70 } },
    { nodeId: "tab", parentId: "bar", role: "tab", label: "Explore", bounds: { x: 100, y: 800, width: 100, height: 70 } },
    { nodeId: "settings", parentId: "bar", role: "tab", label: "Settings", bounds: { x: 200, y: 800, width: 100, height: 70 } },
    { nodeId: "welcome", role: "text", label: "Welcome to Expo" },
    { nodeId: "started", role: "text", label: "GET STARTED" },
  ]);
  const { recordings } = await started([HOME, EXPLORE]);
  const screen = await recordings.screen();
  const result = await recordings.step({ ref: screen.elements.find(row => row.name === "Explore")!.ref, kind: "tap" });
  assert.equal(result.navigated, undefined);
});

test("finishing keeps the flow, so a panel that was never looking still finds it", async () => {
  const { recordings, drafts } = await started();
  const screen = await recordings.screen();
  await recordings.step({ ref: screen.elements.find(row => row.name === "Explore")!.ref, kind: "tap" });
  await recordings.finish({ note: "recorded the Explore tab" });

  const kept = await drafts.list(CONTEXT.projectPath);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].origin, "agent");
  assert.equal(kept[0].title, "the explore details screen");
  assert.equal(kept[0].stepCount, 1);
  // The panel adopts this id rather than keeping a second copy of the same steps a moment later.
  assert.equal(recordings.state().draftId, kept[0].id);
});

test("an abandoned recording is kept too: the steps are the user's to keep", async () => {
  const { recordings, drafts } = await started();
  const screen = await recordings.screen();
  await recordings.step({ ref: screen.elements.find(row => row.name === "Explore")!.ref, kind: "tap" });
  await recordings.abort({ reason: "the user pressed Stop" });

  assert.equal((await drafts.list(CONTEXT.projectPath)).length, 1);
});

test("a recording with no steps keeps nothing", async () => {
  const { recordings, drafts } = await started();
  await recordings.finish({});
  assert.deepEqual(await drafts.list(CONTEXT.projectPath), []);
  assert.equal(recordings.state().draftId, "");
});

test("an adb serial is a valid device id where a uuid schema refuses it", () => {
  assert.equal(udidSchema.safeParse("emulator-5554").success, false);
  assert.equal(deviceIdSchema.safeParse("emulator-5554").success, true);
  assert.equal(deviceIdSchema.safeParse(CONTEXT.deviceId).success, true);
});

test("only a booted simulator or emulator is recordable", () => {
  const base = { udid: "x", name: "d", runtime: "" };
  assert.equal(isRecordableDevice({ ...base, state: "Booted", platform: "ios", kind: "simulator" }), true);
  assert.equal(isRecordableDevice({ ...base, udid: "emulator-5554", state: "Booted", platform: "android", kind: "emulator" }), true);
  assert.equal(isRecordableDevice({ ...base, state: "Shutdown", platform: "android", kind: "emulator" }), false);
  assert.equal(isRecordableDevice({ ...base, state: "connected", platform: "android", kind: "physical" } as never), false);
  assert.equal(isRecordableDevice({ ...base, state: "connected", platform: "ios", kind: "physical" } as never), false);
  assert.equal(isRecordableDevice(undefined), false);
});
