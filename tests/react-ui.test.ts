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
    Element: dom.window.Element, DocumentFragment: dom.window.DocumentFragment, MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window), requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} }, IS_REACT_ACT_ENVIRONMENT: true };
  for (const [key, value] of Object.entries(globals)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
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
    loader: { ".svg": "text" }, external: ["react", "react/*", "react-dom", "react-dom/*", "@legendapp/list/react", "radix-ui"] });
  const { Workspace } = await import(pathToFileURL(output).href);
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  let attached: StackedLog | undefined;
  const context = { canAttach: true, attachedKey: undefined as string | undefined, onChange() {}, async attach(log?: StackedLog) { attached = log; this.attachedKey = log ? logKey(log) : undefined; this.onChange(); } };
  const panel = new LogsPanel({} as App, context as PanelContext);
  const root = createRoot(dom.window.document.getElementById("root")!);
  cleanupView = async () => { await act(async () => { root.unmount(); await panel.dispose(); }); };
  await act(async () => { root.render(createElement(Workspace, { logs: panel, onLayout() {} })); });
  const canvas = dom.window.document.querySelector('canvas');
  const picker = dom.window.document.querySelector('[data-element="devices"]') as HTMLSelectElement;
  picker.replaceChildren(new dom.window.Option("Running device", "device-1"));
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
  const infoFilter = [...dom.window.document.querySelectorAll('[data-slot="toggle-group-item"]')].find(button => button.textContent === "info") as HTMLButtonElement;
  await act(async () => { infoFilter.click(); });
  assert.equal(dom.window.document.querySelectorAll("[data-log-row]").length, 1);
  assert.equal(dom.window.document.querySelector("canvas"), canvas);
  assert.equal(picker.value, "device-1");
  assert.equal(dom.window.document.querySelector('[data-element="refresh"] svg')?.getAttribute("viewBox"), "0 -960 960 960");
  await act(async () => { (dom.window.document.querySelector('[aria-label="Log sources"]') as HTMLButtonElement).click(); });
  assert.ok(dom.window.document.getElementById("logs-native"));
  await act(async () => { (dom.window.document.getElementById("logs-toggle") as HTMLButtonElement).click(); });
  assert.equal(dom.window.document.getElementById("logs-body")?.hidden, true);
  assert.equal(dom.window.document.querySelectorAll("[data-log-row]").length, 0);
});
