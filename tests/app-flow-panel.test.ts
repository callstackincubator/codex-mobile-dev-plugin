import assert from "node:assert/strict";
import test from "node:test";
import type { App } from "@modelcontextprotocol/ext-apps";
import { FAST_MODE_AUTH_NOTICE, featureGateNotice } from "../src/shared/app-flow.ts";
import { AppFlowPanel } from "../src/ui/app-flow-panel.ts";

function fixture(canMessage = true, projectList: unknown[] = []) {
  const calls: Array<{ name: string; arguments?: Record<string, unknown> }> = [];
  const messages: Array<{ content: Array<{ text: string }> }> = [];
  let notification: ((value: { params: { data: unknown } }) => void) | undefined;
  let projects = projectList;
  let nextProject: unknown;
  let bufferedEvents: Array<{ seq: number; runId?: string; event: unknown }> = [];
  let currentResult: unknown = null;
  let currentStatus: Record<string, unknown> = { exists: false, state: "idle" };
  const app = {
    getHostCapabilities() { return canMessage ? { message: { text: {} } } : {}; },
    setNotificationHandler(_schema: unknown, handler: typeof notification) { notification = handler; },
    removeNotificationHandler() {},
    async sendMessage(message: typeof messages[number]) { messages.push(message); return {}; },
    async callServerTool(input: { name: string; arguments?: Record<string, unknown> }) {
      calls.push(input);
      if (input.name === "mobile_appflow_start") return { content: [], structuredContent: { runId: "run-1", state: "running" } };
      if (input.name === "mobile_appflow_status") return { content: [], structuredContent: currentStatus };
      if (input.name === "mobile_appflow_screenshot") return { content: [{ type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" }] };
      if (input.name === "mobile_appflow_projects") return { content: [], structuredContent: { projects } };
      if (input.name === "mobile_appflow_result") return { content: [], structuredContent: { projectId: "project-1", result: currentResult } };
      if (input.name === "mobile_appflow_choose_project") return { content: [], structuredContent: nextProject ? { project: nextProject } : {} };
      if (input.name === "mobile_appflow_events") {
        const since = Number(input.arguments?.since ?? 0);
        return { content: [], structuredContent: { result: bufferedEvents.filter(entry => entry.seq > since) } };
      }
      return { content: [], structuredContent: {} };
    },
  };
  return {
    app: app as unknown as App, calls, messages,
    notify(data: unknown) { notification?.({ params: { data } }); },
    list(value: unknown[]) { projects = value; },
    returnsProject(value: unknown) { nextProject = value; },
    events(value: Array<{ seq: number; runId?: string; event: unknown }>) { bufferedEvents = value; },
    returnsResult(value: unknown) { currentResult = value; },
    returnsStatus(value: Record<string, unknown>) { currentStatus = value; },
  };
}
const settle = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));

test("structure builds call the server directly while screen sweeps wake the active Codex agent", async t => {
  const host = fixture(); const panel = new AppFlowPanel(host.app); t.after(() => panel.dispose());
  panel.setAvailable(true); await panel.selectProject("/projects/demo");
  await panel.start({ mode: "structure-only" });
  assert.equal(host.calls.at(-1)?.name, "mobile_appflow_start");
  assert.equal(panel.getSnapshot().runId, "run-1");
  const callCount = host.calls.length;
  await panel.requestAgentStart({ mode: "screen-ui-and-structure", explorationMode: "thorough" });
  assert.equal(host.calls.length, callCount, "agent sweep start is delivered as a follow-up, not an app-side tool call");
  assert.equal(host.messages.length, 1);
  assert.match(host.messages[0].content[0].text, /mobile_appflow_next_decision/);
  assert.match(host.messages[0].content[0].text, /"projectPath":"\/projects\/demo"/);
});

test("progress notifications preserve the last tally and keep auth prompts human-owned", async t => {
  const host = fixture(); const panel = new AppFlowPanel(host.app); t.after(() => panel.dispose());
  panel.setAvailable(true); await panel.selectProject("/projects/demo"); await panel.start({ mode: "structure-only" });
  host.notify({ source: "app-flow", runId: "run-1", event: { type: "step", phase: "capture", message: "Profile", completed: 3, total: 8 } });
  assert.deepEqual(panel.getSnapshot().sweepSummary, { completed: 3, total: 8, message: "Profile" });
  host.notify({ source: "app-flow", runId: "run-1", event: { type: "prompt", phase: "capture", message: "Sign in", prompt: { id: "prompt-1", kind: "auth", detail: "Log in on device", screenshot: null, remaining: 5 } } });
  assert.equal(panel.getSnapshot().state, "needs-user-action");
  assert.equal(panel.getSnapshot().prompt?.id, "prompt-1");
  assert.equal(host.calls.filter(call => call.name === "mobile_appflow_resolve_prompt").length, 0);
});

test("prompt controls include the project path needed to reach a Codex-owned run", async t => {
  const host = fixture(); const panel = new AppFlowPanel(host.app); t.after(() => panel.dispose());
  panel.setAvailable(true); await panel.selectProject("/projects/demo"); await panel.start({ mode: "structure-only" });
  host.notify({ source: "app-flow", runId: "run-1", event: { type: "prompt", phase: "capture", message: "Review", prompt: { id: "prompt-1", kind: "review", detail: "Review", screenshot: null, remaining: 1 } } });
  host.returnsStatus({ exists: true, runId: "run-1", state: "running" });
  await panel.resolvePrompt("continue");
  const call = host.calls.find(entry => entry.name === "mobile_appflow_resolve_prompt");
  assert.deepEqual(call?.arguments, { runId: "run-1", resolution: "continue", projectPath: "/projects/demo", promptId: "prompt-1" });
  assert.equal(host.messages.length, 1);
  assert.match(host.messages[0].content[0].text, /Resume the existing App Flow run run-1/);
  assert.match(host.messages[0].content[0].text, /Do not start a new run/);
});

test("stopping a human prompt does not wake another Codex turn", async t => {
  const host = fixture(); const panel = new AppFlowPanel(host.app); t.after(() => panel.dispose());
  panel.setAvailable(true); await panel.selectProject("/projects/demo"); await panel.start({ mode: "structure-only" });
  host.notify({ source: "app-flow", runId: "run-1", event: { type: "prompt", phase: "capture", message: "Review", prompt: { id: "prompt-1", kind: "review", detail: "Review", screenshot: null, remaining: 1 } } });
  host.returnsStatus({ exists: true, runId: "run-1", state: "completed" });
  await panel.resolvePrompt("stop");
  assert.equal(host.messages.length, 0);
});

test("capture progress distinguishes successful captures from route attempts", async t => {
  const host = fixture(); const panel = new AppFlowPanel(host.app); t.after(() => panel.dispose());
  panel.setAvailable(true); await panel.selectProject("/projects/demo"); await panel.start({ mode: "structure-only" });
  host.notify({ source: "app-flow", runId: "run-1", event: { type: "step", phase: "capture", message: "Reaching route", completed: 9, total: 79, captured: 3, captureLimit: 6 } });
  assert.deepEqual(panel.getSnapshot().sweepSummary, { completed: 9, total: 79, captured: 3, captureLimit: 6, message: "Reaching route" });
});

test("status restores prompt controls when the live event channels were missed", async t => {
  const host = fixture();
  host.returnsStatus({
    exists: true,
    runId: "run-1",
    projectId: "project-1",
    state: "needs-user-action",
    event: { type: "prompt", phase: "capture", message: "Sign in", prompt: { id: "prompt-1", kind: "auth", detail: "Log in on device", screenshot: null, remaining: 5 } },
  });
  const panel = new AppFlowPanel(host.app); t.after(() => panel.dispose());
  panel.setAvailable(true);
  await panel.selectProject("/projects/demo");
  assert.equal(panel.getSnapshot().state, "needs-user-action");
  assert.equal(panel.getSnapshot().prompt?.id, "prompt-1");
  assert.equal(panel.getSnapshot().projectId, "project-1");
});

test("agent-start status discovery hydrates a prompt and clears the pending latch", async t => {
  const host = fixture(); const panel = new AppFlowPanel(host.app, 5); t.after(() => panel.dispose());
  panel.setAvailable(true); panel.show(); await settle(); await panel.selectProject("/projects/demo");
  host.returnsStatus({
    exists: true,
    runId: "run-1",
    projectId: "project-1",
    state: "needs-user-action",
    event: { type: "prompt", phase: "capture", message: "Review", prompt: { id: "prompt-2", kind: "review", detail: "Review the current screen", screenshot: null, remaining: 2 } },
  });
  await panel.requestAgentStart({ mode: "screen-ui-and-structure", explorationMode: "fast" });
  await settle(100);
  assert.equal(panel.getSnapshot().state, "needs-user-action");
  assert.equal(panel.getSnapshot().prompt?.id, "prompt-2");
  assert.equal(panel.getSnapshot().agentStartPending, false);
});

test("LLM start is unavailable when the host cannot send a follow-up", async t => {
  const host = fixture(false); const panel = new AppFlowPanel(host.app); t.after(() => panel.dispose());
  panel.setAvailable(true); await panel.selectProject("/projects/demo");
  await panel.requestAgentStart({ mode: "screen-ui-and-structure" });
  assert.equal(host.messages.length, 0);
  assert.match(panel.getSnapshot().error ?? "", /cannot send a follow-up/i);
});

test("reopening the tab restores the last project and its saved map", async t => {
  const host = fixture();
  host.list([{ path: "/projects/demo", name: "demo", lastPickedAt: "2026-10-14T10:00:00.000Z" }]);
  const panel = new AppFlowPanel(host.app); t.after(() => panel.dispose());
  panel.setAvailable(true);
  panel.show();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(host.calls.filter(call => call.name === "mobile_appflow_projects").length, 1);
  assert.deepEqual(host.calls.filter(call => call.name === "mobile_appflow_status").map(call => call.arguments), [{ projectPath: "/projects/demo" }]);
  assert.equal(panel.getSnapshot().projectPath, "/projects/demo");
  assert.deepEqual(panel.getSnapshot().projects, [{ path: "/projects/demo", name: "demo" }]);
  panel.hide(); panel.show();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(host.calls.filter(call => call.name === "mobile_appflow_status").length, 1, "the shown project is not reopened twice");
  await panel.refreshProjects();
  assert.equal(host.calls.filter(call => call.name === "mobile_appflow_projects").length, 2, "opening the selector refreshes the list");
});

test("an unavailable host leaves the selector retryable instead of settling on nothing", async t => {
  const host = fixture();
  host.list([{ path: "/projects/demo", name: "demo", lastPickedAt: "2026-10-14T10:00:00.000Z" }]);
  const panel = new AppFlowPanel(host.app); t.after(() => panel.dispose());
  panel.show();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(panel.getSnapshot().projectPath, "", "nothing can be opened before the host answers");
  panel.setAvailable(true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(panel.getSnapshot().projectPath, "/projects/demo");
});

test("choosing a listed project persists it and opens that project's flow", async t => {
  const host = fixture();
  host.list([{ path: "/projects/first", name: "first", lastPickedAt: "2026-10-14T10:00:00.000Z" }]);
  host.returnsProject({ path: "/projects/second", name: "second", lastPickedAt: "2026-10-14T11:00:00.000Z" });
  const panel = new AppFlowPanel(host.app); t.after(() => panel.dispose());
  panel.setAvailable(true);
  panel.show();
  await new Promise(resolve => setImmediate(resolve));
  await panel.chooseProject("/projects/second");
  assert.deepEqual(host.calls.filter(call => call.name === "mobile_appflow_choose_project").map(call => call.arguments), [{ projectPath: "/projects/second" }]);
  assert.equal(panel.getSnapshot().projectPath, "/projects/second");
  assert.deepEqual(panel.getSnapshot().projects.map(project => project.path), ["/projects/second", "/projects/first"]);
});

test("the system folder picker selects its result and a cancel keeps the current project", async t => {
  const host = fixture();
  host.returnsProject({ path: "/projects/browsed", name: "browsed", lastPickedAt: "2026-10-14T11:00:00.000Z" });
  const panel = new AppFlowPanel(host.app); t.after(() => panel.dispose());
  panel.setAvailable(true);
  await panel.pickProject();
  assert.deepEqual(host.calls.filter(call => call.name === "mobile_appflow_choose_project").map(call => call.arguments), [{}]);
  assert.equal(panel.getSnapshot().projectPath, "/projects/browsed");
  assert.deepEqual(panel.getSnapshot().projects, [{ path: "/projects/browsed", name: "browsed" }]);
  assert.equal(panel.getSnapshot().pickingProject, false);
  host.returnsProject(undefined);
  await panel.selectProject("/projects/keep");
  await panel.pickProject();
  assert.equal(panel.getSnapshot().projectPath, "/projects/keep");
  assert.equal(panel.getSnapshot().error, null);
  assert.equal(panel.getSnapshot().pickingProject, false);
});

test("a refused project choice reports the reason and keeps the current project", async t => {
  const failing = { getHostCapabilities: () => ({}), setNotificationHandler() {}, removeNotificationHandler() {},
    async callServerTool() { return { isError: true, content: [{ type: "text" as const, text: "That project folder no longer exists." }] }; } } as unknown as App;
  const panel = new AppFlowPanel(failing); t.after(() => panel.dispose());
  panel.setAvailable(true);
  await panel.chooseProject("/projects/gone");
  assert.match(panel.getSnapshot().error ?? "", /no longer exists/);
  assert.equal(panel.getSnapshot().projectPath, "", "a folder App Flow cannot open is not selected");
  assert.equal(panel.getSnapshot().pickingProject, false);
});

test("screenshot URIs are reduced to the server's authorized encoded path", async t => {
  const host = fixture(); const panel = new AppFlowPanel(host.app); t.after(() => panel.dispose());
  const url = await panel.screenshot("project-1", "appflow-image://mobile-dev/project-1/c2NyZWVucy9ob21lLnBuZw");
  assert.equal(url, "data:image/png;base64,iVBORw0KGgo=", "the host sandbox CSP allows data: images but not blob: object URLs");
  assert.deepEqual(host.calls.at(-1), { name: "mobile_appflow_screenshot", arguments: { projectId: "project-1", path: "c2NyZWVucy9ob21lLnBuZw" } });
});

test("a running sweep is followed through the event poll when notifications never arrive", async t => {
  const host = fixture(); const panel = new AppFlowPanel(host.app, 5); t.after(() => panel.dispose());
  panel.setAvailable(true); panel.show(); await settle();
  await panel.selectProject("/projects/demo");
  host.events([
    { seq: 1, runId: "run-1", event: { type: "step", phase: "capture", message: "Profile", completed: 3, total: 8 } },
  ]);
  await panel.start({ mode: "structure-only" });
  await settle(150);
  assert.deepEqual(panel.getSnapshot().sweepSummary, { completed: 3, total: 8, message: "Profile" });
  assert.equal(panel.getSnapshot().state, "running");
  host.events([
    { seq: 1, runId: "run-1", event: { type: "step", phase: "capture", message: "Profile", completed: 3, total: 8 } },
    { seq: 2, runId: "run-1", event: { type: "complete", phase: "render", message: "Structure complete." } },
  ]);
  await settle(150);
  assert.equal(panel.getSnapshot().state, "completed", "the terminal event is applied through the poll");
  const polls = host.calls.filter(call => call.name === "mobile_appflow_events");
  assert.ok(polls.length >= 1, "the panel polls while the run is live");
  assert.ok(polls.some(call => call.arguments?.since === 1), "the poll advances past applied events by its sequence cursor");
  // The run is terminal now: further polls would be pointless, so they must stop.
  const pollsAfter = host.calls.filter(call => call.name === "mobile_appflow_events").length;
  await settle(120);
  assert.equal(host.calls.filter(call => call.name === "mobile_appflow_events").length, pollsAfter, "polling stops once the run reaches a terminal state");
});

test("a notification and the poll carrying the same sequence are applied once", async t => {
  const host = fixture(); const panel = new AppFlowPanel(host.app, 5); t.after(() => panel.dispose());
  panel.setAvailable(true); panel.show(); await settle();
  await panel.selectProject("/projects/demo");
  host.events([
    { seq: 1, runId: "run-1", event: { type: "step", phase: "capture", message: "Profile", completed: 3, total: 8 } },
    { seq: 2, runId: "run-1", event: { type: "step", phase: "capture", message: "Settings", completed: 4, total: 8 } },
  ]);
  await panel.start({ mode: "structure-only" });
  host.notify({ source: "app-flow", runId: "run-1", seq: 1, event: { type: "step", phase: "capture", message: "Profile", completed: 3, total: 8 } });
  await settle(150);
  assert.deepEqual(panel.getSnapshot().sweepSummary, { completed: 4, total: 8, message: "Settings" });
  // Dedupe proof: the poll only asks for events after seq 1 because the notification consumed it.
  const polls = host.calls.filter(call => call.name === "mobile_appflow_events");
  assert.ok(polls.some(call => call.arguments?.since === 1), "the shared cursor skips the notified event");
});

test("a running sweep re-reads the graph document so captures appear without ending the run", async t => {
  const host = fixture(); const panel = new AppFlowPanel(host.app, 5, 10); t.after(() => panel.dispose());
  panel.setAvailable(true); panel.show(); await settle();
  await panel.selectProject("/projects/demo");
  host.returnsResult({ manifest: { formatVersion: 4, durationMs: 1000 }, nodes: [], edges: [] });
  host.events([
    { seq: 1, runId: "run-1", event: { type: "step", phase: "capture", message: "Profile", completed: 3, total: 8 } },
  ]);
  await panel.start({ mode: "screen-ui-and-structure" });
  await settle(120);
  assert.equal(panel.getSnapshot().state, "running");
  const liveReads = host.calls.filter(call => call.name === "mobile_appflow_result");
  assert.ok(liveReads.length >= 1, "the graph is re-read while the sweep is live");
  assert.deepEqual(liveReads.at(0)?.arguments, { projectPath: "/projects/demo" });
  assert.ok(panel.getSnapshot().result, "the live document reaches the snapshot without a terminal event");
});

test("the live graph refresh is paced, not one document read per poll tick", async t => {
  const host = fixture(); const panel = new AppFlowPanel(host.app, 5, 10_000); t.after(() => panel.dispose());
  panel.setAvailable(true); panel.show(); await settle();
  await panel.selectProject("/projects/demo");
  host.events([
    { seq: 1, runId: "run-1", event: { type: "step", phase: "capture", message: "Profile", completed: 3, total: 8 } },
  ]);
  await panel.start({ mode: "screen-ui-and-structure" });
  await settle(150);
  assert.equal(panel.getSnapshot().state, "running");
  // The first live read happens; every tick inside the interval must be skipped.
  const first = host.calls.filter(call => call.name === "mobile_appflow_result").length;
  assert.equal(first, 1, "one read covers the whole interval");
  await settle(150);
  assert.equal(host.calls.filter(call => call.name === "mobile_appflow_result").length, first, "the interval paces the refresh");
});

test("recording events reach the panel through the poll and stop it when saved", async t => {
  const host = fixture(); const panel = new AppFlowPanel(host.app, 5); t.after(() => panel.dispose());
  panel.setAvailable(true); panel.show(); await settle();
  await panel.selectProject("/projects/demo");
  host.events([
    { seq: 1, event: { type: "status", projectId: "p-1", nodeId: "screen-1", status: "recording" } },
    { seq: 2, event: { type: "snapshot", projectId: "p-1", nodeId: "screen-1", revision: 1, nodes: [], bounds: { x: 0, y: 0, width: 100, height: 100 } } },
  ]);
  await panel.recording.start("/projects/demo", "screen-1");
  await settle(120);
  assert.equal(panel.recording.getSnapshot().status, "recording");
  assert.equal(panel.recording.getSnapshot().bounds?.width, 100);
  host.events([
    { seq: 1, event: { type: "status", projectId: "p-1", nodeId: "screen-1", status: "recording" } },
    { seq: 2, event: { type: "snapshot", projectId: "p-1", nodeId: "screen-1", revision: 1, nodes: [], bounds: { x: 0, y: 0, width: 100, height: 100 } } },
    { seq: 3, event: { type: "complete", projectId: "p-1", nodeId: "screen-1", pathToReach: ["agent-device replay saved.ad"], replayVerified: true } },
  ]);
  await settle(120);
  assert.equal(panel.recording.getSnapshot().outcome?.replayVerified, true);
  const pollsAfter = host.calls.filter(call => call.name === "mobile_appflow_events").length;
  await settle(120);
  assert.equal(host.calls.filter(call => call.name === "mobile_appflow_events").length, pollsAfter, "a finished recording ends its polling");
});

test("the Fast-mode banner tells the user to sign in before the sweep, since nothing else will ask", () => {
  // Fast has no model-backed auth gate behind it, so this copy is the whole warning.
  assert.match(FAST_MODE_AUTH_NOTICE, /Fast mode does not check/i);
  assert.match(FAST_MODE_AUTH_NOTICE, /signing in/i);
  assert.match(FAST_MODE_AUTH_NOTICE, /start the sweep/i);
});

test("every guarded route is labelled Feature Gated, whatever that run happened to render", () => {
  const guard = { condition: "features.enabled('moderation')", fallback: "NotFoundScreen" };
  // A rendered the fallback, B rendered fine: the flag is not knowable statically, so both say so.
  const a = featureGateNotice(guard), b = featureGateNotice({ ...guard, condition: "features.enabled('inbox')" });
  assert.equal(a?.label, "Feature Gated");
  assert.equal(b?.label, "Feature Gated");
  assert.equal(a?.detail, "Renders <NotFoundScreen/> unless features.enabled('moderation')");
  assert.equal(featureGateNotice(null), null, "an unguarded route carries no label");
  assert.equal(featureGateNotice(undefined), null, "nor does a document written before guards existed");
});

test("a second agent-started sweep on the same project adopts the new run", async t => {
  const host = fixture(); const panel = new AppFlowPanel(host.app); t.after(() => panel.dispose());
  panel.setAvailable(true); await panel.selectProject("/projects/demo");
  await panel.requestAgentStart({ mode: "screen-ui-and-structure", explorationMode: "fast" });
  host.notify({ source: "app-flow", runId: "run-1", event: { type: "step", phase: "capture", message: "Settings", completed: 14, total: 79 } });
  host.notify({ source: "app-flow", runId: "run-1", event: { type: "complete", phase: "capture", message: "Done", completed: 14, total: 79 } });
  assert.equal(panel.getSnapshot().runId, "run-1");
  // Re-running without switching projects previously left `run-1` in place, and the ingest guard
  // then dropped every event of the new run — the panel froze on the finished run's tally.
  await panel.requestAgentStart({ mode: "screen-ui-and-structure", explorationMode: "fast" });
  assert.equal(panel.getSnapshot().runId, null);
  assert.equal(panel.getSnapshot().sweepSummary, null);
  assert.equal(panel.getSnapshot().progress, null);
  host.notify({ source: "app-flow", runId: "run-2", event: { type: "step", phase: "capture", message: "Home", completed: 1, total: 79 } });
  assert.equal(panel.getSnapshot().runId, "run-2");
  assert.equal(panel.getSnapshot().state, "running");
  assert.deepEqual(panel.getSnapshot().sweepSummary, { completed: 1, total: 79, message: "Home" });
});

// The dropdown that selects this is opt-in and defaults to off, so the only way the sweep ever
// captures state variants is this value surviving the trip through the agent prompt. The panel
// spreads start options verbatim, which is exactly the kind of pass-through that breaks silently:
// nothing downstream complains about an option that never arrived, the run just quietly skips the
// states pass again.
test("state capture rides along with the sweep start options", async t => {
  const host = fixture(); const panel = new AppFlowPanel(host.app); t.after(() => panel.dispose());
  panel.setAvailable(true); await panel.selectProject("/projects/demo");
  await panel.requestAgentStart({ mode: "screen-ui-and-structure", explorationMode: "fast", stateCaptureMode: "on" });
  assert.match(host.messages[0].content[0].text, /"stateCaptureMode":"on"/);
});

// The freeze the user reported: the screen-sweep status stopped updating until they switched
// projects. `requestAgentStart` clears the runId, then the discovery poll fires about a second
// later — before Codex has called `mobile_appflow_start` — and the project-scoped status still
// answers with the run being replaced. A paused run is still returned by the server's active-run
// finder with its id, so adopting it pinned the panel to a dead run and the ingest guard then
// dropped the real new run's events forever. Switching projects was the only escape.
test("a paused previous run is not adopted while a new sweep is being started", async t => {
  const host = fixture(); const panel = new AppFlowPanel(host.app, 5); t.after(() => panel.dispose());
  panel.setAvailable(true); panel.show(); await settle();
  await panel.selectProject("/projects/demo");
  await panel.start({ mode: "structure-only" });
  host.notify({ source: "app-flow", runId: "run-1", seq: 1, event: { type: "step", phase: "capture", message: "Settings", completed: 14, total: 79 } });
  host.notify({ source: "app-flow", runId: "run-1", seq: 2, event: { type: "complete", phase: "render", message: "Done", completed: 14, total: 79 } });
  assert.equal(panel.getSnapshot().runId, "run-1");
  host.returnsStatus({
    exists: true, runId: "run-1", projectId: "project-1", state: "suspended",
    event: { type: "step", phase: "capture", message: "Settings", completed: 14, total: 79 },
  });
  await panel.requestAgentStart({ mode: "screen-ui-and-structure", explorationMode: "fast" });
  await settle(120);
  assert.equal(panel.getSnapshot().runId, null, "the paused run this start replaces is refused");
  assert.equal(panel.getSnapshot().sweepSummary, null, "the finished run's tally does not come back");
  assert.equal(panel.getSnapshot().agentStartPending, true, "the panel is still waiting for the real run");
  host.notify({ source: "app-flow", runId: "run-2", seq: 1, event: { type: "step", phase: "capture", message: "Home", completed: 1, total: 79 } });
  assert.equal(panel.getSnapshot().runId, "run-2");
  assert.equal(panel.getSnapshot().state, "running");
  assert.equal(panel.getSnapshot().agentStartPending, false);
  assert.deepEqual(panel.getSnapshot().sweepSummary, { completed: 1, total: 79, message: "Home" });
});

// The same trap with the server's other runId-bearing answer: a Codex-owned run whose worker
// exited is reconciled to "failed" and returned WITH its runId.
test("an orphaned previous run reconciled to failed is not adopted while a new sweep is being started", async t => {
  const host = fixture(); const panel = new AppFlowPanel(host.app, 5); t.after(() => panel.dispose());
  panel.setAvailable(true); panel.show(); await settle();
  await panel.selectProject("/projects/demo");
  await panel.start({ mode: "structure-only" });
  host.notify({ source: "app-flow", runId: "run-1", seq: 1, event: { type: "step", phase: "capture", message: "Settings", completed: 14, total: 79 } });
  host.returnsStatus({
    exists: true, runId: "run-1", projectId: "project-1", state: "failed",
    error: "App Flow stopped because its Codex worker exited.",
    event: { type: "error", phase: "capture", message: "App Flow stopped because its Codex worker exited." },
  });
  await panel.requestAgentStart({ mode: "screen-ui-and-structure", explorationMode: "fast" });
  await settle(120);
  assert.equal(panel.getSnapshot().runId, null, "a run reconciled to failed is not a run to follow");
  assert.equal(panel.getSnapshot().agentStartPending, true);
  host.events([{ seq: 1, runId: "run-2", event: { type: "step", phase: "capture", message: "Home", completed: 1, total: 79 } }]);
  host.returnsStatus({ exists: true, runId: "run-2", projectId: "project-1", state: "running" });
  await settle(120);
  assert.equal(panel.getSnapshot().runId, "run-2", "the live run that follows is adopted normally");
  assert.equal(panel.getSnapshot().state, "running");
  assert.deepEqual(panel.getSnapshot().sweepSummary, { completed: 1, total: 79, message: "Home" });
});

// Durable cross-process replay numbers its event with `Date.parse(updatedAt)`; in-process events
// use a counter from 1. Sharing one cursor between them pushed it past every in-process seq the
// run could produce, so the sweep went silent for good.
test("a durable cross-process event does not push the in-process cursor out of reach", async t => {
  const host = fixture(); const panel = new AppFlowPanel(host.app, 5); t.after(() => panel.dispose());
  panel.setAvailable(true); panel.show(); await settle();
  await panel.selectProject("/projects/demo");
  await panel.start({ mode: "structure-only" });
  const durableSeq = Date.parse("2026-10-16T10:00:00.000Z");
  host.notify({ source: "app-flow", runId: "run-1", seq: durableSeq, event: { type: "step", phase: "capture", message: "Replayed", completed: 2, total: 8 } });
  assert.deepEqual(panel.getSnapshot().sweepSummary, { completed: 2, total: 8, message: "Replayed" });
  host.notify({ source: "app-flow", runId: "run-1", seq: 3, event: { type: "step", phase: "capture", message: "Profile", completed: 3, total: 8 } });
  assert.deepEqual(panel.getSnapshot().sweepSummary, { completed: 3, total: 8, message: "Profile" }, "in-process events keep arriving after a durable replay");
  // The poll cursor stays in the in-process space, so the server's own `seq > since` filter cannot
  // withhold those events either.
  await settle(60);
  const polls = host.calls.filter(call => call.name === "mobile_appflow_events");
  assert.ok(polls.every(call => Number(call.arguments?.since ?? 0) < durableSeq), "the poll cursor is never stamped with a timestamp");
  // A durable event already applied is still deduped on its own cursor.
  host.notify({ source: "app-flow", runId: "run-1", seq: durableSeq, event: { type: "step", phase: "capture", message: "Replayed", completed: 2, total: 8 } });
  assert.deepEqual(panel.getSnapshot().sweepSummary, { completed: 3, total: 8, message: "Profile" });
});

// `start` kept the finished run's id across a second structure build, so the ingest guard dropped
// the new run's events (while still advancing the cursor past them) until the id happened to change.
test("a second direct start retires the previous run before the new one begins", async t => {
  const host = fixture(); const panel = new AppFlowPanel(host.app); t.after(() => panel.dispose());
  panel.setAvailable(true); await panel.selectProject("/projects/demo");
  await panel.start({ mode: "structure-only" });
  host.notify({ source: "app-flow", runId: "run-1", seq: 1, event: { type: "step", phase: "capture", message: "Settings", completed: 14, total: 79 } });
  host.notify({ source: "app-flow", runId: "run-1", seq: 2, event: { type: "complete", phase: "render", message: "Done", completed: 14, total: 79 } });
  await panel.start({ mode: "structure-only" });
  assert.equal(panel.getSnapshot().sweepSummary, null, "the previous run's tally is cleared, not carried over");
  // The new run's buffer restarts at seq 1; the old run's cursor must not swallow it.
  host.notify({ source: "app-flow", runId: "run-1", seq: 1, event: { type: "step", phase: "capture", message: "Home", completed: 1, total: 79 } });
  assert.deepEqual(panel.getSnapshot().sweepSummary, { completed: 1, total: 79, message: "Home" });
});
