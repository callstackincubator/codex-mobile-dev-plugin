import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { TraceSiftController } from "../src/tracesift-controller.ts";
import { getUiTelemetryAttributes } from "../src/telemetry.ts";

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

const PROJECT = "/private/project";

/** Answers the project read for Investigate; every other call falls through to the test's stub. */
function withProject<T extends { callServerTool: (input: never) => Promise<unknown> }>(app: T) {
  const answer = app.callServerTool.bind(app);
  return { ...app, async callServerTool(input: { name: string }) {
    return input.name === "mobile_get_tracesift_project"
      ? { content: [], structuredContent: { path: PROJECT } }
      : answer(input as never);
  } };
}

const hostContext = { theme: "light", availableDisplayModes: ["inline", "fullscreen"] };

test("TraceSift Investigate fetches one authoritative handoff and sends it to the active chat", async () => {
  const calls: unknown[] = []; const messages: unknown[] = [];
  const app = {
    getHostCapabilities: () => ({ serverTools: {}, message: { text: {} } }),
    getHostContext: () => hostContext,
    async callServerTool(input: unknown) { calls.push(input); return { content: [], structuredContent: { apiVersion: 1, handoff: "PRIVATE_HANDOFF" } }; },
    async sendMessage(message: unknown) { messages.push(message); return {}; },
  };
  const controller = new TraceSiftController(withProject(app) as never);
  controller.hostChanged();
  await controller.loadProject();
  controller.accept({ content: [], structuredContent: analysis });
  await Promise.all([controller.investigate("react-commit-1-2"), controller.investigate("react-commit-1-2")]);
  assert.equal(calls.length, 1); assert.equal(messages.length, 1);
  assert.deepEqual(calls[0], { name: "mobile_get_tracesift_handoff", arguments: { analysisId: "private-analysis", cardId: "react-commit-1-2" } });
  // The project line tells the chat which code the named frames belong to.
  assert.equal((messages[0] as { content: Array<{ text: string }> }).content[0].text, `Investigate this in the project at ${PROJECT}.\n\nPRIVATE_HANDOFF`);
  assert.equal((messages[0] as { _meta: unknown })._meta, undefined);
});

test("TraceSift disables investigation when host capabilities are absent", async () => {
  let calls = 0;
  const app = { getHostCapabilities: () => ({}), getHostContext: () => undefined, async callServerTool() { calls++; return {}; }, async sendMessage() { calls++; return {}; } };
  const controller = new TraceSiftController(app as never);
  controller.hostChanged(); controller.accept({ content: [], structuredContent: analysis });
  await controller.investigate("react-commit-1-2");
  assert.equal(calls, 0); assert.equal(controller.getSnapshot().canInvestigate, false);
});

test("TraceSift holds Investigate until a project is chosen, then sends with it", async () => {
  const messages: unknown[] = [];
  let saved: string | undefined;
  const app = {
    getHostCapabilities: () => ({ serverTools: {}, message: { text: {} } }),
    getHostContext: () => hostContext,
    async callServerTool(input: { name: string }) {
      if (input.name === "mobile_get_tracesift_project") return { content: [], structuredContent: saved ? { path: saved } : {} };
      if (input.name === "mobile_pick_tracesift_project") { saved = PROJECT; return { content: [], structuredContent: { picked: true, path: PROJECT } }; }
      return { content: [], structuredContent: { apiVersion: 1, handoff: "PRIVATE_HANDOFF" } };
    },
    async sendMessage(message: unknown) { messages.push(message); return {}; },
  };
  const controller = new TraceSiftController(app as never);
  controller.hostChanged();
  await controller.loadProject();
  controller.accept({ content: [], structuredContent: analysis });
  // A profile names frames, not files; without a project the chat would have to guess the code.
  assert.equal(controller.getSnapshot().project, undefined);
  await controller.investigate("react-commit-1-2");
  assert.deepEqual(messages, []);

  await controller.pickProject();
  assert.equal(controller.getSnapshot().project, PROJECT);
  await controller.investigate("react-commit-1-2");
  assert.equal(messages.length, 1);
  assert.match((messages[0] as { content: Array<{ text: string }> }).content[0]!.text, /^Investigate this in the project at \/private\/project\./);
  controller.dispose();
});

