import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const baseTask = {
  id: "task-0", taskIndex: 0, startMs: 120, durationMs: 75, boundaries: "tasks", headline: "Render blocked the main thread",
  pathline: "App › Screen › render", shapeline: "Most time stayed in one app boundary", percentOfProfile: 42,
  boundaryFrames: [{ name: "render" }], boundaryTailCount: 0, boundaryTailMs: 0, outsideBoundariesMs: 5,
  culprits: [{ name: "render", location: "src/Screen.tsx:20", frameClass: "app", selfMs: 50, totalMs: 60,
    invocations: 2, longestCallMs: 40, shapeText: "2 calls · 60 ms", nodeId: "1", callers: [], reachedVia: [], hotPath: [] }],
  tree: {}, timeline: {}, subtreeFunctionCount: 1, confidence: "ok",
};
const baseReact = {
  id: "react-1", rootId: 1, commitIndex: 2, startMs: 300, durationMs: 40, percentOfRender: 55,
  severity: "high", shape: "single", headline: "List spent 30 ms rendering", pathline: "App › List",
  shapeline: "75% in one component", causeline: "props changed", renderedCount: 20, summedSelfMs: 38,
  unattributedMs: 2, effectDurationMs: 0, passiveEffectDurationMs: 0, priority: "Normal", updaters: [],
  culprits: [{ componentId: "1:2", component: "List", componentClass: "app", selfMs: 30, percentOfCommit: 75,
    cause: "props", changedProps: ["items"], changedHooks: [], compiledWithForget: false, sourceHint: "src/List.tsx", path: ["App", "List"], evidence: "List used 30 ms self time." }],
  culpritTailCount: 0, culpritTailMs: 0, causes: [], wasted: null, confidence: "ok",
};

test("compact TraceSift cards preserve CPU and React evidence", async t => {
  const built = await build({
    stdin: { contents: `
      import { createRoot } from "react-dom/client";
      import { flushSync } from "react-dom";
      import { TraceSiftCards } from "./src/ui/components/tracesift-cards.tsx";
      import { TraceSiftController } from "./src/ui/tracesift-controller.ts";
      import { startUiTelemetry, stopUiTelemetry } from "./src/ui/telemetry.ts";
      export function mount(app, result) {
        startUiTelemetry(app);
        const controller = new TraceSiftController(app); controller.hostChanged(); controller.accept(result);
        const root = createRoot(document.getElementById("root")); flushSync(() => root.render(<TraceSiftCards controller={controller} />));
        return { controller, root, async close() { controller.dispose(); root.unmount(); await stopUiTelemetry(); } };
      }`, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, format: "iife", globalName: "TraceSiftCardTest", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const dom = new JSDOM('<html data-view="tracesift"><head><meta name="mobile-dev-environment" content="development"><meta name="mobile-dev-user-id" content="anon_0123456789abcdef0123456789abcdef"><meta name="mobile-dev-session-id" content="run_1234567890abcdef1234567890abcdef"></head><body><div id="root"></div></body></html>', { pretendToBeVisual: true, runScripts: "outside-only", url: "https://mobile-dev.test/" });
  const window = dom.window;
  Object.defineProperty(window.performance, "getEntriesByType", { value: () => [] });
  Object.defineProperty(window.performance, "getEntries", { value: () => [] });
  const telemetry: string[] = [];
  window.fetch = async (_url, options) => { telemetry.push(String(options?.body ?? "")); return new Response("", { status: 200 }); };
  window.eval(built.outputFiles[0].text);
  const app = { getHostCapabilities: () => ({ serverTools: {}, message: { text: {} } }), async callServerTool() { return { content: [], structuredContent: { apiVersion: 1, handoff: "PRIVATE_HANDOFF_TEXT" } }; }, async sendMessage() { return {}; } };
  const mounted = window.TraceSiftCardTest.mount(app, { content: [], structuredContent: { apiVersion: 1, analysisId: "cpu", profileType: "cpu", title: "CPU", summary: { totalMs: 180, callCountIsExact: true }, cards: [baseTask] } });
  t.after(() => window.close());
  assert.match(window.document.body.textContent!, /Render blocked the main thread/);
  assert.match(window.document.body.textContent!, /src\/Screen\.tsx:20/);
  mounted.controller.accept({ content: [], structuredContent: { apiVersion: 1, analysisId: "react", profileType: "react", title: "React", summary: { rootCount: 1, commitCount: 3, totalCommitRenderDurationMs: 50, peakCommitDurationMs: 40, commitsOverBudget: 1, omittedEvidenceCommitCount: 0 }, cards: [baseReact] } });
  await new Promise(resolve => window.setTimeout(resolve, 0));
  assert.match(window.document.body.textContent!, /List spent 30 ms rendering/);
  assert.match(window.document.body.textContent!, /List used 30 ms self time/);
  assert.equal(window.document.querySelectorAll("button").length, 1);
  await mounted.controller.investigate("react-1");
  await mounted.close();
  const encoded = telemetry.join("\n");
  for (const fragment of ["ui.tracesift.process.mean", "ui.tracesift.handoff.mean", "ui.tracesift.message_ack.mean", "ui.tracesift.investigate", "ui.tracesift.cards", '"surface":{"value":"tracesift"', '"view":{"value":"tracesift"']) assert.ok(encoded.includes(fragment), `Missing telemetry: ${fragment}`);
  for (const fragment of ["src/Screen.tsx", "List used 30 ms", "private-analysis", "react-1", "PRIVATE_HANDOFF_TEXT"]) assert.equal(encoded.includes(fragment), false, `Private TraceSift data reached telemetry: ${fragment}`);
});
