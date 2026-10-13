import assert from "node:assert/strict";
import test from "node:test";
import { TraceSiftController } from "../src/ui/tracesift-controller.ts";

const analysis = {
  apiVersion: 1, analysisId: "private-analysis", profileType: "react", title: "Profile", summary: { rootCount: 1, commitCount: 3, totalCommitRenderDurationMs: 50, peakCommitDurationMs: 30, commitsOverBudget: 1, omittedEvidenceCommitCount: 0 },
  cards: [{
    id: "react-commit-1-2", rootId: 1, commitIndex: 2, startMs: 10, durationMs: 30, percentOfRender: 40,
    severity: "high", shape: "single", headline: "Heavy component", shapeline: "one component dominated",
    causeline: "render causes recorded", renderedCount: 3, summedSelfMs: 28, unattributedMs: 2,
    effectDurationMs: 0, passiveEffectDurationMs: 0, priority: null, updaters: [], culprits: [],
    culpritTailCount: 0, culpritTailMs: 0, causes: [], wasted: null, confidence: "ok",
  }],
};

test("TraceSift Investigate fetches one authoritative handoff and sends it to the active chat", async () => {
  const calls: unknown[] = []; const messages: unknown[] = [];
  const app = {
    getHostCapabilities: () => ({ serverTools: {}, message: { text: {} } }),
    async callServerTool(input: unknown) { calls.push(input); return { content: [], structuredContent: { apiVersion: 1, handoff: "PRIVATE_HANDOFF" } }; },
    async sendMessage(message: unknown) { messages.push(message); return {}; },
  };
  const controller = new TraceSiftController(app as never);
  controller.hostChanged(); controller.accept({ content: [], structuredContent: analysis });
  await Promise.all([controller.investigate("react-commit-1-2"), controller.investigate("react-commit-1-2")]);
  assert.equal(calls.length, 1); assert.equal(messages.length, 1);
  assert.deepEqual(calls[0], { name: "mobile_get_tracesift_handoff", arguments: { analysisId: "private-analysis", cardId: "react-commit-1-2" } });
  assert.equal((messages[0] as { content: Array<{ text: string }> }).content[0].text, "PRIVATE_HANDOFF");
  assert.deepEqual((messages[0] as { _meta: unknown })._meta, { "openai/message": { target: "active", send: true } });
});

test("TraceSift disables investigation when host capabilities are absent", async () => {
  let calls = 0;
  const app = { getHostCapabilities: () => ({}), async callServerTool() { calls++; return {}; }, async sendMessage() { calls++; return {}; } };
  const controller = new TraceSiftController(app as never);
  controller.hostChanged(); controller.accept({ content: [], structuredContent: analysis });
  await controller.investigate("react-commit-1-2");
  assert.equal(calls, 0); assert.equal(controller.getSnapshot().canInvestigate, false);
});

test("TraceSift never retries an unconfirmed send", async () => {
  let sends = 0;
  const app = {
    getHostCapabilities: () => ({ serverTools: {}, message: { text: {} } }),
    async callServerTool() { return { content: [], structuredContent: { apiVersion: 1, handoff: "PRIVATE_HANDOFF" } }; },
    async sendMessage() { sends++; throw Object.assign(new Error("timeout"), { code: -32001 }); },
  };
  const controller = new TraceSiftController(app as never);
  controller.hostChanged(); controller.accept({ content: [], structuredContent: analysis });
  await controller.investigate("react-commit-1-2");
  assert.equal(sends, 1);
  assert.match(controller.getSnapshot().error, /Check the chat before retrying/);
});

test("TraceSift reports an unavailable composer without retrying", async () => {
  let sends = 0;
  const app = {
    getHostCapabilities: () => ({ serverTools: {}, message: { text: {} } }),
    async callServerTool() { return { content: [], structuredContent: { apiVersion: 1, handoff: "PRIVATE_HANDOFF" } }; },
    async sendMessage() { sends++; throw new Error("No active composer is available."); },
  };
  const controller = new TraceSiftController(app as never);
  controller.hostChanged(); controller.accept({ content: [], structuredContent: analysis });
  await controller.investigate("react-commit-1-2");
  assert.equal(sends, 1);
  assert.match(controller.getSnapshot().error, /Reopen the chat/);
});

