import test from "node:test";
import assert from "node:assert/strict";
import { renderEnvironment } from "./jsdom-env.ts";

const DEVICE = { udid: "udid", name: "iPhone 17 Pro", state: "Booted", platform: "ios", kind: "simulator" };
// `useSyncExternalStore` compares snapshots by identity, so this is a value, not a fresh object.
const DEVICE_SNAPSHOT = { device: DEVICE };

/** One step as the server's agent recording reports it: the panel's own `RecordedStep`, over MCP. */
function step(id: string, label: string) {
  return { id, kind: "tap", label, selector: { kind: "text", text: label } };
}

/**
 * The Testing Studio panel over a host whose tool calls are answered from a script.
 *
 * `agent` is the state the server would report, which the test moves between polls; everything
 * else answers with the empty shape the panel copes with, so the test is about the agent recording
 * and not about project loading.
 */
async function panelEnvironment(t: Parameters<typeof renderEnvironment>[0]) {
  const { module, dom, onTeardown } = await renderEnvironment<any>(t, {
    exports: 'export { TestingPanel } from "./packages/ui/src/testing-panel.ts";\n'
      + 'export { testRecorder } from "./packages/ui/src/test-recorder.ts";\n'
      + 'export { TestingView } from "./packages/ui/src/components/testing-view.tsx";',
    slug: "testing-agent-panel",
    extraGlobals: { crypto: { randomUUID: () => `id-${Math.random()}` } },
  });
  const calls: { name: string; arguments: Record<string, unknown> }[] = [];
  const agent: Record<string, unknown> = { active: false, status: "idle", revision: 0, title: "", goal: "", steps: [], note: "", error: "" };
  const responses: Record<string, () => unknown> = {};
  const host = {
    callServerTool: async (request: { name: string; arguments: Record<string, unknown> }) => {
      calls.push(request);
      if (responses[request.name]) return { content: [], structuredContent: responses[request.name]!() };
      if (request.name === "mobile_testing_agent_state") return { content: [], structuredContent: { ...agent } };
      if (request.name === "mobile_testing_projects") return { content: [], structuredContent: { projects: [] } };
      return { content: [], structuredContent: {} };
    },
  };
  const listeners = new Set<() => void>();
  let snapshot = DEVICE_SNAPSHOT;
  const deviceApps = {
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
  };
  const panel = new module.TestingPanel(host, deviceApps);
  // The harness keeps one teardown, so they are chained here: a panel left undisposed keeps its
  // poll timer, and the test run never exits.
  const extra: (() => Promise<void> | void)[] = [];
  onTeardown(async () => { for (const fn of extra.reverse()) await fn(); panel.dispose(); });
  const tick = async () => { await new Promise(resolve => setTimeout(resolve, 0)); await new Promise(resolve => setTimeout(resolve, 0)); };
  return { ...module, dom, onTeardown: (fn: () => Promise<void> | void) => { extra.push(fn); }, panel, host, deviceApps, calls, agent, tick, responses,
    setDevice: (next: unknown) => { snapshot = { device: next } as never; for (const listener of listeners) listener(); } };
}

test("the panel reports its selection, and only when it changes", async t => {
  const { panel, calls, tick } = await panelEnvironment(t);
  panel.setAvailable(true);
  await tick();
  const context = () => calls.filter(entry => entry.name === "mobile_testing_set_context");
  // Nothing is reported as a selection until all three halves are there: an agent recording
  // against half a selection is the refusal it would get anyway, one round trip later.
  assert.deepEqual(context().at(-1)?.arguments, { projectPath: "", deviceId: DEVICE.udid, platform: "ios", bundleId: "" });
  const before = context().length;
  panel.setFileName("whatever");
  await tick();
  assert.equal(context().length, before, "an unchanged selection is not reported again");
});

