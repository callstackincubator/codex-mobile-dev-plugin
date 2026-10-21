import test from "node:test";
import assert from "node:assert/strict";
import { renderEnvironment } from "./jsdom-env.ts";

test("the sweep row offers a per-project Capture UI states switch instead of a separate UI Explore run", async t => {
  const { module: { AppFlowView, progressTally }, dom, onTeardown } = await renderEnvironment<any>(t, {
    exports: 'export { AppFlowView, progressTally } from "./src/ui/components/app-flow-view.tsx";', slug: "ui-explore", settleMs: 50,
  });
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
  const agentStarts: boolean[] = [];
  let canSendAgentStart = true;
  let clears = 0;
  const recordingSnapshot = { nodeId: null, status: null, steps: [] };
  const panel = {
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
    get canSendAgentStart() { return canSendAgentStart; },
    recording: { subscribe: () => () => {}, getSnapshot: () => recordingSnapshot },
    refreshProjects: async () => {}, chooseProject: async () => {}, pickProject: async () => {},
    launchApp: async () => {},
    clear: async () => { clears += 1; },
    /* Fast is started straight from the panel — it asks no model anything, so there is no decision
       loop for Codex to service — while every other sweep still goes through the chat round trip.
       Both land in `starts` so the assertions below read the request whichever route carried it,
       and `agentStarts` is what pins which route that was. */
    start: async (options: unknown) => { starts.push(options); agentStarts.push(false); },
    requestAgentStart: async (options: unknown) => { starts.push(options); agentStarts.push(true); },
  };
  const document = dom.window.document;
  const storage = dom.window.localStorage;
  const key = "app-flow-capture-ui-states:/projects/demo";
  const root = createRoot(document.getElementById("root")!);
  onTeardown(async () => { await act(async () => { root.unmount(); }); });
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
  onTeardown(async () => { await act(async () => { second.unmount(); }); });
  await act(async () => { second.render(createElement(AppFlowView, { panel })); });
  // The sweep options live in a popover: nothing is rendered until its trigger (which summarizes them) is opened.
  const trigger = () => Array.from(document.querySelectorAll("button")).find(entry => /screens?$/.test(entry.textContent ?? "") && entry.getAttribute("aria-haspopup") === "dialog") as HTMLButtonElement;
  assert.equal(trigger().textContent, "Fast · 10 screens", "the sweep defaults to Fast over 10 screens");
  assert.equal(labelled("Capture UI states"), null, "the options are closed until the trigger is opened");
  await act(async () => { trigger().click(); });
  const toggle = () => labelled("Capture UI states") as HTMLButtonElement;
  const routes = labelled("App Flow exploration mode") as HTMLElement;
  const screenLimit = labelled("Maximum screens to explore") as HTMLInputElement;
  assert.ok(toggle(), "the switch is offered beside the sweep options");
  assert.equal(toggle().getAttribute("role"), "switch");
  assert.equal(toggle().getAttribute("aria-checked"), "false", "default off");
  assert.equal(storage.getItem(key), null);
  assert.equal(routes.getAttribute("role"), "combobox", "the reach mode is a themed dropdown, not a native select");
  assert.match(routes.textContent ?? "", /^Fast/, "fast is the default selection");
  const note = () => document.getElementById("app-flow-exploration-note")?.textContent ?? "";
  assert.match(note(), /runtime navigator/i, "the note explains the selected mode");
  assert.equal(routes.getAttribute("aria-describedby"), "app-flow-exploration-note");
  assert.equal(labelled("App Flow deep-link judge"), null, "the deep-link check is no longer a UI choice");
  assert.equal(storage.getItem("app-flow-deep-link-judge:/projects/demo"), null);

  // Zero is an explicit unlimited sweep, persists, and is sent rather than collapsed to undefined.
  assert.equal(screenLimit.min, "0");
  assert.match(document.getElementById("app-flow-screen-limit-help")?.textContent ?? "", /0 explores all screens/i);
  const valueSetter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")?.set;
  assert.ok(valueSetter);
  await act(async () => { valueSetter.call(screenLimit, "0"); screenLimit.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
  assert.equal(screenLimit.value, "0");
  assert.equal(storage.getItem("app-flow-screen-limit:/projects/demo"), "0");
  assert.equal(trigger().textContent, "Fast · All screens", "0 reads as All");
  await act(async () => { valueSetter.call(screenLimit, "15"); screenLimit.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
  assert.equal(trigger().textContent, "Fast · 15 screens");
  await act(async () => { valueSetter.call(screenLimit, "0"); screenLimit.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
  await act(async () => { startButton().click(); });
  assert.equal((starts.at(-1) as { screenLimit?: number }).screenLimit, 0);
  assert.equal(agentStarts.at(-1), false, "Fast needs no decision loop, so it starts without asking Codex");
  assert.equal((starts.at(-1) as { judgeUnclearScreens?: boolean }).judgeUnclearScreens, false, "and says so on the request");

  // The judge switch is the one thing that puts a model role back in Fast, so it puts the decision
  // loop — and with it the chat start — back too. It persists per project like the others.
  const judge = () => labelled("Judge unclear screens with AI") as HTMLButtonElement;
  assert.equal(judge().getAttribute("aria-checked"), "false", "off by default: Fast's premise is no model calls");
  await act(async () => { judge().click(); });
  assert.equal(storage.getItem("app-flow-judge-unclear:/projects/demo"), "on");
  await act(async () => { startButton().click(); });
  assert.equal((starts.at(-1) as { judgeUnclearScreens?: boolean }).judgeUnclearScreens, true);
  assert.equal(agentStarts.at(-1), true, "someone has to service the judge call it may queue");
  await act(async () => { judge().click(); });
  assert.equal(storage.getItem("app-flow-judge-unclear:/projects/demo"), "off");

  // Off is sent as an explicit false on the one start request the sweep already makes.
  await act(async () => { startButton().click(); });
  assert.equal((starts.at(-1) as { captureUiStates?: boolean }).captureUiStates, false);

  // Turning it on persists per project and rides the same start request.
  await act(async () => { toggle().click(); });
  assert.equal(toggle().getAttribute("aria-checked"), "true");
  assert.equal(storage.getItem(key), "on");
  await act(async () => { startButton().click(); });
  assert.deepEqual(starts.at(-1), { mode: "screen-ui-and-structure", screenLimit: 0, explorationMode: "fast", deepLinkJudgeMode: "off", captureUiStates: true, judgeUnclearScreens: false });

  /* Deep Link + Explore already spends a model-driven walk per screen, so the states pass is not
     offered on top of it. The stored preference is left alone — it is the *sent* value that drops,
     so a project switched to that mode and back keeps what the user chose. */
  const reach = () => labelled("App Flow exploration mode") as HTMLElement;
  await act(async () => { reach().click(); });
  await act(async () => { await Promise.resolve(); });
  const reachOption = (text: string) => Array.from(document.querySelectorAll('[role="option"]')).find(option => option.textContent === text) as HTMLElement;
  await act(async () => { reachOption("Deep Link + Explore").click(); });
  await act(async () => { await Promise.resolve(); });
  assert.equal(toggle().disabled, true, "the switch is not offered for Deep Link + Explore");
  assert.equal(toggle().getAttribute("aria-checked"), "false", "and reads off while it cannot run");
  assert.equal(storage.getItem(key), "on", "but the project's own preference is untouched");
  assert.match(document.getElementById("app-flow-capture-ui-states-help")?.textContent ?? "", /Not available with Deep Link \+ Explore/);
  await act(async () => { startButton().click(); });
  assert.equal((starts.at(-1) as { captureUiStates?: boolean }).captureUiStates, false, "so the run cannot ask for it");

  // Back on a mode that can run it, the stored preference comes back.
  await act(async () => { reach().click(); });
  await act(async () => { await Promise.resolve(); });
  await act(async () => { reachOption("Fast").click(); });
  await act(async () => { await Promise.resolve(); });
  assert.equal(toggle().disabled, false);
  assert.equal(toggle().getAttribute("aria-checked"), "true");

  // Existing results can be cleared, but never while a run is active.
  snapshot = { ...snapshot, result: { manifest: { formatVersion: 4, durationMs: 1 }, nodes: [], edges: [] } };
  await act(async () => { for (const listener of listeners) listener(); });
  const clearButtons = () => Array.from(document.querySelectorAll("button")).filter(entry => entry.textContent === "Clear app flow") as HTMLButtonElement[];
  const clearButton = () => clearButtons()[0]!;
  assert.ok(clearButton(), "a result exposes the clear action");
  assert.equal(clearButton().disabled, false);

  // Clearing deletes every capture and recorded path, so the trigger asks before it does anything.
  await act(async () => { clearButton().click(); });
  assert.equal(clears, 0, "the trigger opens the confirmation rather than clearing");
  const confirmation = () => document.querySelector('[aria-label="Confirm clearing the app flow"]');
  assert.ok(confirmation(), "the confirmation is on screen");
  const cancel = () => Array.from(document.querySelectorAll("button")).find(entry => entry.textContent === "Cancel") as HTMLButtonElement;
  await act(async () => { cancel().click(); });
  assert.equal(clears, 0, "dismissing leaves the flow alone");
  assert.equal(confirmation(), null);

  await act(async () => { clearButton().click(); });
  // The confirm button carries the same words as the trigger; it is the second one on screen.
  await act(async () => { clearButtons().at(-1)!.click(); });
  assert.equal(clears, 1, "confirming clears");
  assert.equal(confirmation(), null, "and closes the confirmation");
  snapshot = { ...snapshot, state: "running", runId: "run-1" };
  await act(async () => { for (const listener of listeners) listener(); });
  assert.equal(clearButton().disabled, true, "the clear action is disabled during a run");
  snapshot = { ...snapshot, state: "idle", runId: null, result: null };
  await act(async () => { for (const listener of listeners) listener(); });

  // A fresh mount of the same project restores it; another project does not inherit it.
  await act(async () => { second.unmount(); });
  const third = createRoot(document.getElementById("root")!);
  onTeardown(async () => { await act(async () => { third.unmount(); }); });
  await act(async () => { third.render(createElement(AppFlowView, { panel })); });
  await act(async () => { trigger().click(); });
  assert.equal(toggle().getAttribute("aria-checked"), "true", "restored from localStorage");
  assert.equal((labelled("Maximum screens to explore") as HTMLInputElement).value, "0", "zero is restored from localStorage");

  // Warnings use the shared accessible alert treatment and explain the action to take.
  storage.setItem("app-flow-exploration:/projects/demo", "fast");
  canSendAgentStart = false;
  snapshot = { ...snapshot, projectPath: "/projects/warnings" };
  storage.setItem("app-flow-mode:/projects/warnings", "screen-ui-and-structure");
  storage.setItem("app-flow-exploration:/projects/warnings", "fast");
  await act(async () => { for (const listener of listeners) listener(); });
  const alerts = Array.from(document.querySelectorAll('[role="alert"]'));
  assert.equal(alerts.length, 1);
  assert.ok(alerts.some(alert => /Sign in before using Fast/.test(alert.textContent ?? "")));
  assert.match(note(), /runtime navigator.*skips deep links/i, "the note follows the stored Fast selection");
  // A host that cannot send a chat message can still run Fast: it never needed the chat round trip,
  // so telling the user to start it from chat would be inventing a requirement it does not have.
  assert.equal(alerts.some(alert => /Start this flow from chat/.test(alert.textContent ?? "")), false);
  assert.equal(startButton().disabled, false, "and the button stays live");

  // The switch is not offered where nobody can answer it: a queued judge call with no agent
  // listening is a sweep that waits forever, which is worse than the uncertain verdict it replaces.
  assert.equal(judge().disabled, true, "no chat, no judge");
  assert.match(document.getElementById("app-flow-judge-unclear-help")?.textContent ?? "", /Needs a host that can message Codex/);

  // Deep Link + Fast is model-driven end to end, so on that host it is still a chat start.
  storage.setItem("app-flow-exploration:/projects/warnings", "auto");
  snapshot = { ...snapshot, projectPath: "/projects/warnings-auto" };
  storage.setItem("app-flow-mode:/projects/warnings-auto", "screen-ui-and-structure");
  storage.setItem("app-flow-exploration:/projects/warnings-auto", "auto");
  await act(async () => { for (const listener of listeners) listener(); });
  const autoAlerts = Array.from(document.querySelectorAll('[role="alert"]'));
  assert.ok(autoAlerts.some(alert => /Start this flow from chat/.test(alert.textContent ?? "")));
  assert.equal(startButton().disabled, true);
  canSendAgentStart = true;

  snapshot = { ...snapshot, projectPath: "/projects/other" };
  storage.setItem("app-flow-mode:/projects/other", "screen-ui-and-structure");
  await act(async () => { for (const listener of listeners) listener(); });
  assert.equal(toggle().getAttribute("aria-checked"), "false", "the switch is per project");

  // The sweep's start options are not inflated by the old standalone limit's key.
  assert.equal(storage.getItem("app-flow-ui-explore-limit:/projects/demo"), null);
});