const cpuAnalysis = {
  apiVersion: 1, analysisId: "private-analysis", profileType: "cpu", title: "Profile",
  summary: { totalMs: 180, callCountIsExact: true, taskCount: 870 },
  cards: [{
    id: "task-0", taskIndex: 4, startMs: 10, durationMs: 75, boundaries: "tasks", headline: "A long task",
    percentOfProfile: 40, boundaryFrames: [], boundaryTailCount: 0, boundaryTailMs: 0, outsideBoundariesMs: 5,
    culprits: [], subtreeFunctionCount: 1, confidence: "ok",
  }],
};
test("TraceSift Explore opens the owning web app with its task index and focus", async () => {
  const calls: unknown[] = [];
  const app = {
    getHostCapabilities: () => ({ serverTools: {}, message: { text: {} } }),
    async callServerTool(input: unknown) { calls.push(input); return { content: [], structuredContent: { opened: true } }; },
    async sendMessage() { return {}; },
  };
  const controller = new TraceSiftController(app as never);
  controller.hostChanged(); controller.accept({ content: [], structuredContent: cpuAnalysis });
  // The card's id and index differ; TraceSift's web app looks up a task by its
  // index. Its data stays in that app rather than travelling through MCP.
  await controller.openExplore("task-0", "n0");
  assert.deepEqual(calls[0], { name: "mobile_open_tracesift_explore", arguments: { analysisId: "private-analysis", taskIndex: 4, focus: "n0" } });
  assert.equal(controller.getSnapshot().error, "");
});

test("TraceSift Explore opens a React commit by root and commit index", async () => {
  const calls: unknown[] = [];
  const app = {
    getHostCapabilities: () => ({ serverTools: {}, message: { text: {} } }),
    async callServerTool(input: unknown) { calls.push(input); return { content: [], structuredContent: { opened: true } }; },
    async sendMessage() { return {}; },
  };
  const controller = new TraceSiftController(app as never);
  controller.hostChanged();
  controller.accept({ content: [], structuredContent: {
    apiVersion: 1, analysisId: "react-analysis", profileType: "react", title: "React",
    summary: { rootCount: 1, commitCount: 1, totalCommitRenderDurationMs: 40, peakCommitDurationMs: 40, commitsOverBudget: 1, omittedEvidenceCommitCount: 0 },
    cards: [{ id: "react-7-12", rootId: 7, commitIndex: 12, startMs: 0, durationMs: 40, percentOfRender: 100,
      severity: "high", shape: "single", headline: "List rendered", shapeline: "75% in one component", causeline: "props changed",
      renderedCount: 1, summedSelfMs: 40, unattributedMs: 0, effectDurationMs: 0, passiveEffectDurationMs: 0,
      priority: null, updaters: [], culprits: [], culpritTailCount: 0, culpritTailMs: 0, causes: [], wasted: null, confidence: "ok" }],
  } });
  await controller.openExplore("react-7-12");
  assert.deepEqual(calls[0], { name: "mobile_open_tracesift_explore", arguments: { analysisId: "react-analysis", rootId: 7, commitIndex: 12 } });
});

test("TraceSift Explore keeps the cards visible and surfaces a CLI-open failure", async () => {
  const app = {
    getHostCapabilities: () => ({ serverTools: {}, message: { text: {} } }),
    async callServerTool() { return { isError: true, content: [{ type: "text", text: "TraceSift CLI could not open Explore." }] }; },
    async sendMessage() { return {}; },
  };
  const controller = new TraceSiftController(app as never);
  controller.hostChanged(); controller.accept({ content: [], structuredContent: cpuAnalysis });
  await controller.openExplore("task-0");
  assert.match(controller.getSnapshot().error, /CLI could not open Explore/);
});

test("TraceSift Copy handoff puts the authoritative text on the clipboard and never sends it to the chat", async () => {
  const copied: string[] = []; const messages: unknown[] = [];
  const app = {
    getHostCapabilities: () => ({ serverTools: {}, message: { text: {} } }),
    async callServerTool() { return { content: [], structuredContent: { apiVersion: 1, handoff: "PRIVATE_HANDOFF" } }; },
    async sendMessage(message: unknown) { messages.push(message); return {}; },
  };
  const clipboard = { async writeText(text: string) { copied.push(text); } };
  Object.defineProperty(globalThis, "navigator", { value: { clipboard }, configurable: true });
  const controller = new TraceSiftController(app as never);
  controller.hostChanged(); controller.accept({ content: [], structuredContent: cpuAnalysis });
  await controller.copyHandoff("task-0");
  assert.deepEqual(copied, ["PRIVATE_HANDOFF"]);
  assert.deepEqual(messages, []);
  assert.equal(controller.getSnapshot().copiedCard, "task-0");
  assert.equal(controller.getSnapshot().handoffCard, undefined);
  controller.dispose();
});
