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

const tree = {
  id: "0", name: "(root)", frameClass: "root", totalMs: 75, selfMs: 0, invocations: 1,
  children: [{ id: "1", name: "render", location: "src/Screen.tsx:20", frameClass: "app", totalMs: 60, selfMs: 2, invocations: 2, children: [
    { id: "2", name: "formatRow", location: "src/rows.ts:8", frameClass: "app", totalMs: 44, selfMs: 44, invocations: 12, children: [] }] }],
};
const timeline = { boxes: [{ startMs: 120, durationMs: 60, kind: "app", name: "render", nodeId: "1" }], durationMs: 75, coveredMs: 60, rows: 1, kept: ["app"], omittedBoxCount: 0, omittedBoxMs: 0 };
const taskHandoff = { apiVersion: 1, analysisId: "cpu", totalMs: 180, profileTitle: "CPU", card: { ...baseTask, tree, timeline } };

test("compact TraceSift cards preserve CPU and React evidence", async t => {
  const built = await build({
    stdin: { contents: `
      import { createRoot } from "react-dom/client";
      import { flushSync } from "react-dom";
      import { TraceSiftCards } from "./packages/ui/src/components/tracesift-cards.tsx";
      import { TraceSiftController } from "./packages/ui/src/tracesift-controller.ts";
      import { startUiTelemetry, stopUiTelemetry } from "./packages/ui/src/telemetry.ts";
      export async function mount(app, result) {
        startUiTelemetry(app);
        const controller = new TraceSiftController(app); controller.hostChanged();
        // Investigate waits on the project.
        await controller.loadProject();
        controller.accept(result);
        const root = createRoot(document.getElementById("root")); flushSync(() => root.render(<TraceSiftCards controller={controller} />));
        return { controller, root, flushSync, async close() { controller.dispose(); root.unmount(); await stopUiTelemetry(); } };
      }`, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, format: "iife", globalName: "TraceSiftCardTest", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const dom = new JSDOM('<html data-view="tracesift"><head><meta name="mobile-dev-environment" content="development"><meta name="mobile-dev-user-id" content="anon_0123456789abcdef0123456789abcdef"><meta name="mobile-dev-session-id" content="run_1234567890abcdef1234567890abcdef"></head><body><div id="root"></div></body></html>', { pretendToBeVisual: true, runScripts: "outside-only", url: "https://mobile-dev.test/" });
  const window = dom.window;
  window.Math.random = () => 0;
  Object.defineProperty(window.performance, "getEntriesByType", { value: () => [] });
  Object.defineProperty(window.performance, "getEntries", { value: () => [] });
  const telemetry: string[] = [];
  window.fetch = async (_url, options) => { telemetry.push(String(options?.body ?? "")); return new Response("", { status: 200 }); };
  window.eval(built.outputFiles[0].text);
  const calls: { name: string; arguments: unknown }[] = [];
  const app = {
    getHostCapabilities: () => ({ serverTools: {}, message: { text: {} } }),
    getHostContext: () => ({ availableDisplayModes: ["inline", "fullscreen"] }),
    async requestDisplayMode({ mode }: { mode: string }) { return { mode }; },
    async callServerTool(input: { name: string; arguments: unknown }) {
      calls.push(input);
      if (input.name === "mobile_tracesift_explore_payload") {
        const text = JSON.stringify(taskHandoff);
        return { content: [{ type: "text", text }], structuredContent: { apiVersion: 1, kind: "task", encoding: "json", payloadBytes: text.length } };
      }
      if (input.name === "mobile_get_tracesift_project") return { content: [], structuredContent: { path: "/private/project" } };
      return input.name === "mobile_open_tracesift_explore"
        ? { content: [], structuredContent: { opened: true } }
        : { content: [], structuredContent: { apiVersion: 1, handoff: "PRIVATE_HANDOFF_TEXT" } };
    },
    async sendMessage() { return {}; },
  };
  const flush = (click: () => void) => mounted.flushSync(click);
  // Like flush, but waits for a click whose work is a server round trip.
  const act = async (click: () => void) => { click(); await new Promise(resolve => window.setTimeout(resolve, 0)); };
  const mounted = await window.TraceSiftCardTest.mount(app, { content: [], structuredContent: { apiVersion: 1, analysisId: "cpu", profileType: "cpu", title: "CPU", summary: { totalMs: 180, callCountIsExact: true, taskCount: 870 }, cards: [baseTask, { ...baseTask, id: "task-1", taskIndex: 1 }] } });
  t.after(() => window.close());
  // The card leads with the pathline, as the web card does; the headline skips the duration and offset the card already prints.
  assert.match(window.document.body.textContent!, /App › Screen › render/);
  assert.match(window.document.body.textContent!, /2 long tasks of 870 · 180 ms total/);

  // One band per boundary frame plus the two residuals that make the task add up, each with a legend row.
  const contribution = window.document.querySelector(".contribution")!;
  const bands = [...contribution.querySelectorAll(".contribution-band")];
  assert.equal(bands.length, contribution.querySelectorAll(".contribution-legend-row").length);
  assert.ok(bands.length >= 2, "the task's own frame and its residuals each take a band");
  assert.equal(bands[0].getAttribute("aria-label"), "render, 60 ms, 80%");
  assert.match(window.document.querySelector(".contribution-detail")!.textContent!, /render/);
  const detailLayers = [...contribution.querySelectorAll(".contribution-detail-layer")];
  assert.equal(detailLayers.length, bands.length, "every slice reserves its detail height");
  assert.equal(contribution.querySelectorAll(".contribution-detail-layer.is-active").length, 1);
  assert.equal(detailLayers.filter(layer => layer.getAttribute("aria-hidden") === "true").length, bands.length - 1);
  assert.match(window.document.body.textContent!, /what it called/);
  assert.match(window.document.body.textContent!, /buildRows/);

  // Hover only switches the visible pre-rendered layer; keeping all mounted lets the tallest hold the card's height so nothing shifts under the pointer.
  const outside = bands.at(-1)!;
  flush(() => outside.dispatchEvent(new window.FocusEvent("focusin", { bubbles: true })));
  assert.equal(contribution.querySelectorAll(".contribution-detail-layer").length, detailLayers.length);
  const activeDetail = contribution.querySelector(".contribution-detail-layer.is-active")!;
  assert.match(activeDetail.textContent!, /No frame of your own was on the stack/);
  assert.equal(activeDetail.getAttribute("aria-hidden"), null);
  assert.equal(detailLayers[0].getAttribute("aria-hidden"), "true");

  // Moving from the chart to its detail or legend keeps the last slice selected instead of flashing the default detail.
  flush(() => contribution.querySelector(".contribution-bar")!.dispatchEvent(new window.MouseEvent("mouseout", {
    bubbles: true,
    relatedTarget: activeDetail,
  })));
  assert.match(contribution.querySelector(".contribution-detail-layer.is-active")!.textContent!, /No frame of your own was on the stack/);

  // Opening a boundary frame redraws the chart by that frame's self time, with a way back.
  flush(() => (bands[0] as HTMLElement).click());
  assert.match(window.document.body.textContent!, /inside render/);
  assert.match(window.document.body.textContent!, /formatRow/);
  flush(() => window.document.querySelector<HTMLElement>(".contribution-crumb")!.click());
  assert.equal(window.document.querySelector(".contribution-crumb"), null);

  // The switch swaps the drawing for every card at once.
  const treemap = [...window.document.querySelectorAll<HTMLElement>(".chart-switch button")].find(button => button.textContent === "treemap")!;
  flush(() => treemap.click());
  assert.equal(window.document.querySelectorAll(".contribution-band").length, 0);
  assert.ok(window.document.querySelectorAll(".contribution-tile").length > 0);

  // Explore loads the full tree and replaces the card list with TraceSift's explorer.
  const exploreButton = [...window.document.querySelectorAll<HTMLElement>("button")].find(button => button.textContent?.includes("Explore"))!;
  await act(() => exploreButton.click());
  // The bundle adds telemetry `_meta` to every call; only name and arguments are ours to assert.
  assert.equal(calls.at(-1)!.name, "mobile_tracesift_explore_payload");
  // Built in the JSDOM realm, so spread it; a strict compare fails on prototypes.
  assert.deepEqual({ ...calls.at(-1)!.arguments as object }, { analysisId: "cpu", taskIndex: 0 });
  assert.equal(window.document.querySelector(".hotspot-list"), null);
  assert.match(window.document.querySelector(".tracesift-explorer")!.textContent!, /Render blocked the main thread/);
  // The web app's page wrapper insets the view and scopes its theme tokens; mounting the views bare or renaming the class draws an unpadded grey Explore.
  assert.ok(window.document.querySelector(".tracesift-explorer > .explore-page"), "the explorer renders the Explore page");
  assert.ok([...window.document.querySelectorAll<HTMLElement>("button")].some(button => button.textContent?.includes("Open in browser")));

  // Picking: a click in one view shows in the others, and a second click undoes it.
  const pickToggle = [...window.document.querySelectorAll<HTMLElement>("button")].find(button => button.textContent?.includes("Select frames"))!;
  flush(() => pickToggle.click());
  assert.match(window.document.body.textContent!, /Click a frame in the timeline, flame graph, call tree or culprits/);

  const timelineBox = window.document.querySelector<HTMLElement>(".timeline-box")!;
  assert.ok(timelineBox, "the timeline draws the task's one call");
  flush(() => timelineBox.click());
  assert.ok(timelineBox.classList.contains("is-picked"), "the clicked box is ringed");
  assert.match(timelineBox.textContent!, /1/);
  // While picking, a click picks rather than re-rooting the view. Joined because the array comes from the JSDOM realm.
  assert.equal(mounted.controller.getSnapshot().explorer?.selected.join(","), "1");

  flush(() => [...window.document.querySelectorAll<HTMLElement>(".explore-tabs button")].find(tab => tab.textContent === "Culprits")!.click());
  const culpritRow = window.document.querySelector("tr.is-picked")!;
  assert.ok(culpritRow, "the picked frame is ringed in the culprit table too");
  assert.match(culpritRow.textContent!, /render/);
  assert.match(culpritRow.textContent!, /1/);

  // The frame sits under the tree's synthetic root, so the row above must be open.
  flush(() => [...window.document.querySelectorAll<HTMLElement>(".explore-tabs button")].find(tab => tab.textContent === "Call tree")!.click());
  const treeRow = window.document.querySelector(".explore-tree-row.is-picked")!;
  assert.ok(treeRow, "the picked frame is ringed in the call tree too");
  assert.match(treeRow.textContent!, /render/);

  // Flame graph boxes take a node id from the same tree; while picking, a click adds the frame instead of zooming.
  flush(() => [...window.document.querySelectorAll<HTMLElement>(".explore-tabs button")].find(tab => tab.textContent === "Flame graph")!.click());
  const pickedFrame = window.document.querySelector('[data-slot="flame-graph-frame"].ring-2.ring-ring')!;
  assert.ok(pickedFrame, "the picked frame is ringed in the flame graph too");
  assert.match(pickedFrame.getAttribute("title")!, /render/);
  // Numbered because a graph box has no row order.
  assert.equal(pickedFrame.querySelector("span[aria-hidden=\"true\"]")?.textContent, "1");
  assert.match(window.document.querySelector(".chart-notes")!.textContent!, /add it to your selection/);

  // The tree row is re-queried because the tab switch unmounted the earlier one.
  flush(() => [...window.document.querySelectorAll<HTMLElement>(".explore-tabs button")].find(tab => tab.textContent === "Call tree")!.click());
  flush(() => window.document.querySelector<HTMLElement>(".explore-tree-row.is-picked .explore-tree-focus")!.click());
  assert.equal(mounted.controller.getSnapshot().explorer?.selected.length, 0);
  assert.equal(window.document.querySelector(".explore-tree-row.is-picked"), null);
  flush(() => [...window.document.querySelectorAll<HTMLElement>(".explore-tabs button")].find(tab => tab.textContent === "Flame graph")!.click());
  assert.equal(window.document.querySelector('[data-slot="flame-graph-frame"].ring-ring'), null);
  flush(() => [...window.document.querySelectorAll<HTMLElement>(".explore-tabs button")].find(tab => tab.textContent === "Culprits")!.click());
  assert.equal(window.document.querySelector("tr.is-picked"), null);

  const investigateSelected = [...window.document.querySelectorAll<HTMLElement>("button")].find(button => button.textContent?.includes("Investigate"))!;
  assert.equal(investigateSelected.disabled, true);
  assert.match(investigateSelected.textContent!, /Investigate selected frames/);
  flush(() => [...window.document.querySelectorAll<HTMLElement>(".explore-tabs button")].find(tab => tab.textContent === "Timeline")!.click());
  flush(() => window.document.querySelector<HTMLElement>(".timeline-box")!.click());
  assert.equal(investigateSelected.disabled, false);
  assert.match(investigateSelected.textContent!, /Investigate 1 frame/);

  // Leaving the explorer drops the half-built selection.
  await act(() => [...window.document.querySelectorAll<HTMLElement>("button")].find(button => button.textContent === "Findings")!.click());
  assert.ok(window.document.querySelector(".hotspot-list"));
  assert.equal(mounted.controller.getSnapshot().explorer, undefined);

  mounted.controller.accept({ content: [], structuredContent: { apiVersion: 1, analysisId: "react", profileType: "react", title: "React", summary: { rootCount: 1, commitCount: 3, totalCommitRenderDurationMs: 50, peakCommitDurationMs: 40, commitsOverBudget: 1, omittedEvidenceCommitCount: 0 }, cards: [baseReact] } });
  await new Promise(resolve => window.setTimeout(resolve, 0));
  flush(() => [...window.document.querySelectorAll<HTMLElement>(".chart-switch button")].find(button => button.textContent === "bar")!.click());
  // React commits use the web card's headline; the commit divides into component self time plus the reconciler residual.
  assert.match(window.document.body.textContent!, /List spent 30 ms rendering/);
  assert.match(window.document.querySelector(".contribution-lede")!.textContent!, /How the 40 ms divides between the components that rendered/);
  assert.equal(window.document.querySelectorAll(".contribution-band").length, 2);
  assert.match(window.document.querySelector(".contribution-detail")!.textContent!, /List75% of commit30 msviaAppfilesrc\/List.tsxprops changed · props items/);
  assert.match(window.document.body.textContent!, /React itself, no component/);
  assert.equal([...window.document.querySelectorAll("button")].some(button => button.textContent?.includes("Explore")), true);
  await mounted.controller.investigate("react-1");
  await mounted.close();
  const encoded = telemetry.join("\n");
  for (const fragment of ["ui.tracesift.process.mean", "ui.tracesift.handoff.mean", "ui.tracesift.message_ack.mean", "ui.tracesift.investigate", "ui.tracesift.cards", "ui.tracesift.payload.mean", "ui.tracesift.explore", "ui.tracesift.pick_on", "ui.tracesift.frame_add", "ui.tracesift.frame_remove", "ui.tracesift.selected_frames", '"tracesift_view":{"value":"explorer"', '"surface":{"value":"tracesift"', '"view":{"value":"tracesift"']) assert.ok(encoded.includes(fragment), `Missing telemetry: ${fragment}`);
  for (const fragment of ["src/Screen.tsx", "List used 30 ms", "private-analysis", "react-1", "PRIVATE_HANDOFF_TEXT"]) assert.equal(encoded.includes(fragment), false, `Private TraceSift data reached telemetry: ${fragment}`);
});
