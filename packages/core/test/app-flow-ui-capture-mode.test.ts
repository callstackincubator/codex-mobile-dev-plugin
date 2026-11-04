import test from "node:test";
import assert from "node:assert/strict";
import { renderEnvironment } from "./jsdom-env.ts";

/**
 * The capture mode must outlive a remount. The workspace mounts the App Flow view conditionally
 * (`tool === "app-flow" && open`), and the view restores `mode` from localStorage on every mount,
 * so a selection held only in React state was reverted to "Structure only" by anything that
 * unmounted the view between the choice and the click — hiding the panel, switching tools. The
 * sweep then ran as a structure parse: no simulator, no captures, which reads as Start doing
 * nothing at all.
 */
test("the capture mode is persisted when it changes, not when a sweep starts", async t => {
  const { module: { AppFlowView }, dom, onTeardown } = await renderEnvironment<any>(t, {
    exports: 'export { AppFlowView } from "./packages/ui/src/components/app-flow-view.tsx";',
    slug: "ui-capture-mode", settleMs: 50,
  });
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");

  const listeners = new Set<() => void>();
  const snapshot: Record<string, unknown> = {
    open: true, available: true, projectPath: "/projects/demo", projects: [], runId: null, projectId: "demo",
    state: "idle", result: null, progress: null, sweepSummary: null, prompt: null, error: null,
    launching: false, agentStartPending: false, pickingProject: false, appLaunched: false,
  };
  const starts: unknown[] = [];
  const panel = {
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
    canSendAgentStart: true,
    recording: { subscribe: () => () => {}, getSnapshot: () => ({ nodeId: null, status: null, steps: [] }) },
    refreshProjects: async () => {}, chooseProject: async () => {}, pickProject: async () => {}, launchApp: async () => {},
    clear: async () => {}, screenshot: async () => "",
    start: async (options: unknown) => { starts.push(options); },
    requestAgentStart: async () => {},
  };
  const document = dom.window.document;
  const storage = dom.window.localStorage;
  storage.removeItem("app-flow-mode:/projects/demo");

  let root = createRoot(document.getElementById("root")!);
  onTeardown(async () => { await act(async () => { root.unmount(); }); });
  await act(async () => { root.render(createElement(AppFlowView, { panel })); });

  const button = (text: string) => Array.from(document.querySelectorAll("button"))
    .find(entry => entry.textContent === text) as HTMLButtonElement;
  const trigger = document.querySelector('[aria-label="App Flow capture mode"]') as HTMLElement;
  assert.ok(trigger, "the toolbar offers the capture mode");

  await act(async () => { trigger.click(); });
  const option = Array.from(document.querySelectorAll('[role="option"]'))
    .find(entry => entry.textContent === "Screen UI + Structure") as HTMLElement;
  assert.ok(option, "the list offers the screen sweep");
  await act(async () => { option.click(); });
  assert.equal(storage.getItem("app-flow-mode:/projects/demo"), "screen-ui-and-structure",
    "the choice is stored before anything is started");

  // What the workspace does when the panel is hidden and shown again, or another tool is picked.
  await act(async () => { root.unmount(); });
  root = createRoot(document.getElementById("root")!);
  await act(async () => { root.render(createElement(AppFlowView, { panel })); });

  await act(async () => { button("Start").click(); });
  assert.deepEqual(starts.at(-1), {
    mode: "screen-ui-and-structure", explorationMode: "adaptive", deepLinkJudgeMode: "never", captureUiStates: false,
  }, "the remount restores the chosen mode instead of falling back to a structure parse");
});
