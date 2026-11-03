import test from "node:test";
import assert from "node:assert/strict";
import { renderEnvironment } from "./jsdom-env.ts";
import { VIEW_OPTIONS, appFlowGraphFixture, graphPickerHarness } from "./app-flow-graph-test-helpers.ts";

test("captured UI states ride on their screen's node, collapsed until asked for", async t => {
  const { module: { AppFlowGraph }, dom, onTeardown } = await renderEnvironment<any>(t, {
    exports: 'export { AppFlowGraph } from "./packages/ui/src/components/app-flow-graph.tsx";', slug: "ui-states", graph: true,
  });
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");

  const { nodes } = appFlowGraphFixture();
  const idle = { nodeId: null, status: null, steps: [] };
  const panel = {
    screenshot: async (_projectId: string, path: string) => `blob:${path}`,
    recording: { subscribe: () => () => {}, getSnapshot: () => idle },
    replay: async () => {},
  };
  const root = createRoot(dom.window.document.getElementById("root")!);
  onTeardown(async () => { await act(async () => { root.unmount(); }); });
  await act(async () => { root.render(createElement(AppFlowGraph, { nodes, edges: [], entryScreenIds: ["home"], projectId: "project-1", panel,
    view: "flow", viewOptions: VIEW_OPTIONS, onViewChange: () => {} })); });
  await act(async () => { await Promise.resolve(); });

  const buttons = () => Array.from(dom.window.document.querySelectorAll("button")) as HTMLButtonElement[];
  // The canvas pickers are buttons with `aria-expanded` too, so read the strip toggles by label.
  const toggles = buttons().filter(button => /captured UI state/.test(button.getAttribute("aria-label") ?? ""));
  assert.equal(toggles.length, 1, "only the screen with captured states grows a strip");
  const toggle = toggles[0];
  assert.equal(toggle.getAttribute("aria-expanded"), "false", "collapsed at rest, so a dense graph is unchanged");
  assert.equal(toggle.getAttribute("aria-label"), "Show 2 captured UI states of Home");
  assert.match(toggle.textContent!, /2$/, "the count badge");
  // Scoped to the toggle's own container: React Flow gives every node wrapper `role="group"`,
  // so a document-wide query would match the canvas rather than the strip under test.
  const strip = () => toggle.parentElement!.querySelector('[role="group"]') as HTMLElement | null;
  assert.equal(strip() === null, true, "no strip in the DOM until it is asked for");
  const mainImage = () => Array.from(dom.window.document.querySelectorAll("img")).find(image => image.className.includes("flex-1")) as HTMLImageElement;
  assert.equal(mainImage().getAttribute("alt"), "Home");

  await act(async () => { toggle.click(); });
  await act(async () => { await Promise.resolve(); });
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.equal(toggle.getAttribute("aria-label"), "Hide 2 captured UI states of Home");
  assert.equal(strip()!.getAttribute("aria-label"), "Captured UI states of Home");
  const thumbs = Array.from(strip()!.querySelectorAll("button")) as HTMLButtonElement[];
  // The failed variant also carries an aria-hidden "!" glyph, so read the visible caption.
  const caption = (button: HTMLButtonElement) => button.querySelector("span:last-child")!.textContent;
  assert.deepEqual(thumbs.map(caption), ["Base", "Cart Sheet", "Error Dialog"]);
  assert.deepEqual(thumbs.map(button => button.getAttribute("aria-pressed")), ["true", "false", "false"]);

  // A variant with no frame is shown with its reason and cannot become the node's image.
  const failedThumb = thumbs[2];
  assert.equal(failedThumb.disabled, true);
  assert.match(failedThumb.getAttribute("title")!, /Setter threw: cannot read id/);
  assert.equal(failedThumb.querySelector("img"), null, "there is no frame to show");
  await act(async () => { failedThumb.click(); });
  assert.equal(mainImage().getAttribute("alt"), "Home", "a failed variant never takes over the main image");

  await act(async () => { thumbs[1].click(); });
  await act(async () => { await Promise.resolve(); });
  assert.equal(mainImage().getAttribute("alt"), "Home — Cart Sheet");
  assert.equal(mainImage().getAttribute("src"), "blob:screens/home-cart.png");
  assert.match(dom.window.document.body.textContent!, /Showing UI state: Cart Sheet/);
  const pressed = Array.from(strip()!.querySelectorAll("button")).map(button => button.getAttribute("aria-pressed"));
  assert.deepEqual(pressed, ["false", "true", "false"]);

  await act(async () => { (strip()!.querySelector("button") as HTMLButtonElement).click(); });
  await act(async () => { await Promise.resolve(); });
  assert.equal(mainImage().getAttribute("alt"), "Home", "Base puts the sweep's own capture back");

  // The pickers. This canvas offers the view switch and the screen jump; a UI state is a thumbnail
  // inside a node here, so its own picker belongs to the UI-states view.
  const { closeOptions, jumpOptions, jumpTrigger, openJump, openOptions, type } = graphPickerHarness(dom.window, act);
  assert.equal(jumpTrigger("Jump to UI state"), undefined, "no UI-state jump on the flow canvas");
  assert.deepEqual((await openOptions("App Flow view")).map(option => option.textContent), ["Flow graph", "UI states"]);
  await closeOptions("App Flow view");
  assert.deepEqual((await openJump("Jump to screen")).map(option => option.textContent), ["About", "Home"]);

  // Typing narrows the list instead of scrolling it.
  await type("Jump to screen", "ho");
  assert.deepEqual(jumpOptions("Jump to screen").map(option => option.textContent), ["Home"]);
  await type("Jump to screen", "zzz");
  assert.deepEqual(jumpOptions("Jump to screen"), []);
  assert.match(dom.window.document.body.textContent ?? "", /No screens match/);
  // Left open, the portalled layer tears down after the DOM is gone and its cleanup throws.
  await act(async () => { jumpTrigger("Jump to screen")!.click(); });
});
