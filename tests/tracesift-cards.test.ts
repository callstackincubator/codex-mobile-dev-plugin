import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const baseTask = {
  id: "task-0", taskIndex: 0, startMs: 120, durationMs: 75, boundaries: "tasks", headline: "Render blocked the main thread",
  pathline: "App › Screen › render", shapeline: "Most time stayed in one app boundary", percentOfProfile: 42,
  boundaryFrames: [{ name: "render", location: "src/Screen.tsx:20", nodeId: "b1", totalMs: 60, selfMs: 2, invocations: 2,
    longestCallMs: 40, shapeText: "ran 2 times in this task · 60 ms total · longest single call 40 ms",
    culprits: [{ name: "formatRow", frameClass: "app", nodeId: "c1", totalMs: 44, selfMs: 44, invocations: 12,
      longestCallMs: 9, shapeText: "ran 12 times · 44 ms total", callers: ["render"] }],
    inside: [{ name: "buildRows", frameClass: "app", nodeId: "i1", totalMs: 48, selfMs: 1, invocations: 2,
      longestCallMs: 30, shapeText: "ran 2 times · 48 ms total" }] }], boundaryTailCount: 0, boundaryTailMs: 0, outsideBoundariesMs: 5,
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
        return { controller, root, flushSync, async close() { controller.dispose(); root.unmount(); await stopUiTelemetry(); } };
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
  const calls: { name: string; arguments: unknown }[] = [];
  const displayModes: string[] = [];
  const exploreTask = {
    apiVersion: 1, analysisId: "cpu", totalMs: 180, title: "CPU",
    card: { ...baseTask, tree: { id: "b1", name: "render", frameClass: "app", totalMs: 60, selfMs: 2, invocations: 2, children: [] },
      timeline: { boxes: [], durationMs: 75, coveredMs: 60, rows: 1, kept: ["app"], omittedBoxCount: 0, omittedBoxMs: 0 } },
  };
  const app = {
    getHostCapabilities: () => ({ serverTools: {}, message: { text: {} } }),
    async callServerTool(input: { name: string; arguments: unknown }) {
      calls.push(input);
      return input.name === "mobile_get_tracesift_task"
        ? { content: [], structuredContent: exploreTask }
        : { content: [], structuredContent: { apiVersion: 1, handoff: "PRIVATE_HANDOFF_TEXT" } };
    },
    async requestDisplayMode({ mode }: { mode: string }) { displayModes.push(mode); return { mode }; },
    async sendMessage() { return {}; },
  };
  /** A click React has finished re-rendering after. */
  const flush = (click: () => void) => mounted.flushSync(click);
  /** The same, for a click whose work is a server round trip. */
  const act = async (click: () => void) => { click(); await new Promise(resolve => window.setTimeout(resolve, 0)); };
  const mounted = window.TraceSiftCardTest.mount(app, { content: [], structuredContent: { apiVersion: 1, analysisId: "cpu", profileType: "cpu", title: "CPU", summary: { totalMs: 180, callCountIsExact: true, taskCount: 870 }, cards: [baseTask] } });
  t.after(() => window.close());
  // The card leads with the pathline, as the web card does: the headline
  // spends its words on a duration and an offset the card already prints.
  assert.match(window.document.body.textContent!, /App › Screen › render/);
  assert.match(window.document.body.textContent!, /1 long task of 870 · 180 ms total/);

  // The contribution chart is the card: one band per boundary frame, plus the
  // two residuals that make the task add up, and a legend row for each.
  const bands = [...window.document.querySelectorAll(".contribution-band")];
  assert.equal(bands.length, window.document.querySelectorAll(".contribution-legend-row").length);
  assert.ok(bands.length >= 2, "the task's own frame and its residuals each take a band");
  assert.equal(bands[0].getAttribute("aria-label"), "render, 60 ms, 80%");
  // The heaviest slice is detailed before anyone has touched the chart.
  assert.match(window.document.querySelector(".contribution-detail")!.textContent!, /render/);
  assert.match(window.document.body.textContent!, /what it called/);
  assert.match(window.document.body.textContent!, /buildRows/);

  // Hovering a band moves the detail panel to it without opening anything.
  const outside = bands.at(-1)!;
  flush(() => outside.dispatchEvent(new window.MouseEvent("mouseover", { bubbles: true })));

  // Opening a boundary frame redraws the chart as that frame's own time, by
  // self time, and offers a way back to the whole task.
  flush(() => (bands[0] as HTMLElement).click());
  assert.match(window.document.body.textContent!, /inside render/);
  assert.match(window.document.body.textContent!, /formatRow/);
  flush(() => window.document.querySelector<HTMLElement>(".contribution-crumb")!.click());
  assert.equal(window.document.querySelector(".contribution-crumb"), null);

  // The switch swaps the drawing for every card at once, as on the web.
  const treemap = [...window.document.querySelectorAll<HTMLElement>(".chart-switch button")].find(button => button.textContent === "treemap")!;
  flush(() => treemap.click());
  assert.equal(window.document.querySelectorAll(".contribution-band").length, 0);
  assert.ok(window.document.querySelectorAll(".contribution-tile").length > 0);

  // Explore asks the server for the task the analysis response left out, and
  // shows it over the cards rather than in a tab the chat cannot reach.
  const exploreButton = [...window.document.querySelectorAll<HTMLElement>("button")].find(button => button.textContent?.includes("Explore"))!;
  await act(() => exploreButton.click());
  // Only the name and the arguments are ours; the bundle adds a telemetry
  // `_meta` to every tool call, and asserting on it would test Sentry.
  assert.equal(calls.at(-1)!.name, "mobile_get_tracesift_task");
  // The call is built inside the JSDOM realm, so its object does not share
  // a prototype with this one and a strict structural compare cannot pass.
  assert.deepEqual({ ...calls.at(-1)!.arguments as object }, { analysisId: "cpu", taskIndex: 0 });
  assert.equal(displayModes.at(-1), "fullscreen");
  assert.equal(window.document.querySelector(".hotspot-list"), null);
  // Explore is a screen in this view, not a tab the chat cannot reach: the
  // task's own heading, and the four readings of it, are on the page.
  assert.match(window.document.body.textContent!, /App › Screen › render/);
  for (const tab of ["Timeline", "Flame graph", "Call tree", "Culprits"]) {
    assert.match(window.document.body.textContent!, new RegExp(tab), `Explore is missing its ${tab} view`);
  }
  await act(() => [...window.document.querySelectorAll<HTMLElement>("button")].find(button => button.textContent?.includes("Back"))!.click());
  assert.ok(window.document.querySelector(".hotspot-list"));

  mounted.controller.accept({ content: [], structuredContent: { apiVersion: 1, analysisId: "react", profileType: "react", title: "React", summary: { rootCount: 1, commitCount: 3, totalCommitRenderDurationMs: 50, peakCommitDurationMs: 40, commitsOverBudget: 1, omittedEvidenceCommitCount: 0 }, cards: [baseReact] } });
  await new Promise(resolve => window.setTimeout(resolve, 0));
  // A commit takes the same chrome and leads with its pathline too; it has no
  // boundary frames to divide, so it keeps its measured culprit rows and the
  // evidence sentence rides along as the row's tooltip.
  assert.match(window.document.body.textContent!, /App › List/);
  assert.match(window.document.body.textContent!, /measured culpritsList30 ms/);
  assert.equal(window.document.querySelector(".contribution-nested-row")!.getAttribute("title"), "List used 30 ms self time.");
  // A commit has no call tree to open, so it is offered no Explore.
  assert.equal([...window.document.querySelectorAll("button")].some(button => button.textContent?.includes("Explore")), false);
  await mounted.controller.investigate("react-1");
  await mounted.close();
  const encoded = telemetry.join("\n");
  for (const fragment of ["ui.tracesift.process.mean", "ui.tracesift.handoff.mean", "ui.tracesift.message_ack.mean", "ui.tracesift.investigate", "ui.tracesift.cards", '"surface":{"value":"tracesift"', '"view":{"value":"tracesift"']) assert.ok(encoded.includes(fragment), `Missing telemetry: ${fragment}`);
  for (const fragment of ["src/Screen.tsx", "List used 30 ms", "private-analysis", "react-1", "PRIVATE_HANDOFF_TEXT"]) assert.equal(encoded.includes(fragment), false, `Private TraceSift data reached telemetry: ${fragment}`);
});
