import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

test("the project selector lists saved projects and reaches both selection paths", async t => {
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: "http://localhost" });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const globals = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement, Node: dom.window.Node,
    Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, NodeFilter: dom.window.NodeFilter,
    Element: dom.window.Element, DocumentFragment: dom.window.DocumentFragment, MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} }, IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const [key, value] of Object.entries(globals)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  const directory = await mkdtemp(resolve("node_modules/.mobile-dev-project-picker-test-"));
  const output = resolve(directory, "picker.mjs");
  await build({
    stdin: { contents: 'export { AppFlowProjectPicker } from "./src/ui/components/app-flow-project-picker.tsx";', resolveDir: process.cwd(), loader: "ts" },
    outfile: output, bundle: true, format: "esm", platform: "node", jsx: "automatic",
    external: ["react", "react/*", "react-dom", "react-dom/*", "radix-ui", "lucide-react", "@base-ui/react/*"],
  });
  const { AppFlowProjectPicker } = await import(pathToFileURL(output).href);
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");

  const chosen: string[] = [];
  let picks = 0, refreshed = 0;
  const listeners = new Set<() => void>();
  let snapshot: Record<string, unknown> = { projectPath: "", projects: [] };
  const panel = {
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
    refreshProjects: async () => { refreshed++; },
    chooseProject: async (path: string) => { chosen.push(path); },
    pickProject: async () => { picks++; },
  };
  const root = createRoot(dom.window.document.getElementById("root")!);
  await act(async () => { root.render(createElement(AppFlowProjectPicker, { panel })); });
  // React and Radix both need the live window while unmounting, so this runs before the globals
  // node:test would otherwise restore.
  t.after(async () => {
    await act(async () => { root.unmount(); });
    await new Promise(resolve => dom.window.requestAnimationFrame(resolve));
    dom.window.close();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
    await rm(directory, { recursive: true, force: true });
  });
  // React reads the store during the notification, so the new value is set inside act as well.
  const emit = async (fields: Record<string, unknown>) => await act(async () => {
    snapshot = { ...snapshot, ...fields };
    for (const listener of listeners) listener();
  });
  const trigger = () => dom.window.document.querySelector('[aria-label="App Flow project"]') as HTMLButtonElement;
  const popover = () => dom.window.document.querySelector('[data-slot="popover-content"][aria-label="App Flow project"]');

  assert.equal(trigger().textContent?.includes("Choose a project"), true, "an unset project asks to be chosen");
  await act(async () => { trigger().click(); });
  assert.match(popover()?.textContent ?? "", /No projects yet/, "a first run says the list is empty");
  assert.equal(popover()?.querySelectorAll("[data-project-option]").length, 0);
  await act(async () => { (popover()?.querySelector("[data-project-browse]") as HTMLButtonElement).click(); });
  assert.equal(picks, 1, "the system folder picker is the way in");
  assert.equal(popover(), null, "the selector closes once it opens the dialog");

  await emit({ projectPath: "/Users/dev/Shop", projects: [{ path: "/Users/dev/Shop", name: "Shop" }, { path: "/Users/dev/Other", name: "Other" }] });
  assert.equal(trigger().textContent?.includes("Shop"), true, "the trigger shows the chosen folder's name");
  assert.equal(trigger().getAttribute("title"), "/Users/dev/Shop", "the full path stays reachable on hover");
  assert.equal(refreshed, 1, "the first open already asked the server for its list");
  await act(async () => { trigger().click(); });
  assert.equal(refreshed, 2, "every open rereads the server's list");
  assert.deepEqual([...popover()!.querySelectorAll("[data-project-option]")].map(option => option.getAttribute("data-project-option")), ["/Users/dev/Shop", "/Users/dev/Other"]);
  assert.equal(popover()!.querySelector('[data-project-option="/Users/dev/Other"]')?.getAttribute("aria-pressed"), "false");
  await act(async () => { (popover()!.querySelector('[data-project-option="/Users/dev/Other"]') as HTMLButtonElement).click(); });
  assert.deepEqual(chosen, ["/Users/dev/Other"]);
  assert.equal(popover(), null, "the selector closes after a choice");

  await act(async () => { trigger().click(); });
  await act(async () => { (dom.window.document.querySelector("[data-project-browse]") as HTMLButtonElement).click(); });
  assert.equal(picks, 2);
  await emit({ pickingProject: true });
  assert.match(dom.window.document.body.textContent ?? "", /Choose a folder/, "the wait for the dialog is visible");
  await act(async () => { trigger().click(); });
  assert.equal(dom.window.document.querySelector("[data-project-browse]")?.hasAttribute("disabled"), true, "one dialog at a time");
  await emit({ pickingProject: false });
  assert.doesNotMatch(dom.window.document.body.textContent ?? "", /Choose a folder/);
});
