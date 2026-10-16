import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
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

const hostContext = { theme: "light", availableDisplayModes: ["inline", "fullscreen"] };

test("TraceSift Investigate fetches one authoritative handoff and sends it to the active chat", async () => {
  const calls: unknown[] = []; const messages: unknown[] = [];
  const app = {
    getHostCapabilities: () => ({ serverTools: {}, message: { text: {} } }),
    getHostContext: () => hostContext,
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
  const app = { getHostCapabilities: () => ({}), getHostContext: () => undefined, async callServerTool() { calls++; return {}; }, async sendMessage() { calls++; return {}; } };
  const controller = new TraceSiftController(app as never);
  controller.hostChanged(); controller.accept({ content: [], structuredContent: analysis });
  await controller.investigate("react-commit-1-2");
  assert.equal(calls, 0); assert.equal(controller.getSnapshot().canInvestigate, false);
});

test("TraceSift restores cards for a recreated inline view", async () => {
  const calls: unknown[] = [];
  const app = {
    getHostCapabilities: () => ({ serverTools: {}, message: { text: {} } }),
    getHostContext: () => hostContext,
    async callServerTool(input: unknown) {
      calls.push(input);
      return { content: [], structuredContent: { apiVersion: 1, restored: true, analysis } };
    },
    async sendMessage() { return {}; },
  };
  const controller = new TraceSiftController(app as never);
  controller.hostChanged();
  await controller.restore("tool-view-17");
  assert.deepEqual(calls, [{ name: "mobile_restore_tracesift_analysis", arguments: { viewId: "tool-view-17" } }]);
  assert.equal(controller.getSnapshot().analysis?.analysisId, "private-analysis");
});

test("TraceSift restores cards from replayed tool input when host view IDs are absent", async () => {
  const calls: unknown[] = [];
  const app = {
    getHostCapabilities: () => ({ serverTools: {}, message: { text: {} } }),
    getHostContext: () => hostContext,
    async callServerTool(input: unknown) {
      calls.push(input);
      return { content: [], structuredContent: { apiVersion: 1, restored: true, analysis } };
    },
    async sendMessage() { return {}; },
  };
  const controller = new TraceSiftController(app as never);
  controller.setProfileInput("App/sample-profiles/trace.json", "auto");
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [{ name: "mobile_restore_tracesift_analysis_by_input", arguments: { path: "App/sample-profiles/trace.json", profileType: "auto" } }]);
  assert.equal(controller.getSnapshot().analysis?.analysisId, "private-analysis");
});

test("TraceSift registers a live result against the stable host view", async () => {
  const calls: unknown[] = [];
  const app = {
    getHostCapabilities: () => ({ serverTools: {}, message: { text: {} } }),
    getHostContext: () => hostContext,
    async callServerTool(input: unknown) {
      calls.push(input);
      return { content: [], structuredContent: { remembered: true } };
    },
    async sendMessage() { return {}; },
  };
  const controller = new TraceSiftController(app as never);
  controller.accept({ content: [], structuredContent: analysis });
  controller.setViewId("exec-stable-view");
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [{ name: "mobile_remember_tracesift_analysis", arguments: { viewId: "exec-stable-view", analysisId: "private-analysis" } }]);
});

test("TraceSift registers a live result when host context arrives before the result", async () => {
  const calls: Array<{ name: string; arguments: unknown }> = [];
  const app = {
    getHostCapabilities: () => ({ serverTools: {}, message: { text: {} } }),
    getHostContext: () => hostContext,
    async callServerTool(input: { name: string; arguments: unknown }) {
      calls.push(input);
      return input.name === "mobile_restore_tracesift_analysis"
        ? { content: [], structuredContent: { apiVersion: 1, restored: false } }
        : { content: [], structuredContent: { remembered: true } };
    },
    async sendMessage() { return {}; },
  };
  const controller = new TraceSiftController(app as never);
  controller.setViewId("exec-stable-view");
  await new Promise(resolve => setImmediate(resolve));
  controller.accept({ content: [], structuredContent: analysis });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [
    { name: "mobile_restore_tracesift_analysis", arguments: { viewId: "exec-stable-view" } },
    { name: "mobile_remember_tracesift_analysis", arguments: { viewId: "exec-stable-view", analysisId: "private-analysis" } },
  ]);
});

test("TraceSift does not replace a result that arrived while restore was pending", async () => {
  let finish!: (value: unknown) => void;
  const pending = new Promise(resolve => { finish = resolve; });
  const app = {
    getHostCapabilities: () => ({ serverTools: {}, message: { text: {} } }),
    getHostContext: () => hostContext,
    async callServerTool() { return pending; },
    async sendMessage() { return {}; },
  };
  const controller = new TraceSiftController(app as never);
  const restoring = controller.restore(23);
  controller.accept({ content: [], structuredContent: { ...cpuAnalysis, analysisId: "live-analysis" } });
  finish({ content: [], structuredContent: { apiVersion: 1, restored: true, analysis } });
  await restoring;
  assert.equal(controller.getSnapshot().analysis?.analysisId, "live-analysis");
});

