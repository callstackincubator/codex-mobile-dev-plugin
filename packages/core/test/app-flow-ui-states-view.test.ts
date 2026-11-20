import test from "node:test";
import assert from "node:assert/strict";
import { renderEnvironment } from "./jsdom-env.ts";
import { VIEW_OPTIONS, appFlowGraphFixture, graphPickerHarness } from "./app-flow-graph-test-helpers.ts";

/**
 * The UI-states canvas: screens as parents, their captured states as child nodes, plus the two
 * jump pickers. Rendered for real, because the thing under test is that a state becomes a node —
 * the pure placement maths is covered in `app-flow-layout.test.ts`.
 */
test("the UI-states graph draws each captured state as a child of its screen, and lists both in the pickers", async t => {
  const { module: { AppFlowUiStatesGraph }, dom, onTeardown } = await renderEnvironment<any>(t, {
    exports: 'export { AppFlowUiStatesGraph } from "./packages/ui/src/components/app-flow-ui-states-graph.tsx";', slug: "ui-states-view", graph: true,
  });
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");

  const { nodes } = appFlowGraphFixture();
  const panel = { screenshot: async (_projectId: string, path: string) => `blob:${path}`, recording: { subscribe: () => () => {}, getSnapshot: () => ({ nodeId: null, status: null, steps: [] }) }, replay: async () => {} };
  const root = createRoot(dom.window.document.getElementById("root")!);
  onTeardown(async () => { await act(async () => { root.unmount(); }); });
  await act(async () => { root.render(createElement(AppFlowUiStatesGraph, { nodes, projectId: "project-1", panel,
    view: "ui-states", viewOptions: VIEW_OPTIONS, onViewChange: () => {} })); });
  await act(async () => { await Promise.resolve(); });

  const text = () => dom.window.document.body.textContent ?? "";
  // The screen that captured nothing is not drawn: an empty parent is a row of nothing.
  assert.equal(text().includes("About"), false);
  assert.match(text(), /Home/);
  assert.match(text(), /2 UI states/);
  assert.match(text(), /Cart Sheet/);
  assert.match(text(), /Opened by the screen’s own state setter/);
  // A variant found in source and never opened keeps its card, with the reason on it.
  assert.match(text(), /Setter threw: cannot read id/);
  assert.match(text(), /app\/home\.tsx:40/);
  const images = Array.from(dom.window.document.querySelectorAll("img")) as HTMLImageElement[];
  assert.deepEqual(images.map(image => image.getAttribute("src")), ["blob:screens/home.png", "blob:screens/home-cart.png"],
    "the parent shows the screen, the child its own frame, and the failed variant has none");

  const { closeOptions, jumpTrigger, openJump, openOptions } = graphPickerHarness(dom.window, act);
  assert.deepEqual((await openOptions("App Flow view")).map(option => option.textContent), ["Flow graph", "UI states"],
    "the canvas switch sits above the jump picker");
  await closeOptions("App Flow view");

  assert.equal(jumpTrigger("Jump to screen"), undefined, "this canvas jumps to UI states, not screens");
  const states = await openJump("Jump to UI state");
  assert.deepEqual(states.map(option => option.textContent), ["Home — Cart Sheet", "Home — Error Dialog (not captured)"]);

  // "Captured only" drops the states the pass found in source and could not open. It filters the
  // list, not the canvas: the uncaptured state keeps its card, it is just not a jump target.
  const capturedOnly = () => dom.window.document.querySelector('[aria-label="Show captured routes only"]') as HTMLButtonElement;
  await act(async () => { capturedOnly().click(); });
  assert.equal(capturedOnly().getAttribute("aria-pressed"), "true");
  assert.deepEqual((await openJump("Jump to UI state")).map(option => option.textContent), ["Home — Cart Sheet"]);
  await act(async () => { capturedOnly().click(); });

  const reopened = await openJump("Jump to UI state");
  await act(async () => { reopened[0].click(); });
  await act(async () => { await Promise.resolve(); });
  assert.match(jumpTrigger("Jump to UI state")!.textContent!, /Home — Cart Sheet/,
    "the picker keeps the chosen state, so the canvas says what it is showing");
});
