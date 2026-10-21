import test from "node:test";
import assert from "node:assert/strict";
import { renderEnvironment } from "./jsdom-env.ts";

const VIEW_OPTIONS = [{ value: "flow", label: "Flow graph" }, { value: "ui-states", label: "UI states" }];

test("captured UI states ride on their screen's node, collapsed until asked for", async t => {
  const { module: { AppFlowGraph }, dom, onTeardown } = await renderEnvironment<any>(t, {
    exports: 'export { AppFlowGraph } from "./src/ui/components/app-flow-graph.tsx";', slug: "ui-states", graph: true,
  });
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");

  const uiStates = [
    { id: "cart", name: "Cart Sheet", screenshot: "screens/home-cart.png", file: "app/home.tsx", line: 12, openedBy: "state" },
    // Persisted by the host precisely so a failure is visible rather than silently missing.
    { id: "error", name: "Error Dialog", screenshot: null, error: "Setter threw: cannot read id", file: "app/home.tsx", line: 40 },
  ];
  const node = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
    id, title, urlPath: `/${id}`, reach: "navigation-only", groups: [], group: "root", navigator: null,
    capture: { status: "ok", needsNavigation: false, note: null, screenshot: `screens/${id}.png`, pressables: [], ...extra },
  });
  const nodes = [node("home", "Home", { uiStates }), node("about", "About")];
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
  const trigger = (label: string) => dom.window.document.querySelector(`[data-slot="select-trigger"][aria-label="${label}"]`) as HTMLElement | null;
  // A base-ui select opens a popup elsewhere in the document, so read the list the trigger owns.
  const openOptions = async (label: string) => {
    const control = trigger(label)!;
    await act(async () => { control.click(); });
    await act(async () => { await Promise.resolve(); });
    const list = dom.window.document.getElementById(control.getAttribute("aria-controls")!)!;
    return Array.from(list.querySelectorAll('[role="option"]')) as HTMLElement[];
  };
  const closeOptions = async (label: string) => { await act(async () => { trigger(label)!.click(); }); await act(async () => { await Promise.resolve(); }); };
  /* The jump pickers are no longer selects: the trigger opens a popover holding a search box over
     the list, so a flow with hundreds of near-identical route names can be narrowed by typing. */
  const jumpTrigger = (label: string) => Array.from(dom.window.document.querySelectorAll("button")).find(entry => entry.getAttribute("aria-label") === label) as HTMLButtonElement | undefined;
  // Scoped to this picker's own listbox: the canvas switch above is a select, and its options are
  // still in the document when its popup has been opened.
  const jumpList = (label: string) => dom.window.document.querySelector(`[aria-label="${label} options"]`)!;
  const jumpOptions = (label: string) => Array.from(jumpList(label).querySelectorAll('[role="option"]')) as HTMLElement[];
  const openJump = async (label: string) => {
    // The popover dismisses on an outside click, so a click meant to open it can land as the
    // dismissal of a list left open earlier. Opening is therefore "click until the list is there".
    for (let attempt = 0; attempt < 2 && !dom.window.document.querySelector(`[aria-label="${label} options"]`); attempt += 1) {
      await act(async () => { jumpTrigger(label)!.click(); });
      await act(async () => { await Promise.resolve(); });
    }
    return jumpOptions(label);
  };
  const search = (label: string) => dom.window.document.querySelector(`[aria-label="${label} search"]`) as HTMLInputElement;
  const type = async (label: string, text: string) => {
    const field = search(label);
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!;
    await act(async () => { setter.call(field, text); field.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
  };
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