test("a session the agent starts opens the Testing Studio tab and adopts its steps live", async t => {
  const { panel, agent, tick, testRecorder } = await panelEnvironment(t);
  let opened = 0;
  panel.onAgentRecordingStarted(() => { opened += 1; });
  panel.setAvailable(true);
  await tick();
  assert.equal(opened, 0, "an idle server opens nothing");

  Object.assign(agent, { active: true, status: "recording", revision: 1, title: "explore details", goal: "cover the landmarks", steps: [step("a", 'Tap "Explore"')] });
  await (panel as any).readAgentState();
  assert.equal(opened, 1, "the user asked their agent for a test; the steps have to be somewhere they can see them");
  assert.equal(panel.getSnapshot().agent.active, true);
  // The same step list, the same preview, the same emitter — deliberately not a second state
  // machine, which is what makes Save and the step editor work unchanged.
  assert.deepEqual(testRecorder.getSnapshot().steps.map((entry: any) => entry.id), ["a"]);
  assert.equal(testRecorder.getSnapshot().recordingDeviceId, DEVICE.udid);
  assert.equal(testRecorder.isAgentRecording(DEVICE.udid), true);
  assert.match(testRecorder.source, /await screen\.getByText\("Tap \\"Explore\\""\)\.tap\(\);/);

  Object.assign(agent, { revision: 2, steps: [step("a", 'Tap "Explore"'), step("b", 'Tap "Paris"')] });
  await (panel as any).readAgentState();
  assert.deepEqual(testRecorder.getSnapshot().steps.map((entry: any) => entry.id), ["a", "b"]);
  assert.equal(opened, 1, "the tab is opened once per session, not once per step");
});

test("a finished session hands the flow back, dirty and unsaved", async t => {
  const { panel, agent, tick, testRecorder } = await panelEnvironment(t);
  panel.setAvailable(true);
  await tick();
  Object.assign(agent, { active: true, status: "recording", revision: 1, title: "t", goal: "g", steps: [step("a", "Tap")] });
  await (panel as any).readAgentState();
  Object.assign(agent, { active: false, status: "finished", revision: 2, note: "the Explore Details landmarks" });
  await (panel as any).readAgentState();

  // The banner clears and the mirror is the user's again, with the steps still there to adjust.
  assert.equal(testRecorder.isAgentRecording(DEVICE.udid), false);
  assert.equal(testRecorder.getSnapshot().recordingDeviceId, "", "a flow left armed turns the next stray tap into a step the agent never recorded");
  assert.equal(testRecorder.getSnapshot().steps.length, 1);
  assert.equal(panel.getSnapshot().agent.status, "finished");
  assert.equal(panel.dirty, true, "nothing was saved, so everything is unsaved");
  assert.equal(panel.canRun, false, "no project is selected in this fixture");
});

test("Stop drops the session at the server and hands the mirror back at once", async t => {
  const { panel, agent, calls, tick, testRecorder } = await panelEnvironment(t);
  panel.setAvailable(true);
  await tick();
  Object.assign(agent, { active: true, status: "recording", revision: 1, title: "t", goal: "g", steps: [step("a", "Tap")] });
  await (panel as any).readAgentState();

  await panel.stopAgent();
  assert.equal(calls.some(entry => entry.name === "mobile_testing_agent_abort"), true);
  // Not on the next tick: the user pressed Stop to get the mirror back.
  assert.equal(testRecorder.isAgentRecording(DEVICE.udid), false);
  assert.equal(panel.getSnapshot().agent.status, "aborted");
  assert.equal(testRecorder.getSnapshot().steps.length, 1, "whatever was recorded is the user's to keep");
});

test("the user cannot start a second recording over the agent's", async t => {
  const { panel, agent, tick, testRecorder } = await panelEnvironment(t);
  panel.setAvailable(true);
  await tick();
  Object.assign(agent, { active: true, status: "recording", revision: 1, title: "t", goal: "g", steps: [] });
  await (panel as any).readAgentState();
  testRecorder.start(DEVICE.udid, "ios", false);
  assert.equal(testRecorder.isAgentRecording(DEVICE.udid), true, "Record is refused while the agent drives the device");
});

