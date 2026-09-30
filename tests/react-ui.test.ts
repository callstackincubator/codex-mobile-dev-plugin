import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { LogsPanel } from "../src/ui/logs-panel.ts";
import type { App } from "@modelcontextprotocol/ext-apps";
import type { PanelContext } from "../src/ui/model-context.ts";
import { logKey } from "../src/shared/logs.ts";
import type { StackedLog } from "../src/shared/logs.ts";

test("React log controls filter virtual rows, attach full logs, and preserve simulator DOM", async t => {
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: "http://localhost" });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement,
    HTMLFormElement: dom.window.HTMLFormElement, HTMLInputElement: dom.window.HTMLInputElement, HTMLSelectElement: dom.window.HTMLSelectElement, Node: dom.window.Node, Event: dom.window.Event, CustomEvent: dom.window.CustomEvent,
    NodeFilter: dom.window.NodeFilter, Element: dom.window.Element, DocumentFragment: dom.window.DocumentFragment, MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window), requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} }, IS_REACT_ACT_ENVIRONMENT: true };
  for (const [key, value] of Object.entries(globals)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  Object.defineProperty(dom.window, "ResizeObserver", { value: globals.ResizeObserver });
  // Supply list measurements for DOM behavior, without a browser or visual checks.
  Object.defineProperty(dom.window.HTMLElement.prototype, "clientHeight", { get: () => 360 });
  Object.defineProperty(dom.window.HTMLElement.prototype, "clientWidth", { get: () => 640 });
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    const height = this.hasAttribute("data-log-row") ? 36 : 360;
    return { x: 0, y: 0, top: 0, left: 0, right: 640, bottom: height, width: 640, height, toJSON() {} };
  };
  const directory = await mkdtemp(resolve("node_modules/.mobile-dev-ui-test-"));
  let cleanupView = async () => {};
  t.after(async () => { await cleanupView(); dom.window.close(); for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } await rm(directory, { recursive: true, force: true }); });
  const output = resolve(directory, "workspace.mjs");
  await build({ entryPoints: ["src/ui/components/workspace.tsx"], outfile: output, bundle: true, format: "esm", platform: "node", jsx: "automatic",
    external: ["react", "react/*", "react-dom", "react-dom/*", "@legendapp/list/react", "radix-ui", "lucide-react", "@base-ui/react/*", "react-resizable-panels"] });
  const { Workspace } = await import(pathToFileURL(output).href);
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  let attached: StackedLog | undefined;
  const context = { canAttach: true, attachedKey: undefined as string | undefined, onChange() {}, async attach(log?: StackedLog) { attached = log; this.attachedKey = log ? logKey(log) : undefined; this.onChange(); } };
  const panel = new LogsPanel({} as App, context as PanelContext);
  const root = createRoot(dom.window.document.getElementById("root")!);
  cleanupView = async () => { await act(async () => { root.unmount(); await panel.dispose(); }); };
  const layouts: string[] = [];
  await act(async () => { root.render(createElement(Workspace, { logs: panel, onLayout(layout: string) { layouts.push(layout); } })); });
  const canvas = dom.window.document.querySelector('canvas');
  const picker = dom.window.document.querySelector('[data-element="devices"] [data-slot="select-trigger"]');
  assert.ok(picker);
  await act(async () => { (dom.window.document.getElementById("tool-logs") as HTMLButtonElement).click(); panel.list.setFollow(false); panel.list.append([
    { sequence: 1, timestamp: "2026-09-30T12:00:00Z", message: '<script>alert("log")</script>', stack: "at loadProfile", level: "error", source: "js", origin: "metro" },
    { sequence: 2, timestamp: "2026-09-30T12:00:01Z", message: "Native output", level: "info", source: "native", origin: "ios" },
  ], 0); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
  assert.equal(dom.window.document.querySelectorAll("[data-log-row]").length, 2);
  const errorRow = dom.window.document.querySelector('[data-log-row][data-level="error"]') as HTMLButtonElement;
  assert.equal(errorRow.querySelector("script"), null);
  await act(async () => { errorRow.click(); });
  await act(async () => { (dom.window.document.getElementById("log-attach") as HTMLButtonElement).click(); });
  assert.equal(attached?.stack, "at loadProfile");
  assert.equal(dom.window.document.getElementById("log-attach")?.textContent, "Attached to chat");
  const levelFilter = dom.window.document.querySelector('[aria-label="Filter log levels"]') as HTMLButtonElement;
  await act(async () => { levelFilter.click(); });
  const infoFilter = [...dom.window.document.querySelectorAll('[role="option"]')].find(button => button.textContent === "info") as HTMLElement;
  await act(async () => { infoFilter.click(); });
  assert.equal(dom.window.document.querySelectorAll("[data-log-row]").length, 1);
  await act(async () => { levelFilter.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  assert.equal(dom.window.document.querySelector("canvas"), canvas);
  assert.equal(dom.window.document.querySelector('[data-element="devices"] [data-slot="select-trigger"]'), picker);
  assert.equal(dom.window.document.querySelector('[data-element="screenshot"] svg')?.getAttribute("viewBox"), "0 0 24 24");
  await act(async () => { (dom.window.document.querySelector('[aria-label="Log sources"]') as HTMLButtonElement).click(); });
  assert.ok(dom.window.document.getElementById("logs-native"));
  const sourceFilter = dom.window.document.querySelector('[aria-label="Filter log sources"]') as HTMLElement;
  assert.ok(dom.window.document.getElementById("logs-settings")?.contains(sourceFilter));
  const nativeFilter = [...sourceFilter.querySelectorAll('button')].find(option => option.textContent === "Native") as HTMLButtonElement;
  await act(async () => { nativeFilter.click(); });
  assert.deepEqual([...panel.list.getSnapshot().sources], ["js"]);
  assert.ok(dom.window.document.getElementById("logs-settings"));
  await act(async () => { (dom.window.document.querySelector('[aria-label="Log sources"]') as HTMLButtonElement).click(); });
  assert.equal(panel.getSnapshot().settings, false);
  const iosToggle = dom.window.document.querySelector('[aria-label="Show iOS simulator"]') as HTMLButtonElement;
  const androidToggle = dom.window.document.querySelector('[aria-label="Show Android simulator"]') as HTMLButtonElement;
  await act(async () => { iosToggle.click(); });
  await act(async () => { androidToggle.click(); });
  assert.deepEqual(layouts, ["android", "none"]);
  assert.equal(iosToggle.getAttribute("aria-pressed"), "false");
  assert.equal(androidToggle.getAttribute("aria-pressed"), "false");
  await act(async () => { iosToggle.click(); });
  await act(async () => { androidToggle.click(); });
  assert.deepEqual(layouts, ["android", "none", "ios", "both"]);
  assert.equal(dom.window.document.querySelector("canvas"), canvas);
  await act(async () => { (dom.window.document.getElementById("tool-logs") as HTMLButtonElement).click(); });
  assert.equal(dom.window.document.getElementById("logs-body")?.hidden, true);
  assert.equal(dom.window.document.querySelectorAll("[data-log-row]").length, 0);
});