test("TraceSift keeps a cancelled folder dialog from clearing the project it had", async () => {
  const controller = new TraceSiftController({
    getHostCapabilities: () => ({ serverTools: {}, message: { text: {} } }),
    getHostContext: () => hostContext,
    async callServerTool(input: { name: string }) {
      return input.name === "mobile_get_tracesift_project"
        ? { content: [], structuredContent: { path: PROJECT } }
        : { content: [], structuredContent: { picked: false } };
    },
    async sendMessage() { return {}; },
  } as never);
  controller.hostChanged();
  await controller.loadProject();
  assert.equal(controller.getSnapshot().project, PROJECT);
  await controller.pickProject();
  assert.equal(controller.getSnapshot().project, PROJECT);
  assert.equal(controller.getSnapshot().projectBusy, false);
  controller.dispose();
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
  const controller = new TraceSiftController(withProject(app) as never);
  controller.hostChanged();
  await controller.loadProject();
  controller.accept({ content: [], structuredContent: analysis });
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
  const controller = new TraceSiftController(withProject(app) as never);
  controller.hostChanged();
  await controller.loadProject();
  controller.accept({ content: [], structuredContent: analysis });
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
  // The tree is looked up by task index, not card id; the focused node is not part of the request.
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
  // One fetch carries every commit; the explorer starts on the pressed one.
  await controller.openExplore("react-7-12");
  assert.deepEqual(calls[0], { name: "mobile_tracesift_explore_payload", arguments: { analysisId: "react-analysis" } });
  assert.equal(controller.getSnapshot().explorer?.commitKey, "7.12");
  controller.setExploreCommit("7.3");
  assert.equal(controller.getSnapshot().explorer?.commitKey, "7.3");
  controller.dispose();
});