test("the banner says who is driving, and its Stop is the one beside the goal", async t => {
  const { panel, agent, dom, onTeardown, TestingView, tick } = await panelEnvironment(t);
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  panel.setAvailable(true);
  await tick();
  const deviceApps = { subscribe: () => () => undefined, getSnapshot: () => DEVICE_SNAPSHOT };
  const root = createRoot(dom.window.document.getElementById("root")!);
  await act(async () => { root.render(createElement(TestingView, { panel, deviceApps })); });
  onTeardown(async () => { await act(async () => { root.unmount(); }); });

  Object.assign(agent, { active: true, status: "recording", revision: 1, title: "t", goal: "cover the Explore Details landmarks", steps: [step("a", "Tap")] });
  await act(async () => { await (panel as any).readAgentState(); });
  const banner = () => dom.window.document.querySelector("[data-testing-agent-banner]");
  assert.match(banner()?.textContent ?? "", /Agent is recording — cover the Explore Details landmarks/);
  assert.match(banner()?.textContent ?? "", /1 step/);
  assert.ok(dom.window.document.querySelector("[data-testing-agent-stop]"), "the user must be able to take the mirror back without going via their agent");
  // One Stop, beside what it stops: the recorder's own Stop is not drawn while the agent drives.
  assert.equal(dom.window.document.querySelector("[data-testing-stop]"), null);
  assert.equal((dom.window.document.querySelector("[data-testing-run]") as HTMLButtonElement).disabled, true,
    "a run resets the app and takes the one device session the recording is being read through");
  // Save lives in the Test Description section, which starts folded: saving half a flow the agent
  // is still writing is a file the user did not ask for.
  await act(async () => { (dom.window.document.querySelector("[data-testing-description-toggle]") as HTMLElement).click(); });
  assert.equal((dom.window.document.querySelector("[data-testing-save]") as HTMLButtonElement).disabled, true);

  Object.assign(agent, { active: false, status: "finished", revision: 2, note: "4 landmarks" });
  await act(async () => { await (panel as any).readAgentState(); });
  assert.equal(banner(), null);
  // "Recorded" reads as "saved" to anyone who did not watch it happen.
  assert.match(dom.window.document.querySelector("[data-testing-agent-handover]")?.textContent ?? "",
    /The agent finished recording 1 step — 4 landmarks\. Nothing has been saved or run/);
});

const lane = (state: string, extra: Record<string, unknown> = {}) => ({ runId: `run-${state}`, deviceId: "d1", deviceName: "iPhone", platform: "ios", state, progress: [], ...extra });
const wire = (running: boolean, state: string, matrixId = "m1") => ({ matrixId, testPath: "tests/flow.e2e.ts", lanes: [lane(state)], limit: 3, startedAt: 1, running });

test("a run the agent starts shows as live lanes, locks editing, and frees it when the lanes finish", async t => {
  const { panel, responses, tick } = await panelEnvironment(t);
  panel.setAvailable(true);
  await tick();
  (panel as any).update({ projectPath: "/studio", runtimeMode: "bundled" });
  assert.equal(panel.agentBusy, false);

  responses.mobile_testing_run_progress = () => wire(true, "running");
  await (panel as any).readAgentState();
  assert.equal(panel.getSnapshot().agentRun, true);
  assert.equal(panel.getSnapshot().matrix.lanes[0].state, "running", "the agent's lanes are the lanes on screen");
  assert.equal(panel.agentBusy, true, "editing locks the way it does while the agent records");
  assert.equal(panel.canRun, false);
  assert.equal(panel.canRunStored, false);
  panel.dismissMatrix();
  assert.ok(panel.getSnapshot().matrix, "a live run cannot be dismissed");

  responses.mobile_testing_run_progress = () => wire(false, "passed");
  await (panel as any).readAgentState();
  assert.equal(panel.getSnapshot().agentRun, false);
  assert.equal(panel.getSnapshot().matrix.lanes[0].state, "passed", "the result stays on screen to read");
  assert.equal(panel.agentBusy, false);

  // The same finished run is not adopted again, and a run the panel did not see running never is.
  await (panel as any).readAgentState();
  assert.equal(panel.getSnapshot().agentRun, false);
});

test("the panel's own run is never taken over by the poll", async t => {
  const { panel, responses, tick } = await panelEnvironment(t);
  panel.setAvailable(true);
  await tick();
  (panel as any).update({ projectPath: "/studio", runtimeMode: "bundled", running: true });
  responses.mobile_testing_run_progress = () => wire(true, "running", "theirs");
  await (panel as any).readAgentState();
  assert.equal(panel.getSnapshot().agentRun, false);
  assert.equal(panel.getSnapshot().matrix, null);
});

