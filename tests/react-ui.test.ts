import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { LogsPanel } from "../src/ui/logs-panel.ts";
import { createDeviceApps } from "./device-apps-fixtures.ts";
import { PerformancePanel } from "../src/ui/performance-panel.ts";
import { RecordingController } from "../src/ui/recording-controller.ts";
import { recordingFixture } from "./recording-fixtures.ts";
import type { App } from "@modelcontextprotocol/ext-apps";
import type { PanelContext } from "../src/ui/model-context.ts";
import { logKey } from "../src/shared/logs.ts";
import type { StackedLog } from "../src/shared/logs.ts";
import type { CpuBatch } from "../src/shared/cpu.ts";
import { UDID } from "./fixtures.ts";

test("React log controls filter virtual rows, attach full logs, and preserve simulator DOM", async t => {
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: "http://localhost" });
  async function selectTool(tool: "logs" | "performance" | "none") {
    await act(async () => { (dom.window.document.getElementById("tool-select") as HTMLButtonElement).click(); });
    await act(async () => { (dom.window.document.getElementById(`tool-${tool}`) as HTMLElement).click(); });
  }
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
  t.after(async () => {
    await cleanupView();
    await new Promise(resolve => dom.window.requestAnimationFrame(resolve));
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    await rm(directory, { recursive: true, force: true });
  });
  const output = resolve(directory, "workspace.mjs");
  await build({ stdin: { contents: 'export { Workspace } from "./src/ui/components/workspace.tsx"; export { getDeviceSettings } from "./src/ui/device-settings.ts"; export { getDevicePicker } from "./src/ui/device-picker.ts";', resolveDir: process.cwd(), loader: "ts" }, outfile: output, bundle: true, format: "esm", platform: "node", jsx: "automatic",
    external: ["recharts", "react", "react/*", "react-dom", "react-dom/*", "@legendapp/list/react", "radix-ui", "lucide-react", "@base-ui/react/*", "react-resizable-panels"] });
  const { Workspace, getDeviceSettings, getDevicePicker } = await import(pathToFileURL(output).href);
  const { act, createElement, Profiler } = await import("react");
  const { createRoot } = await import("react-dom/client");
  let sentLog: StackedLog | undefined;
  const context = { canAttach: true, canSendMessage: true, attachedKey: undefined as string | undefined, onChange() {}, async attach(log?: StackedLog) { this.attachedKey = log ? logKey(log) : undefined; this.onChange(); }, async sendLogToChat(log: StackedLog) { sentLog = log; } };
  let emitCpu: ((batch: CpuBatch) => void) | undefined;
  let cpuSessionsOpened = 0;
  const performanceApp = {
    async callServerTool({ name }: { name: string }) {
      if (name === "mobile_performance_sources") return { content: [], structuredContent: { apps: [{ bundleId: "com.example.app", pid: 123, foreground: true }], foregroundApp: { bundleId: "com.example.app", pid: 123 } } };
      if (name === "mobile_cpu_close") return { content: [] };
      if (name === "mobile_cpu_session") cpuSessionsOpened++;
      const sessionId = "1".repeat(64);
      return { content: [], structuredContent: { sessionId, cpuUri: `cpu://mobile-dev/${sessionId}/batch?after=0` } };
    },
    readServerResource({ uri }: { uri: string }, { signal }: { signal: AbortSignal }) {
      return new Promise((resolve, reject) => {
        const cancel = () => reject(new Error("Read cancelled"));
        signal.addEventListener("abort", cancel, { once: true });
        emitCpu = batch => {
          signal.removeEventListener("abort", cancel);
          const text = JSON.stringify(batch);
          resolve({ contents: [{ uri, mimeType: "application/json", text }] });
        };
      });
    },
  };
  const deviceApps = createDeviceApps(performanceApp as unknown as App);
  const panel = new LogsPanel({} as App, context as PanelContext, deviceApps);
  let logSubscribers = 0;
  const subscribe = panel.list.subscribe;
  panel.list.subscribe = listener => {
    logSubscribers++;
    const unsubscribe = subscribe(listener);
    return () => { logSubscribers--; unsubscribe(); };
  };

  const performance = new PerformancePanel(performanceApp as unknown as App, deviceApps);
  const recordingController = new RecordingController(performanceApp as unknown as App);
  deviceApps.selectDevice({ udid: UDID, name: "iPhone", state: "Booted", runtime: "iOS" });
  performance.setAvailable(true);
  deviceApps.setAvailable(true);
  const root = createRoot(dom.window.document.getElementById("root")!);
  cleanupView = async () => { recordingController.dispose(); await act(async () => { root.unmount(); await panel.dispose(); deviceApps.dispose(); await performance.dispose(); }); };
  const layouts: string[] = [];
  let commits = 0;
  const workspace = createElement(Workspace, { logs: panel, performance, recordingController, onLayout(layout: string) { layouts.push(layout); } });
  const profiled = createElement(Profiler, { id: "workspace", onRender() { commits++; } }, workspace);
  await act(async () => { root.render(profiled); });
  const canvas = dom.window.document.querySelector('canvas');
  const picker = dom.window.document.querySelector('[data-element="devices"] [data-slot="select-trigger"]');
  assert.ok(picker);
  const pickerElement = dom.window.document.querySelector('#ios-panel [data-element="devices"]')!;
  const pickerStore = getDevicePicker(pickerElement);
  let pickerRefreshes = 0;
  pickerStore.refresh = async () => { pickerRefreshes++; };
  let deviceChanges = 0;
  pickerElement.addEventListener("change", () => { deviceChanges++; });
  await act(async () => { pickerStore.update({ value: "iphone", disabled: false, items: [{ value: "iphone", label: "iPhone", running: true, canStop: true }, { value: "ipad", label: "iPad", running: false, canStop: false }] }); });
  await act(async () => { (picker as HTMLButtonElement).click(); });
  await act(async () => { (dom.window.document.querySelector('[data-device-option="iphone"]') as HTMLButtonElement).click(); });
  assert.equal(deviceChanges, 1, "Reselecting a running device retries its connection.");
  assert.equal(pickerRefreshes, 1);
  deviceChanges = 0;
  let stoppedDevice = "";
  pickerStore.stop = async (id: string) => { stoppedDevice = id; pickerStore.update({ items: [{ value: "iphone", label: "iPhone", running: false, canStop: false }, { value: "ipad", label: "iPad", running: false, canStop: false }] }); };
  await act(async () => { (picker as HTMLButtonElement).click(); });
  const stopButton = dom.window.document.querySelector('[aria-label="Stop iPhone"]') as HTMLButtonElement;
  assert.ok(stopButton);
  assert.equal(dom.window.document.querySelector('[aria-label="Stop iPad"]'), null);
  assert.equal(stopButton.querySelector("svg")?.classList.contains("fill-current"), true);
  await act(async () => { stopButton.click(); });
  assert.equal(stoppedDevice, "iphone");
  assert.equal(deviceChanges, 0);
  assert.equal(pickerStore.value, "iphone");
  await act(async () => { (dom.window.document.querySelector('[data-device-option="iphone"]') as HTMLButtonElement).click(); });
  assert.equal(deviceChanges, 1);
  const iosSettings = getDeviceSettings(dom.window.document.querySelector('#ios-panel [data-element="settings"]'));
  const changes: unknown[] = [];
  iosSettings.request = async (change: unknown) => { changes.push(change); return { appearance: "light", contentSize: "large", increaseContrast: false, locationSupported: true }; };
  await act(async () => { iosSettings.configure("iphone", false); });
  const settingsButton = dom.window.document.querySelector('[aria-label="iOS device settings"]') as HTMLButtonElement;
  await act(async () => { settingsButton.click(); });
  const settingsPopover = dom.window.document.querySelector('[data-slot="popover-content"][aria-label="Device settings"]')!;
  assert.ok(settingsPopover.textContent?.includes("Increase contrast"));
  assert.equal(settingsPopover.textContent?.includes("Rotation"), false);
  assert.equal(settingsPopover.textContent?.includes("Biometrics"), false);
  assert.equal(settingsPopover.querySelector("select"), null);
  const textSize = settingsPopover.querySelector('[role="combobox"]') as HTMLButtonElement;
  await act(async () => { textSize.click(); });
  const largeText = [...dom.window.document.querySelectorAll('[role="option"]')].find(option => option.textContent?.trim() === "Accessibility large") as HTMLElement;
  assert.ok(largeText);
  await act(async () => { largeText.click(); });
  assert.deepEqual(changes.at(-1), { setting: "contentSize", value: "accessibility-large" });
  assert.ok(dom.window.document.querySelector('[data-slot="popover-content"][aria-label="Device settings"]'));
  let finishAppearance!: (value: object) => void;
  iosSettings.request = async (change: unknown) => { changes.push(change); return new Promise(resolve => { finishAppearance = resolve; }); };
  const appearanceTabs = settingsPopover.querySelectorAll<HTMLButtonElement>('[role="tab"]');
  const darkAppearance = Array.from(appearanceTabs).find(tab => tab.textContent === "Dark");
  assert.ok(darkAppearance);
  await act(async () => { darkAppearance.click(); });
  assert.deepEqual(changes.at(-1), { setting: "appearance", value: "dark" });
  assert.equal(darkAppearance.getAttribute("aria-selected"), "true");
  assert.equal((settingsPopover.querySelector('[role="combobox"]') as HTMLButtonElement).disabled, false);
  assert.equal((settingsPopover.querySelector('[role="switch"]') as HTMLButtonElement).disabled, false);
  assert.equal(settingsPopover.textContent?.includes("Loading settings"), false);
  await act(async () => { finishAppearance({ appearance: "dark" }); });
  const frameSwitch = [...settingsPopover.querySelectorAll('[role="switch"]')].at(-1) as HTMLButtonElement;
  await act(async () => { frameSwitch.click(); });
  assert.equal(iosSettings.getSnapshot().frame, false);
  await act(async () => { settingsButton.click(); });
  assert.equal(dom.window.document.querySelector("canvas"), canvas);
  await selectTool("logs");
  await act(async () => { panel.list.setFollow(false); panel.list.append([
    { sequence: 1, timestamp: "2026-09-30T12:00:00Z", message: '<script>alert("log")</script>', stack: "at loadProfile", level: "error", source: "js", origin: "metro" },
    { sequence: 2, timestamp: "2026-09-30T12:00:01Z", message: "Native output", level: "info", source: "native", origin: "ios" },
  ], 0); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
  assert.equal(dom.window.document.querySelectorAll("[data-log-row]").length, 2);
  const errorRow = dom.window.document.querySelector('[data-log-row][data-level="error"]') as HTMLButtonElement;
  assert.equal(errorRow.querySelector("script"), null);
  await act(async () => { errorRow.click(); });
  await act(async () => { (dom.window.document.getElementById("log-chat") as HTMLButtonElement).click(); });
  assert.equal(sentLog?.stack, "at loadProfile");
  assert.equal(dom.window.document.getElementById("log-chat")?.textContent, "Fix in chat");
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
  const systemNoise = dom.window.document.querySelector<HTMLButtonElement>('[aria-label="Hide iOS system noise"]');
  assert.ok(systemNoise);
  const initialNoiseChecked = systemNoise.getAttribute("aria-checked");
  assert.equal(initialNoiseChecked, "true");
  await act(async () => { systemNoise.click(); });
  const noiseDisabled = panel.getSnapshot();
  assert.equal(noiseDisabled.hideSystemLogs, false);
  const disabledNoiseChecked = systemNoise.getAttribute("aria-checked");
  assert.equal(disabledNoiseChecked, "false");
  await act(async () => { systemNoise.click(); });
  const noiseEnabled = panel.getSnapshot();
  assert.equal(noiseEnabled.hideSystemLogs, true);
  const sourceFilter = dom.window.document.querySelector('[aria-label="Filter log sources"]') as HTMLElement;
  assert.ok(dom.window.document.getElementById("logs-settings")?.contains(sourceFilter));
  const nativeFilter = [...sourceFilter.querySelectorAll('button')].find(option => option.textContent === "Native") as HTMLButtonElement;
  await act(async () => { nativeFilter.click(); });
  assert.deepEqual([...panel.list.getSnapshot().sources], ["js"]);
  assert.ok(dom.window.document.getElementById("logs-settings"));
  await act(async () => { (dom.window.document.querySelector('[aria-label="Log sources"]') as HTMLButtonElement).click(); });
  assert.equal(panel.getSnapshot().settings, false);
  await act(async () => {
    const sources = dom.window.document.querySelector<HTMLButtonElement>('[aria-label="Log sources"]');
    assert.ok(sources);
    sources.click();
  });
  const followApp = dom.window.document.querySelector<HTMLButtonElement>('[aria-label="Follow foreground app"]');
  const appFilter = dom.window.document.getElementById("logs-process") as HTMLInputElement;
  assert.ok(followApp && appFilter);
  assert.equal(followApp.getAttribute("aria-checked"), "true");
  assert.equal(appFilter.readOnly, true);
  assert.equal(appFilter.value, "com.example.app");
  await act(async () => { followApp.click(); });
  assert.equal(panel.getSnapshot().followApp, false);
  assert.equal(appFilter.readOnly, false);
  await act(async () => { followApp.click(); });
  assert.equal(panel.getSnapshot().followApp, true);
  await act(async () => {
    const sources = dom.window.document.querySelector<HTMLButtonElement>('[aria-label="Log sources"]');
    assert.ok(sources);
    sources.click();
  });
  await selectTool("performance");
  assert.equal(performance.getSnapshot().open, true);
  assert.ok(dom.window.document.getElementById("performance-drawer"));
  assert.equal(dom.window.document.getElementById("logs-drawer"), null);
  assert.equal(dom.window.document.querySelectorAll("[data-log-row]").length, 0);
  assert.equal(logSubscribers, 0, "The inactive log view releases its reactive list subscription.");
  assert.ok(emitCpu);
  await act(async () => {
    emitCpu!({ cursor: 2, phase: "recording", memoryMetric: "physical-footprint", samples: [
      { time: 1, interval: 1, cpuPercent: 10, memoryBytes: 104857600, threads: [
        { id: "c963a4", name: "", cpuPercent: 0 },
        { id: "c963bb", name: "hades", cpuPercent: 10 },
        { id: "c963dd", name: "com.apple.NSURLConnectionLoader", cpuPercent: 0 },
      ] },
      { time: 2, interval: 1, cpuPercent: 0, memoryBytes: 125829120, threads: [
        { id: "c963a4", name: "", cpuPercent: 0 },
        { id: "c963dd", name: "com.apple.NSURLConnectionLoader", cpuPercent: 0 },
      ] },
    ] });
  });
  const memoryTrack = dom.window.document.querySelector('[aria-label="Memory usage"]');
  assert.ok(memoryTrack);
  assert.match(memoryTrack.textContent ?? "", /Current120.0 MiB/);
  assert.match(memoryTrack.textContent ?? "", /Avg \/ Max110.0 \/ 120.0 MiB/);
  assert.match(memoryTrack.textContent ?? "", /Min100.0 MiB/);
  assert.ok(memoryTrack.querySelector('[title*="physical footprint"]'));
  assert.equal(memoryTrack.querySelector('[aria-label="Expand Memory"]'), null);
  const expandCpu = dom.window.document.querySelector('[aria-label="Expand CPU"]') as HTMLButtonElement;
  await act(async () => { expandCpu.click(); });
  assert.equal(expandCpu.getAttribute("aria-expanded"), "true");
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
  const tracks = dom.window.document.querySelector<HTMLElement>('[aria-label="Live CPU, memory and display FPS"]');
  assert.ok(tracks);
  const beforeCursor = commits;
  await act(async () => { tracks.dispatchEvent(new dom.window.MouseEvent("mousemove", { bubbles: true, clientX: 270 })); });
  assert.equal(commits, beforeCursor, "Cursor movement does not render the chart tree.");
  assert.equal(tracks.style.getPropertyValue("--performance-cursor-x"), "100px");
  assert.equal(tracks.style.getPropertyValue("--performance-cursor-opacity"), "1");
  const cursorLabel = tracks.querySelector('[aria-hidden="true"] span');
  assert.equal(cursorLabel?.textContent, "00:07.550");
  await act(async () => { tracks.dispatchEvent(new dom.window.MouseEvent("mouseout", { bubbles: true, relatedTarget: dom.window.document.body })); });
  assert.equal(tracks.style.getPropertyValue("--performance-cursor-opacity"), "0");
  const unnamedThread = dom.window.document.querySelector('[title*="ID: 0xc963a4"]');
  const gcThread = dom.window.document.querySelector('[title*="ID: 0xc963bb"]');
  const networkThread = dom.window.document.querySelector('[title*="ID: 0xc963dd"]');
  const unnamedTitle = unnamedThread?.getAttribute("title") ?? "";
  const gcTitle = gcThread?.getAttribute("title") ?? "";
  const networkTitle = networkThread?.getAttribute("title") ?? "";
  assert.match(unnamedThread?.textContent ?? "", /Unnamed thread #1/);
  assert.match(unnamedTitle, /Native name: \(unnamed\)/);
  assert.match(gcThread?.textContent ?? "", /Hermes GC/);
  assert.match(gcTitle, /Native name: hades[\s\S]*State: exited/);
  assert.match(networkThread?.textContent ?? "", /Network loader/);
  assert.match(networkTitle, /Native name: com\.apple\.NSURLConnectionLoader/);
  const cpuState = performance.getSnapshot();
  assert.equal(cpuState.samples[0].threads[1].name, "hades");
  const threadOrder = dom.window.document.querySelector<HTMLSelectElement>('[aria-label="Thread order"]');
  assert.ok(threadOrder);
  assert.equal(threadOrder.value, "activity");
  const threadIds = () => {
    const labels = dom.window.document.querySelectorAll('[title*="Native name:"]');
    const positions = Array.from(labels, label => {
      const title = label.getAttribute("title") ?? "";
      const match = title.match(/ID: (\S+)/);
      let container = label.parentElement;
      while (container && container.style.position !== "absolute") container = container.parentElement;
      const top = Number.parseFloat(container?.style.top ?? "0");
      return { id: match?.[1], top };
    });
    positions.sort((first, second) => first.top - second.top);
    const ids = positions.map(position => position.id);
    return ids;
  };
  const activityIds = threadIds();
  assert.deepEqual(activityIds, ["0xc963bb", "0xc963a4", "0xc963dd"], "Previously active threads rank above never-active threads even after exit.");
  const gcRow = gcThread?.parentElement;
  await act(async () => {
    threadOrder.value = "first-seen";
    threadOrder.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
  const firstSeenIds = threadIds();
  assert.deepEqual(firstSeenIds, ["0xc963a4", "0xc963bb", "0xc963dd"]);
  const reorderedGc = dom.window.document.querySelector('[title*="ID: 0xc963bb"]');
  assert.equal(reorderedGc?.parentElement, gcRow, "Reordering preserves the same thread row and chart.");
  await act(async () => {
    emitCpu!({ cursor: 3, phase: "recording", memoryMetric: "physical-footprint", samples: [{ time: 3, interval: 1, cpuPercent: 90, memoryBytes: 104857600, threads: [
      { id: "c963dd", name: "com.apple.NSURLConnectionLoader", cpuPercent: 90 },
      { id: "c963a4", name: "", cpuPercent: 0 },
    ] }] });
  });
  const stableIds = threadIds();
  assert.deepEqual(stableIds, firstSeenIds, "First seen does not shift when usage and native enumeration change.");
  await act(async () => {
    threadOrder.value = "activity";
    threadOrder.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
  const changedActivityIds = threadIds();
  assert.deepEqual(changedActivityIds, ["0xc963dd", "0xc963bb", "0xc963a4"]);
  await act(async () => {
    threadOrder.value = "first-seen";
    threadOrder.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
  assert.equal(dom.window.document.querySelector("canvas"), canvas);
  assert.equal(dom.window.document.querySelector('[data-element="devices"] [data-slot="select-trigger"]'), picker);
  await selectTool("logs");
  assert.equal(panel.getSnapshot().open, true);
  assert.equal(dom.window.document.getElementById("performance-drawer"), null);
  assert.equal(dom.window.document.querySelectorAll("[data-log-row]").length, 1);
  assert.equal(logSubscribers, 1);
  await selectTool("performance");
  const reopenCpu = dom.window.document.querySelector<HTMLButtonElement>('[aria-label="Expand CPU"]');
  assert.ok(reopenCpu);
  await act(async () => { reopenCpu.click(); });
  const restoredOrder = dom.window.document.querySelector<HTMLSelectElement>('[aria-label="Thread order"]');
  assert.equal(restoredOrder?.value, "first-seen", "The selected order survives switching away from Performance.");
  const manyThreads = Array.from({ length: 100 }, (_, index) => ({ id: `worker-${index}`, name: `Worker ${index}`, cpuPercent: index }));
  await act(async () => {
    emitCpu!({ cursor: 4, phase: "recording", memoryMetric: "physical-footprint", samples: [
      { time: 4, interval: 1, cpuPercent: 100, memoryBytes: 104857600, threads: manyThreads },
    ] });
    await new Promise(resolve => setTimeout(resolve, 50));
  });
  const mountedThreads = dom.window.document.querySelectorAll("[data-cpu-thread]");
  assert.ok(mountedThreads.length > 0 && mountedThreads.length < 20, "Mounted thread charts are bounded by the viewport.");
  assert.equal(dom.window.document.querySelector('[data-cpu-thread="worker-99"]'), null);
  const latestSample = performance.getSnapshot().samples.at(-1);
  assert.equal(latestSample?.threads.length, 100, "Virtualization retains every thread's measurements.");
  const collapseCpu = dom.window.document.querySelector<HTMLButtonElement>('[aria-label="Collapse CPU"]');
  assert.ok(collapseCpu);
  await act(async () => { collapseCpu.click(); });
  assert.equal(dom.window.document.querySelectorAll("[data-cpu-thread]").length, 0);
  await selectTool("logs");
  async function togglePlatform(platform: "ios" | "android") {
    if (!dom.window.document.getElementById(`platform-${platform}`)) {
      await act(async () => { (dom.window.document.getElementById("platform-select") as HTMLButtonElement).click(); });
    }
    await act(async () => { (dom.window.document.getElementById(`platform-${platform}`) as HTMLElement).click(); });
  }
  assert.equal((dom.window.document.getElementById("android-panel") as HTMLElement).hidden, true);
  await togglePlatform("android");
  await togglePlatform("ios");
  await togglePlatform("android");
  assert.deepEqual(layouts, ["both", "android", "none"]);
  await togglePlatform("ios");
  await togglePlatform("android");
  assert.deepEqual(layouts, ["both", "android", "none", "ios", "both"]);
  assert.equal(dom.window.document.querySelector("canvas"), canvas);
  await selectTool("none");
  assert.equal(dom.window.document.getElementById("logs-body")?.hidden, true);
  assert.equal(dom.window.document.querySelectorAll("[data-log-row]").length, 0);
  const sessionsBeforeOpening = cpuSessionsOpened;
  await act(async () => {
    recordingController.accept({ content: [], structuredContent: { recording: recordingFixture(), range: { start: 12, end: 18 } } });
  });
  const toolsTrigger = dom.window.document.getElementById("tool-select");
  const showsPerformance = toolsTrigger?.textContent?.includes("Performance");
  assert.ok(showsPerformance);
  assert.ok(dom.window.document.body.textContent?.includes("Selected range: 12.0s–18.0s"));
  assert.ok(dom.window.document.body.textContent?.includes("Checkout scroll · Run 1"));
  assert.equal(layouts.at(-1), "none", "Opening a saved run gives the detailed chart the workspace.");
  assert.equal(cpuSessionsOpened, sessionsBeforeOpening, "Opening a saved recording does not start another collector.");
  assert.equal(dom.window.document.querySelector("canvas"), canvas, "Saved recordings preserve the existing device DOM.");
});
