import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

test("captured UI states ride on their screen's node, collapsed until asked for", async t => {
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: "http://localhost" });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const globals = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement, Node: dom.window.Node,
    Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, NodeFilter: dom.window.NodeFilter,
    Element: dom.window.Element, DocumentFragment: dom.window.DocumentFragment, MutationObserver: dom.window.MutationObserver,
    localStorage: dom.window.localStorage, getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
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
  const directory = await mkdtemp(resolve("node_modules/.mobile-dev-ui-states-test-"));
  let cleanup = async () => {};
  t.after(async () => { await cleanup(); dom.window.close(); for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } await rm(directory, { recursive: true, force: true }); });
  const output = resolve(directory, "app-flow-graph.mjs");
  await build({
    stdin: { contents: 'export { AppFlowGraph } from "./src/ui/components/app-flow-graph.tsx";', resolveDir: process.cwd(), loader: "ts" },
    outfile: output, bundle: true, format: "esm", platform: "node", jsx: "automatic",
    external: ["react", "react/*", "react-dom", "react-dom/*", "radix-ui", "lucide-react", "@base-ui/react/*", "@xyflow/react"],
  });
  const { AppFlowGraph } = await import(pathToFileURL(output).href);
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
  cleanup = async () => { await act(async () => { root.unmount(); }); };
  await act(async () => { root.render(createElement(AppFlowGraph, { nodes, edges: [], entryScreenIds: ["home"], projectId: "project-1", panel })); });
  await act(async () => { await Promise.resolve(); });

  const buttons = () => Array.from(dom.window.document.querySelectorAll("button")) as HTMLButtonElement[];
  const toggles = buttons().filter(button => button.hasAttribute("aria-expanded"));
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

  // The jump pickers. A UI state has no node of its own on this canvas, so choosing one has to
  // reach into the screen that opened it: open its strip and put that frame up.
  const select = (label: string) => dom.window.document.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement;
  assert.deepEqual(Array.from(select("Jump to screen").options).map(option => option.value), ["", "about", "home"]);
  assert.deepEqual(Array.from(select("Jump to UI state").options).map(option => option.textContent),
    ["Jump to…", "Home — Cart Sheet", "Home — Error Dialog (not captured)"]);

  await act(async () => { toggle.click(); });
  assert.equal(toggle.getAttribute("aria-expanded"), "false", "collapsed again, so the picker has something to open");
  const picker = select("Jump to UI state");
  await act(async () => { picker.value = "home::cart"; picker.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
  await act(async () => { await Promise.resolve(); });
  assert.equal(toggle.getAttribute("aria-expanded"), "true", "the jump opens the strip it chose from");
  assert.equal(mainImage().getAttribute("alt"), "Home — Cart Sheet", "and shows the chosen state");
});
