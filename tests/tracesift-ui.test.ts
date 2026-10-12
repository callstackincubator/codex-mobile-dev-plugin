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
