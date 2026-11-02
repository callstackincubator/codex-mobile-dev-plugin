import test from "node:test";
import assert from "node:assert/strict";
import { renderEnvironment } from "./jsdom-env.ts";

test("App Flow uses adaptive capture and offers AI only for actionable misses", async t => {
  const { module: { AppFlowView, progressTally }, dom, onTeardown } = await renderEnvironment<any>(t, {
    exports: 'export { AppFlowView, progressTally } from "./packages/ui/src/components/app-flow-view.tsx";', slug: "ui-explore", settleMs: 50,
  });
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");

  assert.equal(progressTally({ completed: 0, total: 0, message: "Presenting", captured: 3, captureLimit: 10 }), "3 / 10 captured");
  assert.equal(progressTally({ completed: 0, total: 0, message: "Presenting" }), "");

  const listeners = new Set<() => void>();
  let snapshot: Record<string, unknown> = {
    open: true, available: true, projectPath: "/projects/demo", projects: [], runId: null, projectId: "demo",
    state: "idle", result: null, progress: null, sweepSummary: null, prompt: null, error: null,
    launching: false, agentStartPending: false, pickingProject: false, appLaunched: false,
  };
  const starts: unknown[] = [];
  const agentStarts: unknown[] = [];
  let clears = 0;
  const recordingSnapshot = { nodeId: null, status: null, steps: [] };
  const panel = {
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
    canSendAgentStart: true,
    recording: { subscribe: () => () => {}, getSnapshot: () => recordingSnapshot },
    refreshProjects: async () => {}, chooseProject: async () => {}, pickProject: async () => {}, launchApp: async () => {},
    clear: async () => { clears += 1; },
    screenshot: async () => "",
    start: async (options: unknown) => { starts.push(options); },
    requestAgentStart: async (options: unknown) => { agentStarts.push(options); },
  };
  const document = dom.window.document;
  const storage = dom.window.localStorage;
  storage.setItem("app-flow-mode:/projects/demo", "screen-ui-and-structure");
  const root = createRoot(document.getElementById("root")!);
  onTeardown(async () => { await act(async () => { root.unmount(); }); });
  await act(async () => { root.render(createElement(AppFlowView, { panel })); });

  const labelled = (name: string) => document.querySelector(`[aria-label="${name}"]`) as HTMLElement | null;
  const button = (text: string) => Array.from(document.querySelectorAll("button")).find(entry => entry.textContent === text) as HTMLButtonElement;
  const options = button("Capture options");
  assert.ok(options);
  assert.equal(labelled("App Flow exploration mode"), null, "reach strategy is no longer a user choice");
  assert.equal(labelled("Maximum screens to explore"), null, "the top-level screen count is gone");

  await act(async () => { options.click(); });
  const toggle = labelled("Capture UI states") as HTMLButtonElement;
  assert.equal(toggle.getAttribute("aria-checked"), "false");
  await act(async () => { toggle.click(); });
  assert.equal(storage.getItem("app-flow-capture-ui-states:/projects/demo"), "on");
  await act(async () => { button("Start").click(); });
  assert.deepEqual(starts.at(-1), {
    mode: "screen-ui-and-structure", explorationMode: "adaptive", deepLinkJudgeMode: "never", captureUiStates: true,
  });
  assert.equal(agentStarts.length, 0, "deterministic capture starts without a decision loop");

  snapshot = { ...snapshot, result: {
    manifest: { formatVersion: 4, durationMs: 1, sweepStatus: "completed" }, edges: [],
    nodes: [
      { id: "Home", origin: "source", capture: { status: "ok", screenshot: "home.png" } },
      { id: "Params", origin: "source", capture: { status: "missing", screenshot: null, note: "Unresolved route parameters: id" } },
      { id: "Unclear", origin: "source", capture: { status: "missing", screenshot: null, note: "Runtime could not verify arrival" } },
      { id: "Auth", origin: "source", capture: { status: "auth-wall", screenshot: null, note: "Sign in required" } },
      { id: "Gone", origin: "source", capture: { status: "unavailable", screenshot: null, note: "Not in this build" } },
    ],
  } };
  await act(async () => { for (const listener of listeners) listener(); });
  assert.match(document.body.textContent ?? "", /2 can be explored with AI/);
  assert.match(document.body.textContent ?? "", /1 need route parameters/);
  assert.match(document.body.textContent ?? "", /1 need sign-in/);
  assert.match(document.body.textContent ?? "", /1 unavailable in this build/);
  const help = labelled("How App Flow works") as HTMLButtonElement;
  assert.ok(help, "the panel offers a usage guide");
  await act(async () => { help.click(); });
  const guide = document.querySelector('[aria-label="How App Flow works"][data-slot="popover-content"]');
  const guideText = guide?.textContent ?? "";
  assert.match(guideText, /ios.+android.+script/s, "the guide names the launch scripts it needs");
  assert.match(guideText, /release build/, "the guide explains what a release build costs");
  assert.match(guideText, /deep link/, "the guide explains the deep-link fallback");
  assert.match(guideText, /Structure only.+Screen UI \+ Structure/s, "the guide explains both capture modes");

  // The AI continuation is no longer one click: it lists the eligible screens and starts only the
  // ones the user ticks, so a model walk is never spent on a screen nobody asked about.
  assert.equal(button("Explore 2 with AI"), undefined, "the one-click AI continuation is gone");
  await act(async () => { button("Explore with AI").click(); });
  const picker = document.querySelector('[aria-label="Explore screens with AI"][data-slot="popover-content"]')!;
  assert.ok(picker, "the button opens a screen picker");
  const rows = Array.from(picker.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
  assert.equal(rows.length, 2, "only the AI-eligible screens get a row");
  assert.equal(picker.textContent?.includes("Auth"), false, "an auth-walled screen is not offered");
  assert.equal(picker.textContent?.includes("Gone"), false, "a screen unavailable in this build is not offered");

  // Preview focuses a row's screen; it must not start anything or close the list.
  const preview = picker.querySelector('[aria-label="Show Params on the map"]') as HTMLButtonElement;
  assert.ok(preview, "each row offers a preview");
  await act(async () => { preview.click(); });
  assert.equal(agentStarts.length, 0, "previewing a screen starts no run");

  const exploreSelected = () => Array.from(picker.querySelectorAll("button"))
    .find(entry => /^Explore \d+ with AI$/.test(entry.textContent ?? "")) as HTMLButtonElement;
  assert.equal(exploreSelected().disabled, true, "nothing to start until a screen is picked");
  await act(async () => { rows[0]!.click(); });
  const start = exploreSelected();
  assert.equal(start.textContent, "Explore 1 with AI", "the button counts what was ticked");
  await act(async () => { start.click(); });
  assert.deepEqual(agentStarts.at(-1), {
    mode: "screen-ui-and-structure", explorationMode: "ai", deepLinkJudgeMode: "off", captureUiStates: false,
    screenIds: ["Params"],
  });

  // Let the picker's popover finish unmounting; the confirm popover below cannot open over it.
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  const clearButtons = () => Array.from(document.querySelectorAll("button")).filter(entry => entry.textContent === "Clear app flow") as HTMLButtonElement[];
  await act(async () => { clearButtons()[0]!.click(); });
  assert.equal(clears, 0);
  await act(async () => { clearButtons().at(-1)!.click(); });
  assert.equal(clears, 1);
});
