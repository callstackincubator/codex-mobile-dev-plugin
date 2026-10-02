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
import type { LogEntry } from "../src/shared/logs.ts";

test("the rendered log list follows batches, pauses for user scrolling, and resumes at the bottom", async t => {
  const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  class ResizeObserver {
    private targets = new Set<Element>();
    private callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) { this.callback = callback; }
    observe(target: Element) {
      this.targets.add(target);
      dom.window.setTimeout(() => {
        if (!this.targets.has(target)) return;
        const contentRect = target.getBoundingClientRect();
        const size = { blockSize: contentRect.height, inlineSize: contentRect.width };
        const entry = { target, contentRect, borderBoxSize: [size], contentBoxSize: [size], devicePixelContentBoxSize: [size] };
        this.callback([entry], this as unknown as globalThis.ResizeObserver);
      }, 0);
    }
    unobserve(target: Element) { this.targets.delete(target); }
    disconnect() { this.targets.clear(); }
  }
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
    Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, HTMLInputElement: dom.window.HTMLInputElement,
    NodeFilter: dom.window.NodeFilter, DocumentFragment: dom.window.DocumentFragment,
    MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    ResizeObserver, IS_REACT_ACT_ENVIRONMENT: true };
  for (const [key, value] of Object.entries(globals)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    previous.set(key, descriptor);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  Object.defineProperty(dom.window, "ResizeObserver", { value: globals.ResizeObserver });
  const prototype = dom.window.HTMLElement.prototype;
  Object.defineProperty(prototype, "clientHeight", { get: () => 360 });
  Object.defineProperty(prototype, "clientWidth", { get: () => 640 });
  Object.defineProperty(prototype, "scrollHeight", { get() {
    const content = this.classList.contains("legend-list-content-container") ? this : this.querySelector(".legend-list-content-container");
    const height = Number.parseFloat(content?.firstElementChild?.style.height ?? "0");
    return Math.max(360, Math.ceil(height));
  } });
  prototype.getBoundingClientRect = function () {
    const height = this.hasAttribute("data-log-row") || this.style.position === "absolute" ? 28 : 360;
    return { x: 0, y: 0, top: 0, left: 0, right: 640, bottom: height, width: 640, height, toJSON() {} };
  };
  prototype.scrollTo = function (options: ScrollToOptions) {
    const maximum = this.scrollHeight - this.clientHeight;
    const requested = options.top ?? this.scrollTop;
    const clamped = Math.min(requested, maximum);
    const offset = Math.max(0, clamped);
    if (offset === this.scrollTop) return;
    this.scrollTop = offset;
    const event = new dom.window.Event("scroll");
    this.dispatchEvent(event);
  };
  prototype.scrollBy = function (options: ScrollToOptions) {
    const top = this.scrollTop + (options.top ?? 0);
    this.scrollTo({ top });
  };
  const prefix = resolve("node_modules/.logs-follow-test-");
  const directory = await mkdtemp(prefix);
  let cleanup = async () => {};
  t.after(async () => {
    await cleanup();
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    await rm(directory, { recursive: true, force: true });
  });
  const output = resolve(directory, "logs-view.mjs");
  await build({ entryPoints: ["src/ui/components/logs-view.tsx"], outfile: output, bundle: true, format: "esm", platform: "node", jsx: "automatic",
    external: ["react", "react/*", "react-dom", "react-dom/*", "@legendapp/list/react", "lucide-react", "@base-ui/react/*", "radix-ui", "react-resizable-panels"] });
  const url = pathToFileURL(output);
  const { LogsView } = await import(url.href);
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const context = { onChange() {} };
  const panel = new LogsPanel({} as App, context as PanelContext);
  panel.show();
  let sequence = 0;
  const append = (count: number) => {
    const entries: LogEntry[] = Array.from({ length: count }, () => {
      sequence++;
      return { sequence, timestamp: "2026-10-02T12:00:00Z", message: `Log ${sequence}`, level: "info", source: "js", origin: "metro" };
    });
    panel.list.append(entries, 0);
  };
  append(100);
  const rootElement = dom.window.document.getElementById("root");
  assert.ok(rootElement);
  const root = createRoot(rootElement);
  cleanup = async () => { await act(async () => { root.unmount(); await panel.dispose(); }); };
  const view = createElement(LogsView, { panel });
  await act(async () => { root.render(view); });
  const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 70)); }); };
  await settle();
  const content = dom.window.document.querySelector<HTMLElement>(".legend-list-content-container");
  const scroller = content?.parentElement;
  const followButton = dom.window.document.querySelector<HTMLButtonElement>('[aria-label="Follow new logs"]');
  assert.ok(scroller && followButton);
  const assertFollowing = (expected: boolean, message?: string) => {
    const pressed = followButton.getAttribute("aria-pressed");
    const value = String(expected);
    assert.equal(pressed, value, message);
  };
  const dispatch = (type: string) => {
    const event = new dom.window.Event(type, { bubbles: true });
    scroller.dispatchEvent(event);
  };
  const atBottom = () => {
    const remaining = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
    assert.ok(remaining <= 1, `Remaining scroll distance: ${remaining}`);
    assertFollowing(true);
  };
  atBottom();
  await act(async () => { append(10); });
  await settle();
  atBottom();
  await act(async () => {
    const event = new dom.window.WheelEvent("wheel", { deltaY: -80, bubbles: true });
    scroller.dispatchEvent(event);
    scroller.scrollTo({ top: scroller.scrollTop - 80 });
    dispatch("scrollend");
  });
  assertFollowing(false);
  const heldOffset = scroller.scrollTop;
  await act(async () => { append(10); });
  await settle();
  assert.equal(scroller.scrollTop, heldOffset);
  assert.equal(panel.list.scrollOffset, heldOffset);
  await act(async () => {
    const event = new dom.window.WheelEvent("wheel", { deltaY: 1000, bubbles: true });
    scroller.dispatchEvent(event);
    scroller.scrollTo({ top: scroller.scrollHeight });
    dispatch("scrollend");
  });
  await settle();
  atBottom();
  await act(async () => { followButton.click(); append(10); });
  await settle();
  assertFollowing(false);
  await act(async () => { followButton.click(); });
  await settle();
  await act(async () => { append(10); });
  await settle();
  atBottom();
  await act(async () => {
    const event = new dom.window.KeyboardEvent("keydown", { key: "PageUp", bubbles: true });
    scroller.dispatchEvent(event);
    scroller.scrollTo({ top: scroller.scrollTop - 80 });
    dispatch("scrollend");
  });
  assertFollowing(false);
  await act(async () => {
    scroller.scrollTo({ top: scroller.scrollHeight });
    dispatch("scrollend");
  });
  assertFollowing(false, "Automatic scrolling cannot resume a manual pause.");

  await act(async () => {
    dispatch("pointerdown");
    scroller.scrollTo({ top: scroller.scrollTop - 80 });
    dispatch("scrollend");
    scroller.scrollTo({ top: scroller.scrollHeight });
  });
  await settle();
  atBottom();
  await act(async () => {
    scroller.scrollTo({ top: scroller.scrollTop - 80 });
    dispatch("pointerup");
  });
  assertFollowing(false, "Dragging the scrollbar upward pauses even after visiting the bottom during the same drag.");
  await act(async () => { followButton.click(); });
  await settle();
  const touch = (type: string, clientY: number) => {
    const event = new dom.window.Event(type, { bubbles: true });
    Object.defineProperty(event, "touches", { value: [{ clientY }] });
    scroller.dispatchEvent(event);
  };
  await act(async () => {
    touch("touchstart", 100);
    touch("touchmove", 180);
    scroller.scrollTo({ top: scroller.scrollTop - 80 });
    touch("touchend", 180);
    dispatch("scrollend");
  });
  assertFollowing(false, "Touch scrolling toward older logs pauses following.");

  const input = dom.window.document.querySelector<HTMLInputElement>('[aria-label="Search logs"]');
  const help = dom.window.document.querySelector<HTMLButtonElement>('[aria-label="Log filter help"]');
  assert.ok(input && help);
  await act(async () => { help.click(); });
  const helpContent = dom.window.document.querySelector('[data-slot="popover-content"][aria-label="Log filter help"]');
  assert.ok(helpContent);
  assert.match(helpContent.textContent ?? "", /level:error level:warn/);
  const query = `level:info message:"Log ${sequence}"`;
  await act(async () => {
    help.click();
    // JSDOM does not clamp scroll offsets when filtering shrinks the content.
    scroller.scrollTo({ top: 0 });
    panel.list.search(query);
  });
  await settle();
  const filteredRows = dom.window.document.querySelectorAll("[data-log-row]");
  assert.equal(filteredRows.length, 1);
  assert.ok(filteredRows[0].textContent?.includes(`Log ${sequence}`));
  assert.equal(input.value, query);
  await act(async () => { panel.list.search("level:"); });
  assert.equal(input.getAttribute("aria-invalid"), "true");
  const error = dom.window.document.getElementById("logs-query-error");
  assert.ok(error);
  assert.equal(input.getAttribute("aria-describedby"), error.id);
  assert.equal(dom.window.document.querySelectorAll("[data-log-row]").length, 0);

  const initialTime = Date.parse("2026-10-02T12:00:00Z");
  t.mock.timers.enable({ apis: ["Date", "setInterval"], now: initialTime });
  await act(async () => { panel.list.search("age:1s"); });
  let snapshot = panel.list.getSnapshot();
  assert.equal(snapshot.filtered.length, sequence);
  await act(async () => { t.mock.timers.tick(2000); });
  snapshot = panel.list.getSnapshot();
  assert.equal(snapshot.filtered.length, 0, "Age updates without an incoming batch.");
  const visibility = (value: "visible" | "hidden") => {
    Object.defineProperty(dom.window.document, "visibilityState", { configurable: true, value });
    const event = new dom.window.Event("visibilitychange");
    dom.window.document.dispatchEvent(event);
  };
  await act(async () => { visibility("hidden"); t.mock.timers.tick(5000); });
  assert.equal(panel.list.getSnapshot(), snapshot, "Hidden documents stop age filtering.");
  await act(async () => { visibility("visible"); });
  snapshot = panel.list.getSnapshot();
  await act(async () => { panel.toggle(); });
  await act(async () => { t.mock.timers.tick(5000); });
  assert.equal(panel.list.getSnapshot(), snapshot, "Closing Logs clears the refresh timer.");
  await act(async () => { panel.show(); });
  snapshot = panel.list.getSnapshot();
  await act(async () => { root.unmount(); });
  await act(async () => { t.mock.timers.tick(5000); });
  assert.equal(panel.list.getSnapshot(), snapshot, "Unmounting Logs clears the refresh timer.");
  t.mock.timers.reset();
});
