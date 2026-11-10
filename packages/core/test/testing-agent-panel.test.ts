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
 * The Testing panel over a host whose tool calls are answered from a script.
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
  const host = {
    callServerTool: async (request: { name: string; arguments: Record<string, unknown> }) => {
      calls.push(request);
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
  return { ...module, dom, onTeardown: (fn: () => Promise<void> | void) => { extra.push(fn); }, panel, calls, agent, tick,
    setDevice: (next: unknown) => { snapshot = { device: next } as never; for (const listener of listeners) listener(); } };
}

test("the panel reports its selection, and only when it changes", async t => {
  const { panel, calls, tick } = await panelEnvironment(t);
  panel.setAvailable(true);
  await tick();
  const context = () => calls.filter(entry => entry.name === "mobile_testing_set_context");
  // Nothing is reported as a selection until all three halves are there: an agent recording
  // against half a selection is the refusal it would get anyway, one round trip later.
  assert.deepEqual(context().at(-1)?.arguments, { projectPath: "", udid: DEVICE.udid, bundleId: "" });
  const before = context().length;
  panel.setFileName("whatever");
  await tick();
  assert.equal(context().length, before, "an unchanged selection is not reported again");
});

test("a session the agent starts opens the Testing tab and adopts its steps live", async t => {
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
  assert.equal(testRecorder.getSnapshot().recordingUdid, DEVICE.udid);
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
  assert.equal(testRecorder.getSnapshot().recordingUdid, "", "a flow left armed turns the next stray tap into a step the agent never recorded");
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
  testRecorder.start(DEVICE.udid, false);
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
  assert.equal((dom.window.document.querySelector("[data-testing-save]") as HTMLButtonElement).disabled, true);

  Object.assign(agent, { active: false, status: "finished", revision: 2, note: "4 landmarks" });
  await act(async () => { await (panel as any).readAgentState(); });
  assert.equal(banner(), null);
  // "Recorded" reads as "saved" to anyone who did not watch it happen.
  assert.match(dom.window.document.querySelector("[data-testing-agent-handover]")?.textContent ?? "",
    /The agent finished recording 1 step — 4 landmarks\. Nothing has been saved or run/);
});