test("TraceSift Explore sends a finding too large for the panel to the browser window", async () => {
  const calls: { name: string; arguments: unknown }[] = [];
  const app = {
    getHostCapabilities: () => ({ serverTools: {}, message: { text: {} } }),
    getHostContext: () => ({ theme: "light", availableDisplayModes: ["inline"] }),
    async callServerTool(input: { name: string; arguments: unknown }) {
      calls.push(input);
      if (input.name === "mobile_tracesift_explore_payload") {
        return { isError: true, content: [{ type: "text", text: "This finding is larger than the panel can open." }] };
      }
      return { content: [], structuredContent: { opened: true } };
    },
    async sendMessage() { return {}; },
  };
  const controller = new TraceSiftController(app as never);
  controller.hostChanged(); controller.accept({ content: [], structuredContent: cpuAnalysis });
  await controller.openExplore("task-0", "n0");
  // The refusal falls back to the path that needs no bridge, carrying the clicked node.
  assert.deepEqual(calls.map(call => call.name), ["mobile_tracesift_explore_payload", "mobile_open_tracesift_explore"]);
  assert.deepEqual(calls[1]!.arguments, { analysisId: "private-analysis", taskIndex: 4, focus: "n0" });
  assert.equal(controller.getSnapshot().error, "");
  assert.match(controller.getSnapshot().notice, /Opened it in your browser/);
  assert.equal(controller.getSnapshot().explorer, undefined);
  assert.equal(controller.getSnapshot().openingExploreCard, undefined);
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

test("TraceSift hands the width back to the cards when the explorer closes", async () => {
  const modes: string[] = [];
  const app = {
    getHostCapabilities: () => ({ serverTools: {}, message: { text: {} } }),
    getHostContext: () => hostContext,
    async requestDisplayMode({ mode }: { mode: string }) { modes.push(mode); return { mode }; },
    async callServerTool() { return payloadResult("task", { apiVersion: 1, card: {} }); },
    async sendMessage() { return {}; },
  };
  const controller = new TraceSiftController(app as never);
  controller.hostChanged(); controller.accept({ content: [], structuredContent: cpuAnalysis });
  await controller.openExplore("task-0");
  controller.closeExplore();
  // Without the second request the card list would stay fullscreen.
  await Promise.resolve();
  assert.deepEqual(modes, ["fullscreen", "inline"]);
  controller.dispose();
});

test("TraceSift drops an explorer payload whose analysis was replaced while it loaded", async () => {
  let release: (() => void) | undefined;
  const app = {
    getHostCapabilities: () => ({ serverTools: {}, message: { text: {} } }),
    getHostContext: () => hostContext,
    async requestDisplayMode({ mode }: { mode: string }) { return { mode }; },
    async callServerTool() {
      await new Promise<void>(resolve => { release = resolve; });
      return payloadResult("task", { apiVersion: 1, card: {} });
    },
    async sendMessage() { return {}; },
  };
  const controller = new TraceSiftController(app as never);
  controller.hostChanged(); controller.accept({ content: [], structuredContent: cpuAnalysis });
  const opening = controller.openExplore("task-0");
  // A second reading lands while the first payload is still in flight.
  controller.accept({ content: [], structuredContent: { ...cpuAnalysis, analysisId: "second-analysis" } });
  release?.();
  await opening;
  assert.equal(controller.getSnapshot().explorer, undefined);
  assert.equal(controller.getSnapshot().openingExploreCard, undefined);
  assert.equal(controller.getSnapshot().analysis?.analysisId, "second-analysis");
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

test("TraceSift hands a payload past the panel's limit to the browser before decoding it", async () => {
  const names: string[] = [];
  const app = {
    getHostCapabilities: () => ({ serverTools: {}, message: { text: {} } }),
    getHostContext: () => hostContext,
    async callServerTool({ name }: { name: string }) {
      names.push(name);
      return name === "mobile_tracesift_explore_payload"
        ? { content: [{ type: "text", text: "x" }], structuredContent: { apiVersion: 1, kind: "task", encoding: "json", payloadBytes: 25 * 1024 * 1024 } }
        : { content: [], structuredContent: { opened: true } };
    },
    async sendMessage() { return {}; },
  };
  const controller = new TraceSiftController(app as never);
  controller.hostChanged(); controller.accept({ content: [], structuredContent: cpuAnalysis });
  await controller.openExplore("task-0");
  // The size is known from the envelope before inflating, so the browser window takes it instead.
  assert.deepEqual(names, ["mobile_tracesift_explore_payload", "mobile_open_tracesift_explore"]);
  assert.equal(controller.getSnapshot().error, "");
  assert.match(controller.getSnapshot().notice, /larger than the panel can open/);
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

const taskHandoff = {
  apiVersion: 1, analysisId: "private-analysis", totalMs: 180,
  card: {
    id: "task-0", durationMs: 75, percentOfProfile: 40, boundaries: "tasks",
    headline: "A long task", pathline: "Search_Search rendered the list",
    culprits: [{ nodeId: "0.1", name: "Search_Search", selfMs: 30, totalMs: 60, invocations: 2 }],
    tree: {
      id: "0", name: "runRoot", frameClass: "app", totalMs: 75, selfMs: 0, invocations: 1,
      children: [{ id: "0.1", name: "Search_Search", frameClass: "app", totalMs: 60, selfMs: 30, invocations: 2, children: [] }],
    },
  },
};

function exploreApp(messages: unknown[]) {
  return {
    getHostCapabilities: () => ({ serverTools: {}, message: { text: {} } }),
    getHostContext: () => hostContext,
    async callServerTool() { return payloadResult("task", taskHandoff); },
    async sendMessage(message: unknown) { messages.push(message); return {}; },
  };
}

async function exploringTask(messages: unknown[]) {
  const controller = new TraceSiftController(withProject(exploreApp(messages)) as never);
  controller.hostChanged();
  await controller.loadProject();
  controller.accept({ content: [], structuredContent: cpuAnalysis });
  await controller.openExplore("task-0");
  return controller;
}

test("TraceSift picks frames across views and toggles a pick off on the second click", async () => {
  const messages: unknown[] = [];
  const controller = await exploringTask(messages);
  assert.equal(controller.getSnapshot().explorer?.selected, undefined);

  controller.setPicking(true);
  controller.toggleSelectedFrame("0");
  controller.toggleSelectedFrame("0.1");
  assert.deepEqual(controller.getSnapshot().explorer?.selected, ["0", "0.1"]);
  controller.toggleSelectedFrame("0");
  assert.deepEqual(controller.getSnapshot().explorer?.selected, ["0.1"]);

  // Clearing stays in picking mode.
  controller.clearSelectedFrames();
  assert.deepEqual(controller.getSnapshot().explorer?.selected, []);
  assert.equal(controller.getSnapshot().explorer?.picking, true);
  controller.dispose();
});

test("TraceSift empties the selection when the reader switches picking off", async () => {
  const messages: unknown[] = [];
  const controller = await exploringTask(messages);
  controller.setPicking(true);
  controller.toggleSelectedFrame("0.1");
  assert.deepEqual(controller.getSnapshot().explorer?.selected, ["0.1"]);

  // Picks go with the mode: leftover rings would look like picking never turned off, and a send would carry a set whose count is hidden.
  controller.setPicking(false);
  assert.deepEqual(controller.getSnapshot().explorer?.selected, []);
  assert.equal(controller.getSnapshot().explorer?.picking, false);

  // Out of picking mode a click is navigation, not a pick.
  controller.toggleSelectedFrame("0.1");
  assert.deepEqual(controller.getSnapshot().explorer?.selected, []);

  controller.setPicking(true);
  controller.toggleSelectedFrame("0.1");
  assert.deepEqual(controller.getSnapshot().explorer?.selected, ["0.1"]);
  controller.dispose();
});

test("TraceSift sends the selected frames' measured evidence to the active chat", async () => {
  const messages: unknown[] = [];
  const controller = await exploringTask(messages);
  controller.setPicking(true);
  controller.toggleSelectedFrame("0.1");
  await controller.investigateSelected();

  assert.equal(messages.length, 1);
  const text = (messages[0] as { content: Array<{ text: string }> }).content[0]!.text;
  assert.match(text, /1\. `Search_Search`/);
  assert.match(text, /60 ms including everything it called/);
  assert.match(text, /Search_Search rendered the list/);
  assert.match(text, /← selection #1/);
  assert.equal((messages[0] as { _meta: unknown })._meta, undefined);
  // No handoff round trip, so an older installed TraceSift works too.
  assert.equal(controller.getSnapshot().error, "");
  controller.dispose();
});

test("TraceSift will not send an empty selection and says why", async () => {
  const messages: unknown[] = [];
  const controller = await exploringTask(messages);
  controller.setPicking(true);
  await controller.investigateSelected();
  assert.deepEqual(messages, []);
  assert.match(controller.getSnapshot().error, /Nothing is selected/);
  controller.dispose();
});

test("TraceSift reports a selection it cannot describe rather than sending an empty ask", async () => {
  const messages: unknown[] = [];
  const controller = new TraceSiftController(withProject({
    getHostCapabilities: () => ({ serverTools: {}, message: { text: {} } }),
    getHostContext: () => hostContext,
    async callServerTool() { return payloadResult("task", { apiVersion: 1, analysisId: "private-analysis", card: { durationMs: 75, tree: { id: "0", name: "root", frameClass: "app", totalMs: 75, selfMs: 75, invocations: 1, children: [] } } }); },
    async sendMessage(message: unknown) { messages.push(message); return {}; },
  }) as never);
  controller.hostChanged();
  await controller.loadProject();
  controller.accept({ content: [], structuredContent: cpuAnalysis });
  await controller.openExplore("task-0");
  controller.setPicking(true);
  // A frame the tree collapsed away can still be showing on screen.
  controller.toggleSelectedFrame("0.4.2");
  await controller.investigateSelected();
  assert.deepEqual(messages, []);
  // Distinct from selecting nothing: the picks failed to match the payload.
  assert.match(controller.getSnapshot().error, /None of the selected frames are in this task's call tree/);
  controller.dispose();
});

test("TraceSift reports a selection whose tree never arrived without sending an empty ask", async () => {
  const messages: unknown[] = [];
  const controller = new TraceSiftController(withProject({
    getHostCapabilities: () => ({ serverTools: {}, message: { text: {} } }),
    getHostContext: () => hostContext,
    async callServerTool() { return payloadResult("task", { apiVersion: 1, analysisId: "private-analysis" }); },
    async sendMessage(message: unknown) { messages.push(message); return {}; },
  }) as never);
  controller.hostChanged();
  await controller.loadProject();
  controller.accept({ content: [], structuredContent: cpuAnalysis });
  await controller.openExplore("task-0");
  controller.setPicking(true);
  controller.toggleSelectedFrame("0.1");
  await controller.investigateSelected();
  assert.deepEqual(messages, []);
  assert.match(controller.getSnapshot().error, /call tree is not loaded/);
  controller.dispose();
});

/** One recording with two commits, so a pick can outlive the commit picker. */
const reactExplorePayload = {
  apiVersion: 1,
  analysisId: "private-analysis",
  explore: {
    budgetMs: 16, spanMs: 300, commitsOverBudget: 2,
    commits: [
      {
        rootId: 1, commitIndex: 2, startMs: 10, durationMs: 30, renderedCount: 3,
        summedSelfMs: 28, unattributedMs: 2, overBudget: true, causesRecorded: true, treeDropped: false,
        tree: [{
          id: 2, name: "Screen", componentClass: "app", selfMs: 3, actualMs: 28, cause: "state",
          changedProps: [], changedHooks: [], compiledWithForget: false, sourceHint: "src/screen.tsx:4",
          children: [{
            id: 4, name: "Chart", componentClass: "app", selfMs: 25, actualMs: 25, cause: "props",
            changedProps: ["data"], changedHooks: [], compiledWithForget: false, sourceHint: "src/chart.tsx:9",
            children: [],
          }],
        }],
      },
      {
        rootId: 1, commitIndex: 3, startMs: 60, durationMs: 18, renderedCount: 1,
        summedSelfMs: 18, unattributedMs: 0, overBudget: true, causesRecorded: true, treeDropped: false,
        tree: [{
          id: 4, name: "Chart", componentClass: "app", selfMs: 18, actualMs: 18, cause: "nothing-changed",
          changedProps: [], changedHooks: [], compiledWithForget: false, sourceHint: "src/chart.tsx:9",
          children: [],
        }],
      },
    ],
  },
  cards: [],
};

async function exploringReact(messages: unknown[]) {
  const controller = new TraceSiftController(withProject({
    getHostCapabilities: () => ({ serverTools: {}, message: { text: {} } }),
    getHostContext: () => hostContext,
    async callServerTool() { return payloadResult("react", reactExplorePayload); },
    async sendMessage(message: unknown) { messages.push(message); return {}; },
  }) as never);
  controller.hostChanged();
  await controller.loadProject();
  controller.accept({ content: [], structuredContent: analysis });
  await controller.openExplore("react-commit-1-2");
  return controller;
}

test("TraceSift keeps React picks while the reader walks the commits", async () => {
  const messages: unknown[] = [];
  const controller = await exploringReact(messages);
  assert.equal(controller.getSnapshot().explorer?.kind, "react");
  assert.equal(controller.getSnapshot().explorer?.commitKey, "1.2");
  // Low-cardinality kind taken from the analysis, not device or profile contents.
  assert.equal(getUiTelemetryAttributes().tracesift_profile, "react");

  controller.setPicking(true);
  controller.toggleSelectedFrame("1.2.4");
  // Stepping commits is navigation; the earlier pick is why the message names its commit.
  controller.setExploreCommit("1.3");
  controller.toggleSelectedFrame("1.3.4");
  assert.deepEqual(controller.getSnapshot().explorer?.selected, ["1.2.4", "1.3.4"]);
  assert.equal(controller.getSnapshot().explorer?.commitKey, "1.3");
  controller.dispose();
});

test("TraceSift sends the selected components' measured evidence to the active chat", async () => {
  const messages: unknown[] = [];
  const controller = await exploringReact(messages);
  controller.setPicking(true);
  controller.toggleSelectedFrame("1.2.4");
  controller.toggleSelectedFrame("1.3.4");
  await controller.investigateSelected();

  assert.equal(messages.length, 1);
  const text = (messages[0] as { content: Array<{ text: string }> }).content[0]!.text;
  assert.match(text, /investigate 2 component renders I selected/);
  assert.match(text, /### Commit 2 — 30 ms rendering/);
  assert.match(text, /### Commit 3 — 18 ms rendering/);
  assert.match(text, /25 ms of its own render time \(83\.3% of this commit\)/);
  assert.match(text, /Why it rendered: props changed: data\./);
  // The same component in two commits is not merged.
  assert.match(text, /`Chart` is selections 1, 2: the same component rendering in 2 separate commits/);
  assert.match(text, /Location: `Screen` › `Chart`\./);
  assert.match(text, /Treat each selection and render reason as a lead, not proof/);
  assert.doesNotMatch(text, /Heavy component|Where those components sit/);
  assert.equal((messages[0] as { _meta: unknown })._meta, undefined);
  assert.equal(controller.getSnapshot().error, "");
  controller.dispose();
});

test("TraceSift reports React picks it cannot place rather than sending an empty ask", async () => {
  const messages: unknown[] = [];
  const controller = await exploringReact(messages);
  controller.setPicking(true);
  // A commit this recording does not hold: the payload stopped matching the view.
  controller.toggleSelectedFrame("1.99.4");
  await controller.investigateSelected();
  assert.deepEqual(messages, []);
  assert.match(controller.getSnapshot().error, /None of the selected components are in this recording's commits/);

  controller.clearSelectedFrames();
  await controller.investigateSelected();
  assert.deepEqual(messages, []);
  assert.match(controller.getSnapshot().error, /Nothing is selected yet. Turn on Select components/);
  controller.dispose();
});

test("TraceSift shows findings only, with no tool calls, where the host does not let cards call tools", async () => {
  const calls: unknown[] = [];
  // Claude Code renders cards but advertises neither server tools nor messages.
  const app = {
    getHostCapabilities: () => ({}),
    getHostContext: () => hostContext,
    async callServerTool(input: unknown) { calls.push(input); throw new Error("must not call"); },
  };
  const controller = new TraceSiftController(app as never);
  controller.hostChanged();
  await controller.loadProject();
  controller.accept({ content: [], structuredContent: analysis });
  await controller.restore("view-1");
  await controller.openExplore("react-commit-1-2");
  const state = controller.getSnapshot();
  assert.equal(state.canCallTools, false);
  assert.equal(state.analysis?.cards.length, 1);
  assert.equal(state.error, "");
  assert.match(state.notice, /does not let the card open Explore/);
  assert.deepEqual(calls, []);
  controller.dispose();
});
