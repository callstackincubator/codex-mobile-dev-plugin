import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

test("UI Explore waits for a launched app, then sends the persisted capture limit", async t => {
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: "http://localhost" });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const globals = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement, Node: dom.window.Node,
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
    stdin: { contents: 'export { AppFlowView, progressTally, uiExploreBlockedReason, uiStateLimitOf } from "./src/ui/components/app-flow-view.tsx";', resolveDir: process.cwd(), loader: "ts" },
    outfile: output, bundle: true, format: "esm", platform: "node", jsx: "automatic",
    external: ["react", "react/*", "react-dom", "react-dom/*", "radix-ui", "lucide-react", "@base-ui/react/*", "@xyflow/react"],
  });
  const { AppFlowView, progressTally, uiExploreBlockedReason, uiStateLimitOf } = await import(pathToFileURL(output).href);
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");

  // The disable predicate, stated on its own: the only launch signal the panel has is a successful
  // Launch App, and a captured-screen count is deliberately not part of it.
  const launched = { projectPath: "/projects/demo", launching: false, appLaunched: true, agentStartPending: false };
  assert.equal(uiExploreBlockedReason(launched, false), "");
  assert.match(uiExploreBlockedReason({ ...launched, appLaunched: false }, false), /Launch the app first/);
  assert.match(uiExploreBlockedReason({ ...launched, launching: true }, false), /still launching/);
  assert.match(uiExploreBlockedReason({ ...launched, projectPath: "" }, false), /Choose a project/);
  assert.match(uiExploreBlockedReason({ ...launched, agentStartPending: true }, false), /still pending/);
  assert.match(uiExploreBlockedReason(launched, true), /already in progress/);
  assert.equal(uiStateLimitOf("10"), 10);
  assert.equal(uiStateLimitOf("0"), undefined);
  assert.equal(uiStateLimitOf("1001"), undefined);
  assert.equal(uiStateLimitOf(""), undefined);
  // A UI Explore run reports no route queue, so the counter must not read "0 / 0 screens".
  assert.equal(progressTally({ completed: 0, total: 0, message: "Presenting", captured: 3, captureLimit: 10 }), "3 / 10 captured");
  assert.equal(progressTally({ completed: 0, total: 0, message: "Presenting" }), "");
  assert.equal(progressTally({ completed: 2, total: 8, message: "Home" }), "2 / 8 screens");

  const listeners = new Set<() => void>();
  let snapshot: Record<string, unknown> = {
    open: true, available: true, projectPath: "/projects/demo", projects: [], runId: null, projectId: "",
    state: "idle", result: null, progress: null, sweepSummary: null, prompt: null, error: null,
    launching: false, agentStartPending: false, pickingProject: false, appLaunched: false,
  };
  const explores: unknown[] = [];
  const panel = {
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
    canSendAgentStart: true,
    recording: { subscribe: () => () => {}, getSnapshot: () => ({ nodeId: null, status: null, steps: [] }) },
    refreshProjects: async () => {}, chooseProject: async () => {}, pickProject: async () => {},
    launchApp: async () => { snapshot = { ...snapshot, appLaunched: true }; for (const listener of listeners) listener(); },
    start: async () => {}, requestAgentStart: async () => {},
    startUiExplore: async (options: unknown) => { explores.push(options); },
  };
  const root = createRoot(dom.window.document.getElementById("root")!);
  cleanup = async () => { await act(async () => { root.unmount(); }); };
  await act(async () => { root.render(createElement(AppFlowView, { panel })); });

  const button = () => Array.from(dom.window.document.querySelectorAll("button")).find(entry => entry.textContent === "Start UI Explore") as HTMLButtonElement;
  assert.equal(button().disabled, true, "nothing has launched the app yet");
  assert.match(button().getAttribute("aria-label")!, /^Start UI Explore — Launch the app first/);
  await act(async () => { button().click(); });
  assert.deepEqual(explores, [], "a disabled control starts nothing");

  const limitInput = dom.window.document.querySelector('[aria-label="Maximum UI states to capture"]') as HTMLInputElement;
  assert.equal(limitInput.value, "10", "the default capture limit");
  await act(async () => { await panel.launchApp(); });
  assert.equal(button().disabled, false);
  assert.equal(button().getAttribute("aria-label"), "Start UI Explore");
  await act(async () => { button().click(); });
  assert.deepEqual(explores, [{ limit: 10 }]);
  assert.equal(dom.window.localStorage.getItem("app-flow-ui-explore-limit:/projects/demo"), "10");
});
