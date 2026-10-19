import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

test("the sweep row offers a per-project Capture UI states switch instead of a separate UI Explore run", async t => {
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: "http://localhost" });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const globals = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLFormElement: dom.window.HTMLFormElement, HTMLButtonElement: dom.window.HTMLButtonElement, HTMLInputElement: dom.window.HTMLInputElement, Node: dom.window.Node,
    Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, NodeFilter: dom.window.NodeFilter,
    Element: dom.window.Element, DocumentFragment: dom.window.DocumentFragment, MutationObserver: dom.window.MutationObserver,
    localStorage: dom.window.localStorage, getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} }, IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const [key, value] of Object.entries(globals)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  const directory = await mkdtemp(resolve("node_modules/.mobile-dev-ui-explore-test-"));
  let cleanup = async () => {};
  t.after(async () => { await cleanup(); dom.window.close(); for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } await rm(directory, { recursive: true, force: true }); });
  const output = resolve(directory, "app-flow-view.mjs");
  await build({
    stdin: { contents: 'export { AppFlowView, progressTally } from "./src/ui/components/app-flow-view.tsx";', resolveDir: process.cwd(), loader: "ts" },
    outfile: output, bundle: true, format: "esm", platform: "node", jsx: "automatic",
    external: ["react", "react/*", "react-dom", "react-dom/*", "radix-ui", "lucide-react", "@base-ui/react/*", "@xyflow/react"],
  });
  const { AppFlowView, progressTally } = await import(pathToFileURL(output).href);
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");

  // A run with no route queue (the standalone MCP tool) reports no route queue, so the counter must not read "0 / 0 screens".
  assert.equal(progressTally({ completed: 0, total: 0, message: "Presenting", captured: 3, captureLimit: 10 }), "3 / 10 captured");
  assert.equal(progressTally({ completed: 0, total: 0, message: "Presenting" }), "");
  assert.equal(progressTally({ completed: 2, total: 8, message: "Home" }), "2 / 8 screens");

  const listeners = new Set<() => void>();
  let snapshot: Record<string, unknown> = {
    open: true, available: true, projectPath: "/projects/demo", projects: [], runId: null, projectId: "",
    state: "idle", result: null, progress: null, sweepSummary: null, prompt: null, error: null,
    launching: false, agentStartPending: false, pickingProject: false, appLaunched: false,
  };
  const starts: unknown[] = [];
  const panel = {
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
    canSendAgentStart: true,
    recording: { subscribe: () => () => {}, getSnapshot: () => ({ nodeId: null, status: null, steps: [] }) },
    refreshProjects: async () => {}, chooseProject: async () => {}, pickProject: async () => {},
    launchApp: async () => {},
    start: async () => {}, requestAgentStart: async (options: unknown) => { starts.push(options); },
  };
  const document = dom.window.document;
  const storage = dom.window.localStorage;
  const key = "app-flow-capture-ui-states:/projects/demo";
  const root = createRoot(document.getElementById("root")!);
  cleanup = async () => { await act(async () => { root.unmount(); }); };
  const labelled = (name: string) => document.querySelector(`[aria-label="${name}"]`) as HTMLElement | null;
  const startButton = () => Array.from(document.querySelectorAll("button")).find(entry => entry.textContent === "Start") as HTMLButtonElement;

  // The removed controls are gone from every mode.
  await act(async () => { root.render(createElement(AppFlowView, { panel })); });
  assert.equal(Array.from(document.querySelectorAll("button")).some(entry => /UI Explore/.test(entry.textContent ?? "")), false, "no Start UI Explore button");
  assert.equal(labelled("Maximum UI states to capture"), null, "no per-run UI state limit input");
  // The switch belongs to the screen sweep's options, so structure-only has none.
  assert.equal(labelled("Capture UI states"), null);

  // Screen sweep mode shows the switch, off by default, and an unset key stays unset.
  await act(async () => { root.unmount(); });
  storage.setItem("app-flow-mode:/projects/demo", "screen-ui-and-structure");
  const second = createRoot(document.getElementById("root")!);
  cleanup = async () => { await act(async () => { second.unmount(); }); };
  await act(async () => { second.render(createElement(AppFlowView, { panel })); });
  const toggle = () => labelled("Capture UI states") as HTMLButtonElement;
  assert.ok(toggle(), "the switch is offered beside the sweep options");
  assert.equal(toggle().getAttribute("role"), "switch");
  assert.equal(toggle().getAttribute("aria-checked"), "false", "default off");
  assert.equal(storage.getItem(key), null);

  // Off is sent as an explicit false on the one start request the sweep already makes.
  await act(async () => { startButton().click(); });
  assert.equal((starts.at(-1) as { captureUiStates?: boolean }).captureUiStates, false);

  // Turning it on persists per project and rides the same start request.
  await act(async () => { toggle().click(); });
  assert.equal(toggle().getAttribute("aria-checked"), "true");
  assert.equal(storage.getItem(key), "on");
  await act(async () => { startButton().click(); });
  assert.deepEqual(starts.at(-1), { mode: "screen-ui-and-structure", screenLimit: undefined, explorationMode: "auto", deepLinkJudgeMode: "on", captureUiStates: true });

  // A fresh mount of the same project restores it; another project does not inherit it.
  await act(async () => { second.unmount(); });
  const third = createRoot(document.getElementById("root")!);
  cleanup = async () => { await act(async () => { third.unmount(); }); };
  await act(async () => { third.render(createElement(AppFlowView, { panel })); });
  assert.equal(toggle().getAttribute("aria-checked"), "true", "restored from localStorage");
  snapshot = { ...snapshot, projectPath: "/projects/other" };
  storage.setItem("app-flow-mode:/projects/other", "screen-ui-and-structure");
  await act(async () => { for (const listener of listeners) listener(); });
  assert.equal(toggle().getAttribute("aria-checked"), "false", "the switch is per project");

  // The sweep's start options are not inflated by the old standalone limit's key.
  assert.equal(storage.getItem("app-flow-ui-explore-limit:/projects/demo"), null);
});
