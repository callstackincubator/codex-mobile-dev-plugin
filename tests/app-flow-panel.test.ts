import assert from "node:assert/strict";
import test from "node:test";
import type { App } from "@modelcontextprotocol/ext-apps";
import { AppFlowPanel } from "../src/ui/app-flow-panel.ts";

function fixture(canMessage = true, projectList: unknown[] = []) {
  const calls: Array<{ name: string; arguments?: Record<string, unknown> }> = [];
  const messages: Array<{ content: Array<{ text: string }> }> = [];
  let notification: ((value: { params: { data: unknown } }) => void) | undefined;
  let projects = projectList;
  let nextProject: unknown;
  const app = {
    getHostCapabilities() { return canMessage ? { message: { text: {} } } : {}; },
    setNotificationHandler(_schema: unknown, handler: typeof notification) { notification = handler; },
    removeNotificationHandler() {},
    async sendMessage(message: typeof messages[number]) { messages.push(message); return {}; },
    async callServerTool(input: { name: string; arguments?: Record<string, unknown> }) {
      calls.push(input);
      if (input.name === "mobile_appflow_start") return { content: [], structuredContent: { runId: "run-1", state: "running" } };
      if (input.name === "mobile_appflow_status") return { content: [], structuredContent: { exists: false, state: "idle" } };
      if (input.name === "mobile_appflow_screenshot") return { content: [{ type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" }] };
      if (input.name === "mobile_appflow_projects") return { content: [], structuredContent: { projects } };
      if (input.name === "mobile_appflow_choose_project") return { content: [], structuredContent: nextProject ? { project: nextProject } : {} };
      return { content: [], structuredContent: {} };
    },
  };
  return {
    app: app as unknown as App, calls, messages,
    notify(data: unknown) { notification?.({ params: { data } }); },
    list(value: unknown[]) { projects = value; },
    returnsProject(value: unknown) { nextProject = value; },
  };
}

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
  assert.match(url, /^blob:/);
  assert.deepEqual(host.calls.at(-1), { name: "mobile_appflow_screenshot", arguments: { projectId: "project-1", path: "c2NyZWVucy9ob21lLnBuZw" } });
});