test("a recording the agent saved in Testing Studio refreshes the test list instead of adopting a draft", async t => {
  const { panel, agent, tick, calls, testRecorder } = await panelEnvironment(t);
  panel.setAvailable(true);
  await tick();
  Object.assign(agent, { active: true, status: "recording", revision: 1, title: "t", goal: "g", steps: [step("a", "Tap")] });
  await (panel as any).readAgentState();
  const before = calls.filter(entry => entry.name === "mobile_testing_tests").length;
  (panel as any).update({ projectPath: "/studio", runtimeMode: "bundled" });
  Object.assign(agent, { active: false, status: "finished", revision: 2, note: "n", savedPath: "tests/t.e2e.ts" });
  await (panel as any).readAgentState();
  await tick();
  assert.equal(panel.getSnapshot().agent.savedPath, "tests/t.e2e.ts");
  assert.equal(panel.getSnapshot().savedPath, "Testing Studio/tests/t.e2e.ts");
  assert.equal(panel.getSnapshot().draftId, "", "there is no draft: the test is saved");
  assert.ok(calls.filter(entry => entry.name === "mobile_testing_tests").length > before, "the stored list is read again so the test appears");
  assert.equal(testRecorder.getSnapshot().recordingDeviceId, "");
});

test("a test the agent rewrites or re-pins refreshes the open preview and the pinned apps without reselecting", async t => {
  const { panel, agent, tick, calls, responses } = await panelEnvironment(t);
  panel.setAvailable(true);
  await tick();
  let source = "old source", pinned: Record<string, unknown> | undefined;
  responses.mobile_testing_read_file = () => ({ source, originalHash: source });
  responses.mobile_testing_tests = () => ({ tests: [{ relativePath: "tests/a.e2e.ts", name: "a.e2e.ts", updatedAt: "", sizeBytes: 1, ...(pinned ? { target: pinned } : {}) }] });
  (panel as any).update({ projectPath: "/studio", runtimeMode: "bundled", selectedTestPath: "tests/a.e2e.ts", selectedTestSource: source, selectedTestOriginalHash: source, tests: [{ relativePath: "tests/a.e2e.ts", name: "a.e2e.ts", updatedAt: "", sizeBytes: 1, target: { platform: "ios", bundleId: "com.app" } }] });
  const reads = () => calls.filter(entry => entry.name === "mobile_testing_read_file").length;
  Object.assign(agent, { storedTestsRevision: 1 });
  await (panel as any).readAgentState();
  await tick();
  const baseline = reads();
  // branch_line rewrote the file, and set_target added the Android app.
  source = "new source";
  pinned = { platform: "ios", bundleId: "com.app", apps: { android: "com.app.android" } };
  Object.assign(agent, { storedTestsRevision: 2 });
  await (panel as any).readAgentState();
  await tick();
  assert.equal(panel.getSnapshot().selectedTestSource, "new source");
  assert.ok(reads() > baseline);
  assert.deepEqual(panel.getSnapshot().tests[0].target.apps, { android: "com.app.android" });
  assert.equal(panel.storedAppOn("android")?.bundleId, "com.app.android", "the add-the-app prompt has what it needs to clear");
  // An unchanged revision reads nothing; unsaved edits are not overwritten.
  const before = reads();
  await (panel as any).readAgentState();
  await tick();
  assert.equal(reads(), before);
  (panel as any).update({ selectedTestSource: "mine", selectedTestStaged: true });
  source = "newer";
  Object.assign(agent, { storedTestsRevision: 3 });
  await (panel as any).readAgentState();
  await tick();
  assert.equal(panel.getSnapshot().selectedTestSource, "mine");
});

test("clicking a result row selects the lane and mirrors its booted device, during a run too", async t => {
  const { panel, setDevice } = await panelEnvironment(t);
  const lane = (runId: string, deviceId: string, platform: string, state: string) => ({ runId, deviceId, deviceName: deviceId, platform, state, progress: [] });
  const shown: [string, string][] = [];
  panel.setMirrorDevice((platform: string, deviceId: string) => { shown.push([platform, deviceId]); setDevice({ ...DEVICE, udid: deviceId, platform }); return true; });
  (panel as any).update({ running: true, agentRun: true, matrix: { matrixId: "m", lanes: [lane("r1", "udid", "ios", "running"), lane("r2", "pixel", "android", "running")], limit: 3, startedAt: 1 } });
  panel.openLane("r2");
  assert.deepEqual(shown, [["android", "pixel"]], "the mirror moved to the lane's device");
  assert.equal(panel.getSnapshot().selectedLane, "r2");
  assert.equal(panel.getSnapshot().running, true, "the run is untouched");
  panel.openLane("r2");
  assert.equal(shown.length, 1, "the device already mirrored is not switched again");
  // A device that is not booted yet cannot be mirrored; the steps still show.
  panel.setMirrorDevice(() => false);
  panel.openLane("r1");
  assert.equal(panel.getSnapshot().selectedLane, "r1");
});