test("TraceSift never retries an unconfirmed send", async () => {
  let sends = 0;
  const app = {
    getHostCapabilities: () => ({ serverTools: {}, message: { text: {} } }),
    getHostContext: () => hostContext,
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
    getHostContext: () => hostContext,
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

/** The envelope `mobile_tracesift_explore_payload` answers with: metadata plus one JSON text item. */
function payloadResult(kind: "task" | "react", payload: unknown) {
  const text = JSON.stringify(payload);
  return { content: [{ type: "text", text }], structuredContent: { apiVersion: 1, kind, encoding: "json", payloadBytes: text.length } };
}

test("TraceSift Explore opens the embedded explorer with the task's full tree", async () => {
  const calls: unknown[] = [];
  const modes: string[] = [];
  const app = {
    getHostCapabilities: () => ({ serverTools: {}, message: { text: {} } }),
    getHostContext: () => hostContext,
    async requestDisplayMode({ mode }: { mode: string }) { modes.push(mode); return { mode }; },
    async callServerTool(input: unknown) { calls.push(input); return payloadResult("task", { apiVersion: 1, analysisId: "private-analysis", card: { tree: { id: "n0" } } }); },
    async sendMessage() { return {}; },
  };
  const controller = new TraceSiftController(app as never);
  controller.hostChanged(); controller.accept({ content: [], structuredContent: cpuAnalysis });
  // The card's id and index differ: the tree is looked up by task index, and the
  // focused node travels with the click that opened it, not with the request.
  await controller.openExplore("task-0", "n0");
  assert.deepEqual(calls[0], { name: "mobile_tracesift_explore_payload", arguments: { analysisId: "private-analysis", taskIndex: 4 } });
  assert.equal(controller.getSnapshot().error, "");
  const explorer = controller.getSnapshot().explorer;
  assert.equal(explorer?.kind, "task");
  assert.equal(explorer?.cardId, "task-0");
  assert.equal(explorer?.focus, "n0");
  assert.deepEqual(explorer?.payload, { apiVersion: 1, analysisId: "private-analysis", card: { tree: { id: "n0" } } });
  assert.deepEqual(modes, ["fullscreen"]);
  controller.dispose();
});

test("TraceSift Explore opens one React analysis and remembers which commit the card named", async () => {
  const calls: unknown[] = [];
  const app = {
    getHostCapabilities: () => ({ serverTools: {}, message: { text: {} } }),
    getHostContext: () => ({ theme: "light", availableDisplayModes: ["inline"] }),
    async callServerTool(input: unknown) { calls.push(input); return payloadResult("react", { apiVersion: 1, explore: {}, cards: [] }); },
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
  // One fetch carries every commit, so the request names the analysis and the
  // explorer starts on the commit the reader pressed.
  await controller.openExplore("react-7-12");
  assert.deepEqual(calls[0], { name: "mobile_tracesift_explore_payload", arguments: { analysisId: "react-analysis" } });
  assert.equal(controller.getSnapshot().explorer?.commitKey, "7.12");
  controller.setExploreCommit("7.3");
  assert.equal(controller.getSnapshot().explorer?.commitKey, "7.3");
  controller.dispose();
});

test("TraceSift Explore reports a payload failure without leaving the explorer open", async () => {
  const app = {
    getHostCapabilities: () => ({ serverTools: {}, message: { text: {} } }),
    getHostContext: () => ({ theme: "light", availableDisplayModes: ["inline"] }),
    async callServerTool() { return { isError: true, content: [{ type: "text", text: "This analysis is no longer available to Explore. Run it again." }] }; },
    async sendMessage() { return {}; },
  };
  const controller = new TraceSiftController(app as never);
  controller.hostChanged(); controller.accept({ content: [], structuredContent: cpuAnalysis });
  await controller.openExplore("task-0");
  assert.match(controller.getSnapshot().error, /no longer available to Explore/);
  assert.equal(controller.getSnapshot().explorer, undefined);
  assert.equal(controller.getSnapshot().openingExploreCard, undefined);
  controller.dispose();
});

test("TraceSift Explore rejects an unreadable payload rather than rendering it", async () => {
  const app = {
    getHostCapabilities: () => ({ serverTools: {}, message: { text: {} } }),
    getHostContext: () => ({ theme: "light", availableDisplayModes: ["inline"] }),
    async callServerTool() { return { content: [{ type: "text", text: "{not json" }], structuredContent: { apiVersion: 1, kind: "task", encoding: "json", payloadBytes: 8 } }; },
    async sendMessage() { return {}; },
  };
  const controller = new TraceSiftController(app as never);
  controller.hostChanged(); controller.accept({ content: [], structuredContent: cpuAnalysis });
  await controller.openExplore("task-0");
  assert.match(controller.getSnapshot().error, /could not read/);
  assert.equal(controller.getSnapshot().explorer, undefined);
  controller.dispose();
});

test("TraceSift returns from the explorer to the cards and drops the payload", async () => {
  const app = {
    getHostCapabilities: () => ({ serverTools: {}, message: { text: {} } }),
    getHostContext: () => ({ theme: "light", availableDisplayModes: ["inline"] }),
    async callServerTool() { return payloadResult("task", { apiVersion: 1, card: {} }); },
    async sendMessage() { return {}; },
  };
  const controller = new TraceSiftController(app as never);
  controller.hostChanged(); controller.accept({ content: [], structuredContent: cpuAnalysis });
  await controller.openExplore("task-0");
  assert.ok(controller.getSnapshot().explorer);
  controller.closeExplore();
  assert.equal(controller.getSnapshot().explorer, undefined);
  assert.equal(controller.getSnapshot().analysis?.analysisId, "private-analysis");
  controller.dispose();
});

test("TraceSift keeps the browser window as an explicit alternative", async () => {
  const calls: unknown[] = [];
  const app = {
    getHostCapabilities: () => ({ serverTools: {}, message: { text: {} } }),
    getHostContext: () => ({ theme: "light", availableDisplayModes: ["inline"] }),
    async callServerTool(input: unknown) { calls.push(input); return { content: [], structuredContent: { opened: true } }; },
    async sendMessage() { return {}; },
  };
  const controller = new TraceSiftController(app as never);
  controller.hostChanged(); controller.accept({ content: [], structuredContent: cpuAnalysis });
  await controller.openExploreInBrowser("task-0");
  assert.deepEqual(calls[0], { name: "mobile_open_tracesift_explore", arguments: { analysisId: "private-analysis", taskIndex: 4 } });
  assert.equal(controller.getSnapshot().explorer, undefined);
  controller.dispose();
});

test("TraceSift explores inline when the host offers no fullscreen", async () => {
  let requested = 0;
  const app = {
    getHostCapabilities: () => ({ serverTools: {}, message: { text: {} } }),
    getHostContext: () => ({ theme: "light", availableDisplayModes: ["inline"] }),
    async requestDisplayMode() { requested++; return { mode: "inline" }; },
    async callServerTool() { return payloadResult("task", { apiVersion: 1, card: {} }); },
    async sendMessage() { return {}; },
  };
  const controller = new TraceSiftController(app as never);
  controller.hostChanged(); controller.accept({ content: [], structuredContent: cpuAnalysis });
  await controller.openExplore("task-0");
  assert.equal(requested, 0);
  assert.equal(controller.getSnapshot().explorer?.kind, "task");
  controller.dispose();
});

test("TraceSift inflates a compressed payload before rendering it", async () => {
  const payload = { apiVersion: 1, analysisId: "private-analysis", card: { tree: { id: "n0" } } };
  const text = gzipSync(JSON.stringify(payload)).toString("base64");
  const app = {
    getHostCapabilities: () => ({ serverTools: {}, message: { text: {} } }),
    getHostContext: () => hostContext,
    async requestDisplayMode({ mode }: { mode: string }) { return { mode }; },
    async callServerTool() { return { content: [{ type: "text", text }], structuredContent: { apiVersion: 1, kind: "task", encoding: "gzip+base64", payloadBytes: JSON.stringify(payload).length } }; },
    async sendMessage() { return {}; },
  };
  const controller = new TraceSiftController(app as never);
  controller.hostChanged(); controller.accept({ content: [], structuredContent: cpuAnalysis });
  await controller.openExplore("task-0");
  assert.deepEqual(controller.getSnapshot().explorer?.payload, payload);
  controller.dispose();
});

test("TraceSift refuses a payload past the panel's limit before decoding it", async () => {
  const app = {
    getHostCapabilities: () => ({ serverTools: {}, message: { text: {} } }),
    getHostContext: () => hostContext,
    async callServerTool() { return { content: [{ type: "text", text: "x" }], structuredContent: { apiVersion: 1, kind: "task", encoding: "json", payloadBytes: 25 * 1024 * 1024 } }; },
    async sendMessage() { return {}; },
  };
  const controller = new TraceSiftController(app as never);
  controller.hostChanged(); controller.accept({ content: [], structuredContent: cpuAnalysis });
  await controller.openExplore("task-0");
  assert.match(controller.getSnapshot().error, /Open in browser/);
  assert.equal(controller.getSnapshot().explorer, undefined);
  controller.dispose();
});

test("TraceSift Copy handoff puts the authoritative text on the clipboard and never sends it to the chat", async () => {
  const copied: string[] = []; const messages: unknown[] = [];
  const app = {
    getHostCapabilities: () => ({ serverTools: {}, message: { text: {} } }),
    getHostContext: () => hostContext,
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
