import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { PerformancePanel } from "../src/ui/performance-panel.ts";
import type { CpuSample } from "../src/shared/cpu.ts";

test("performance tracks share immediate zoom, fill a fixed scale, and preserve scrolled history", async t => {
  const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
  let viewportWidth = 640;
  const observers = new Set<ResizeObserver>();
  const previous = new Map<string, PropertyDescriptor | undefined>();
  class ResizeObserver {
    targets = new Set<Element>();
    private callback: () => void;
    constructor(callback: () => void) {
      this.callback = callback;
      observers.add(this);
    }
    observe(target: Element) { this.targets.add(target); }
    unobserve(target: Element) { this.targets.delete(target); }
    disconnect() { observers.delete(this); }
    resize(target: Element) { if (this.targets.has(target)) this.callback(); }
  }
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
    MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    ResizeObserver, IS_REACT_ACT_ENVIRONMENT: true };
  for (const [key, value] of Object.entries(globals)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    previous.set(key, descriptor);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  Object.defineProperty(dom.window, "ResizeObserver", { value: ResizeObserver });
  Object.defineProperty(dom.window.HTMLElement.prototype, "clientHeight", { get: () => 360 });
  Object.defineProperty(dom.window.HTMLElement.prototype, "clientWidth", { get: () => viewportWidth });
  Object.defineProperty(dom.window.HTMLElement.prototype, "offsetWidth", { get: () => viewportWidth });
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    const tracks = this.getAttribute("aria-label") === "Live CPU, memory and display FPS";
    const scroller = this.closest<HTMLElement>("[data-performance-scroll]");
    const width = tracks ? Number.parseFloat(this.style.width) : viewportWidth;
    const left = tracks ? -(scroller?.scrollLeft ?? 0) : 0;
    return { x: left, y: 0, top: 0, left, right: left + width, bottom: 360, width, height: 360, toJSON() {} };
  };
  const temporaryPrefix = resolve("node_modules/.performance-view-test-");
  const directory = await mkdtemp(temporaryPrefix);
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
  const output = resolve(directory, "performance-view.mjs");
  await build({ entryPoints: ["src/ui/components/performance-view.tsx"], outfile: output,
    bundle: true, format: "esm", platform: "node", jsx: "automatic",
    external: ["react", "react/*", "react-dom", "react-dom/*", "@legendapp/list/react", "lucide-react", "@base-ui/react/*", "radix-ui"],
    plugins: [{ name: "observe-chart-inputs", setup(builder) {
      builder.onLoad({ filter: /PerformanceAreaChart\.tsx$/ }, () => ({ loader: "tsx", contents: `
        import { useContext } from "react";
        import { TimelineChartWidth } from "../../performance/TimelineChartWidth";
        export function PerformanceAreaChart({ zoomState, onZoomChange, onZoomOut }) {
          const width = useContext(TimelineChartWidth);
          return <div data-chart-width={width} data-domain={zoomState.left + ":" + zoomState.right + ":" + zoomState.viewDuration}>
            <button aria-label="Select test range" onClick={() => onZoomChange({ left: 5, right: 10, viewDuration: 5, isZoomed: true, refAreaLeft: undefined, refAreaRight: undefined })}>Select</button>
            <button aria-label="Reset test range" onClick={onZoomOut}>Reset</button>
          </div>;
        }` }));
      builder.onLoad({ filter: /TimelineRuler\.tsx$/ }, () => ({ loader: "tsx", contents: `
        import { useContext } from "react";
        import { TimelineChartWidth } from "../../performance/TimelineChartWidth";
        export function TimelineRuler({ zoomState, cursorLabel }) {
          const width = useContext(TimelineChartWidth);
          return <div data-chart-width={width} data-domain={zoomState.left + ":" + zoomState.right + ":" + zoomState.viewDuration}><span ref={cursorLabel} /></div>;
        }` }));
    } }],
  });
  const moduleUrl = pathToFileURL(output);
  const { PerformanceView } = await import(moduleUrl.href);
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const sample = (time: number): CpuSample => ({ time, interval: 1, cpuPercent: 20, memoryBytes: 104857600,
    threads: [{ id: "worker", name: "Worker", cpuPercent: 20 }] });
  const initialSamples = Array.from({ length: 12 }, (_, index) => {
    const reading = sample(index + 1);
    return reading;
  });
  let snapshot: ReturnType<PerformancePanel["getSnapshot"]> = { open: true, available: true, discovering: false, monitoring: true, physical: false,
    fpsSamples: [], fpsPhase: "idle", fpsError: "", fpsMonitoring: false, fpsSupported: false,
    selectedLabel: "Test device", platform: "ios", bundleId: "test.app", apps: [{ bundleId: "test.app", pid: 1 }], samples: initialSamples,
    threadHistory: new Map([["worker", { number: 1, peakCpuPercent: 20 }]]), threadOrder: "first-seen", phase: "recording", error: "", sourceError: "" };
  const listeners = new Set<() => void>();
  const panel = { subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot };
  const rootElement = dom.window.document.getElementById("root");
  assert.ok(rootElement);
  const root = createRoot(rootElement);
  cleanup = async () => {
    await act(async () => { root.unmount(); });
  };
  const view = createElement(PerformanceView, { panel });
  await act(async () => { root.render(view); });
  const scroller = dom.window.document.querySelector<HTMLElement>("[data-performance-scroll]");
  const tracks = dom.window.document.querySelector<HTMLElement>('[aria-label="Live CPU, memory and display FPS"]');
  assert.ok(scroller && tracks);
  let scrollLeft = 0;
  Object.defineProperty(scroller, "scrollWidth", { get: () => Number.parseFloat(tracks.style.width) });
  Object.defineProperty(scroller, "scrollLeft", {
    get: () => scrollLeft,
    set(value: number) {
      const maximum = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
      const clamped = Math.min(value, maximum);
      scrollLeft = Math.max(0, clamped);
    },
  });
  const assertDomains = (expected: string) => {
    const charts = dom.window.document.querySelectorAll<HTMLElement>("[data-domain]");
    assert.ok(charts.length >= 3);
    for (const chart of charts) assert.equal(chart.dataset.domain, expected);
  };
  const click = async (selector: string) => {
    const button = dom.window.document.querySelector<HTMLButtonElement>(selector);
    assert.ok(button);
    await act(async () => button.click());
  };
  const publish = async (samples: CpuSample[]) => {
    snapshot = { ...snapshot, samples };
    await act(async () => { for (const listener of listeners) listener(); });
  };
  const closeTo = (actual: number, expected: number) => {
    const difference = Math.abs(actual - expected);
    assert.ok(difference < 0.001, `${actual} differs from ${expected}`);
  };
  const assertChartWidths = () => {
    const charts = dom.window.document.querySelectorAll<HTMLElement>("[data-chart-width]");
    const contentWidth = Number.parseFloat(tracks.style.width);
    for (const chart of charts) {
      const width = Number(chart.dataset.chartWidth);
      closeTo(width, contentWidth - 170);
    }
  };
  const assertRightFade = (visible: boolean) => {
    const fade = dom.window.document.querySelector("[data-performance-right-fade]");
    assert.equal(fade !== null, visible);
  };
  assertDomains("1:31:30");
  assert.equal(tracks.style.width, "640px");
  assertChartWidths();
  assertRightFade(false);
  await click('[aria-label="Expand CPU"]');
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
  const thread = dom.window.document.querySelector('[data-cpu-thread="worker"]');
  assert.ok(thread);
  await click('[aria-label="Select test range"]');
  assertDomains("5:10:5");
  const zoomedThread = dom.window.document.querySelector('[data-cpu-thread="worker"]');
  assert.equal(zoomedThread, thread, "Zoom updates the mounted thread immediately without a sample or remount.");
  await click('[aria-label="Reset test range"]');
  assertDomains("1:31:30");
  const longSamples = Array.from({ length: 150 }, (_, index) => {
    const reading = sample(index + 1);
    return reading;
  });
  await publish(longSamples);
  const pixelsPerSecond = (640 - 170 - 12) / 30;
  closeTo(scroller.scrollWidth, 182 + 149 * pixelsPerSecond);
  closeTo(scroller.scrollLeft, scroller.scrollWidth - 640);
  assertChartWidths();
  assertRightFade(false);
  await act(async () => {
    const event = new dom.window.Event("scroll");
    scroller.dispatchEvent(event);
  });
  const followingLive = tracks.textContent?.includes("Follow live") === false;
  assert.equal(followingLive, true, "Programmatic scrolling keeps live following enabled.");
  await act(async () => {
    scroller.scrollLeft = 60 * pixelsPerSecond;
    const event = new dom.window.Event("scroll");
    scroller.dispatchEvent(event);
  });
  const followingPaused = tracks.textContent?.includes("Follow live");
  assert.ok(followingPaused);
  assertRightFade(true);
  const retainedSamples = longSamples.slice(1);
  const nextSample = sample(151);
  const nextSamples = [...retainedSamples, nextSample];
  await publish(nextSamples);
  closeTo(scroller.scrollLeft, 59 * pixelsPerSecond);
  assertChartWidths();
  assertRightFade(true);
  await act(async () => {
    const event = new dom.window.MouseEvent("mousemove", { bubbles: true, clientX: 270 });
    tracks.dispatchEvent(event);
  });
  const cursorX = tracks.style.getPropertyValue("--performance-cursor-x");
  const cursorPosition = Number.parseFloat(cursorX);
  closeTo(cursorPosition, scroller.scrollLeft + 100);
  const visibleStart = 2 + scroller.scrollLeft / pixelsPerSecond;
  await act(async () => {
    viewportWidth = 800;
    for (const observer of observers) observer.resize(scroller);
  });
  const resizedScale = (800 - 170 - 12) / 30;
  closeTo(2 + scroller.scrollLeft / resizedScale, visibleStart);
  assertChartWidths();
  await click('[aria-label="Reset test range"]');
  closeTo(scroller.scrollLeft, scroller.scrollWidth - 800);
  assertDomains("2:151:30");
  assertRightFade(false);
  snapshot = { ...snapshot, fpsMonitoring: true, fpsPhase: "recording", fpsSupported: true,
    fpsSamples: [{ time: 4, interval: 0, fps: null }, { time: 5, interval: 1, fps: 60 }] };
  await publish([]);
  assertDomains("4:34:30");
  assertChartWidths();
  assertRightFade(false);
  snapshot = { ...snapshot, fpsSamples: [{ time: 40, interval: 1, fps: 60 }, { time: 80, interval: 1, fps: 60 }] };
  await publish([]);
  assertDomains("39:80:30");
  assertChartWidths();
  await act(async () => {
    scroller.scrollLeft = 0;
    const event = new dom.window.Event("scroll");
    scroller.dispatchEvent(event);
  });
  assertRightFade(true);
  await click('[aria-label="Reset test range"]');
  assertRightFade(false);
});