test("an open, visible tab re-sends its selection on a heartbeat, and tells the server when it goes", async t => {
  const { TestingPanel, host, deviceApps, calls, tick } = await panelEnvironment(t);
  const beating = new TestingPanel(host, deviceApps, { heartbeatMs: 10 });
  const context = () => calls.filter(entry => entry.name === "mobile_testing_set_context");
  beating.setAvailable(true);
  await tick();
  const initial = context().length;
  // Closed (not shown): nothing is sent, so the server lets the report age out.
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(context().length, initial, "a tab that is not showing does not claim to be open");
  beating.show();
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.ok(context().length >= initial + 3, "the same selection is re-sent while the tab is open, which is what keeps it alive");
  beating.hide();
  await tick();
  const hidden = context().length;
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(context().length, hidden, "hiding stops the heartbeat");
  beating.dispose();
  await tick();
  assert.deepEqual(context().at(-1)?.arguments, { projectPath: "", deviceId: "", bundleId: "" }, "leaving clears the context on a best-effort basis");
});

/** Waits for the panel to settle on a project, since a selection loads its config over several calls. */
async function settled(panel: any, projectPath: string) {
  for (let attempt = 0; attempt < 100 && panel.getSnapshot().projectPath !== projectPath; attempt++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(panel.getSnapshot().projectPath, projectPath);
}

function projectScript(env: Awaited<ReturnType<typeof panelEnvironment>>) {
  env.responses.mobile_testing_projects = () => ({ projects: [{ path: "/work/expoapp57", name: "expoapp57" }], studioPath: "/studio" });
  env.responses.mobile_testing_choose_project = () => {
    const request = [...env.calls].reverse().find(entry => entry.name === "mobile_testing_choose_project")!;
    const path = String(request.arguments.projectPath);
    return { project: { path, name: path.split("/").pop() } };
  };
}

test("an agent's No project request beats the last-used project when the panel opens", async t => {
  const env = await panelEnvironment(t);
  projectScript(env);
  env.agent.projectRequest = { id: 1, path: "/studio" };
  env.panel.setAvailable(true);
  await new Promise(resolve => setTimeout(resolve, 200));
  await settled(env.panel, "/studio");
  assert.equal(env.calls.some(entry => entry.name === "mobile_testing_choose_project"), false, "Testing Studio is not a folder to record");
});

test("an agent's No project request switches a panel already on another project, once", async t => {
  const env = await panelEnvironment(t);
  projectScript(env);
  env.panel.setAvailable(true);
  await settled(env.panel, "/work/expoapp57");
  env.agent.projectRequest = { id: 1, path: "/studio" };
  await (env.panel as any).readAgentState();
  await settled(env.panel, "/studio");
  // The user picks a project by hand; the same request is still pending on the server.
  await env.panel.chooseProject("/work/expoapp57");
  await settled(env.panel, "/work/expoapp57");
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(env.panel.getSnapshot().projectPath, "/work/expoapp57", "an applied request is not applied again");
  env.agent.projectRequest = { id: 2, path: "/studio" };
  await (env.panel as any).readAgentState();
  await settled(env.panel, "/studio");
});

test("an agent's project is selected and added to the list when the panel does not list it", async t => {
  const env = await panelEnvironment(t);
  projectScript(env);
  env.panel.setAvailable(true);
  await settled(env.panel, "/work/expoapp57");
  env.agent.projectRequest = { id: 1, path: "/work/new-app" };
  await (env.panel as any).readAgentState();
  await settled(env.panel, "/work/new-app");
  const added = env.calls.filter(entry => entry.name === "mobile_testing_choose_project");
  assert.deepEqual(added.map(entry => entry.arguments), [{ projectPath: "/work/new-app" }], "added by path, never through the folder dialog");
  assert.ok(env.panel.getSnapshot().projects.some((entry: any) => entry.path === "/work/new-app"));
});
