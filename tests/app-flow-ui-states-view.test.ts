import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * The UI-states canvas: screens as parents, their captured states as child nodes, plus the two
 * jump pickers. Rendered for real, because the thing under test is that a state becomes a node —
 * the pure placement maths is covered in `app-flow-layout.test.ts`.
 */
test("the UI-states graph draws each captured state as a child of its screen, and lists both in the pickers", async t => {
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
  const directory = await mkdtemp(resolve("node_modules/.mobile-dev-ui-states-view-test-"));
  let cleanup = async () => {};
  t.after(async () => { await cleanup(); dom.window.close(); for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } await rm(directory, { recursive: true, force: true }); });
  const output = resolve(directory, "app-flow-ui-states-graph.mjs");
  await build({
    stdin: { contents: 'export { AppFlowUiStatesGraph } from "./src/ui/components/app-flow-ui-states-graph.tsx";', resolveDir: process.cwd(), loader: "ts" },
    outfile: output, bundle: true, format: "esm", platform: "node", jsx: "automatic",
    external: ["react", "react/*", "react-dom", "react-dom/*", "radix-ui", "lucide-react", "@base-ui/react/*", "@xyflow/react"],
  });
  const { AppFlowUiStatesGraph } = await import(pathToFileURL(output).href);
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");

  const uiStates = [
    { id: "cart", name: "Cart Sheet", screenshot: "screens/home-cart.png", file: "app/home.tsx", line: 12, openedBy: "state" },
    { id: "error", name: "Error Dialog", screenshot: null, error: "Setter threw: cannot read id", file: "app/home.tsx", line: 40 },
  ];
  const node = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
    id, title, urlPath: `/${id}`, reach: "navigation-only", groups: [], group: "root", navigator: null,
    capture: { status: "ok", needsNavigation: false, note: null, screenshot: `screens/${id}.png`, pressables: [], ...extra },
  });
  const nodes = [node("home", "Home", { uiStates }), node("about", "About")];
  const panel = { screenshot: async (_projectId: string, path: string) => `blob:${path}`, recording: { subscribe: () => () => {}, getSnapshot: () => ({ nodeId: null, status: null, steps: [] }) }, replay: async () => {} };
  const root = createRoot(dom.window.document.getElementById("root")!);
  cleanup = async () => { await act(async () => { root.unmount(); }); };
  await act(async () => { root.render(createElement(AppFlowUiStatesGraph, { nodes, projectId: "project-1", panel })); });
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

  const select = (label: string) => dom.window.document.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement;
  const options = (label: string) => Array.from(select(label).options).map(option => [option.value, option.textContent]);
  assert.deepEqual(options("Jump to screen"), [["", "Jump to…"], ["home", "Home"]], "only screens this canvas draws");
  assert.deepEqual(options("Jump to UI state"), [["", "Jump to…"], ["home::cart", "Home — Cart Sheet"], ["home::error", "Home — Error Dialog (not captured)"]]);

  const picker = select("Jump to UI state");
  await act(async () => { picker.value = "home::cart"; picker.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
  await act(async () => { await Promise.resolve(); });
  assert.equal(picker.value, "home::cart", "the picker keeps the chosen state, so the canvas says what it is showing");
});
