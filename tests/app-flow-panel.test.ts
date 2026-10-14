import assert from "node:assert/strict";
import test from "node:test";
import type { App } from "@modelcontextprotocol/ext-apps";
import { AppFlowPanel } from "../src/ui/app-flow-panel.ts";

function fixture(canMessage = true) {
  const calls: Array<{ name: string; arguments?: Record<string, unknown> }> = [];
  const messages: Array<{ content: Array<{ text: string }> }> = [];
  let notification: ((value: { params: { data: unknown } }) => void) | undefined;
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
      return { content: [], structuredContent: {} };
    },
  };
  return { app: app as unknown as App, calls, messages, notify(data: unknown) { notification?.({ params: { data } }); } };
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

test("screenshot URIs are reduced to the server's authorized encoded path", async t => {
  const host = fixture(); const panel = new AppFlowPanel(host.app); t.after(() => panel.dispose());
  const url = await panel.screenshot("project-1", "appflow-image://mobile-dev/project-1/c2NyZWVucy9ob21lLnBuZw");
  assert.match(url, /^blob:/);
  assert.deepEqual(host.calls.at(-1), { name: "mobile_appflow_screenshot", arguments: { projectId: "project-1", path: "c2NyZWVucy9ob21lLnBuZw" } });
});
