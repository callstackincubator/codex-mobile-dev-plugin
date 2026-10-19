import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { AppFlowNode } from "../src/shared/app-flow.ts";
import type { AppFlowPanel } from "../src/ui/app-flow-panel.ts";

function node(id: string, capture: Record<string, unknown> | null): AppFlowNode {
  return { id, urlPath: `/${id.toLowerCase()}`, reach: "navigation-only", groups: [], group: "root", navigator: null, origin: "source", capture } as unknown as AppFlowNode;
}

/** Only what `AppFlowGraph` and `ScreenNode` touch: screenshots and the recording store. */
function panelFixture() {
  const requested: string[] = [];
  const idle = { nodeId: null, status: null, steps: [] };
  const panel = {
    recording: { subscribe: () => () => {}, getSnapshot: () => idle, start: async () => {}, stop: async () => {} },
    async screenshot(_projectId: string, path: string) { requested.push(path); return `data:image/png;base64,${Buffer.from(path).toString("base64")}`; },
    async replay() {},
  };
  return { panel: panel as unknown as AppFlowPanel, requested };
}

test("captured UI states appear on their own screen's node, and a screen without them is untouched", async t => {
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: "http://localhost" });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const globals = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement, HTMLButtonElement: dom.window.HTMLButtonElement,
    Node: dom.window.Node, Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, NodeFilter: dom.window.NodeFilter,
    Element: dom.window.Element, SVGElement: dom.window.SVGElement, DocumentFragment: dom.window.DocumentFragment, MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} }, DOMMatrixReadOnly: class { m22 = 1; constructor() {} },
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const [key, value] of Object.entries(globals)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  Object.defineProperty(dom.window, "ResizeObserver", { value: globals.ResizeObserver, configurable: true });
  Object.defineProperty(dom.window, "DOMMatrixReadOnly", { value: globals.DOMMatrixReadOnly, configurable: true });
  const directory = await mkdtemp(resolve("node_modules/.mobile-dev-app-flow-graph-test-"));
  let cleanup = async () => {};
  t.after(async () => {
    await cleanup(); dom.window.close();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
    await rm(directory, { recursive: true, force: true });
  });
  const output = resolve(directory, "app-flow-graph.mjs");
  await build({ stdin: { contents: 'export { AppFlowGraph } from "./src/ui/components/app-flow-graph.tsx";', resolveDir: process.cwd(), loader: "ts" }, outfile: output, bundle: true, format: "esm", platform: "node", jsx: "automatic",
    external: ["react", "react/*", "react-dom", "react-dom/*", "radix-ui", "lucide-react", "@base-ui/react/*", "@xyflow/react"] });
  const { AppFlowGraph } = await import(pathToFileURL(output).href);
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { ReactFlowProvider } = await import("@xyflow/react");

  const { panel, requested } = panelFixture();
  const nodes = [
    node("Home", { status: "ok", screenshot: "screens/home.png", states: [
      { name: "filter-sheet", screenshot: "screens/home-filter-sheet.png", pathCommands: ["agent-device tap 'Filter'"] },
      { name: "sort-modal", screenshot: "screens/home-sort-modal.png" },
      { name: "never-rendered", screenshot: null },
    ] }),
    node("Settings", { status: "ok", screenshot: "screens/settings.png", states: [] }),
  ];
  const root = createRoot(dom.window.document.getElementById("root")!);
  cleanup = async () => { await act(async () => { root.unmount(); }); };
  await act(async () => {
    root.render(createElement(ReactFlowProvider, null,
      createElement(AppFlowGraph, { nodes, edges: [], entryScreenIds: ["Home"], projectPath: "/projects/demo", projectId: "project-1", panel })));
  });

  // The node with states advertises only the variants that have a screenshot, collapsed by default.
  const toggle = dom.window.document.querySelector('[aria-label="Show 2 captured UI states of Home"]') as HTMLButtonElement;
  assert.ok(toggle, "a screen with captured states offers a labelled, keyboard-reachable toggle");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(dom.window.document.querySelector('[aria-label^="Show the filter-sheet state"]'), null, "the strip stays collapsed until asked for");
  // A screen whose state pass found nothing renders exactly as it did before: no badge, no strip.
  assert.equal(dom.window.document.querySelectorAll('[data-element="app-flow-states"]').length, 1);
  const settingsNode = [...dom.window.document.querySelectorAll(".react-flow__node-screen")].find(element => element.textContent?.includes("Settings"));
  assert.ok(settingsNode && !settingsNode.querySelector('[data-element="app-flow-states"]'));

  await act(async () => { toggle.click(); });
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  const sheet = dom.window.document.querySelector('[aria-label="Show the filter-sheet state of Home"]') as HTMLButtonElement;
  const base = dom.window.document.querySelector('[aria-label="Show the base screen of Home"]') as HTMLButtonElement;
  assert.ok(sheet && base);
  assert.ok(dom.window.document.querySelector('[aria-label="Show the sort-modal state of Home"]'));
  assert.equal(dom.window.document.querySelector('[aria-label^="Show the never-rendered"]'), null, "a variant with no screenshot is not offered");
  assert.ok(requested.includes("screens/home-filter-sheet.png"), "state thumbnails resolve through the same panel screenshot path as base captures");

  // Opening a state swaps the node's own screenshot; it never becomes a second node.
  assert.equal(sheet.getAttribute("aria-pressed"), "false");
  await act(async () => { sheet.click(); });
  assert.equal(sheet.getAttribute("aria-pressed"), "true");
  assert.equal(base.getAttribute("aria-pressed"), "false");
  assert.match(dom.window.document.querySelector('[data-element="app-flow-state-shown"]')?.textContent ?? "", /filter-sheet/);
  assert.equal(dom.window.document.querySelectorAll(".react-flow__node-screen").length, 2, "state variants add no nodes to the topology");
  const main = [...dom.window.document.querySelectorAll("img")].find(image => image.getAttribute("alt") === "Home — filter-sheet");
  assert.ok(main, "the node shows the opened variant's capture");

  await act(async () => { base.click(); });
  assert.equal(base.getAttribute("aria-pressed"), "true");
  assert.equal(dom.window.document.querySelector('[data-element="app-flow-state-shown"]'), null);
  assert.ok([...dom.window.document.querySelectorAll("img")].some(image => image.getAttribute("alt") === "Home"));
});
