import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { HostBridge } from "../src/host-bridge.ts";
import type { PanelContext, ScreenshotAttachment } from "../src/model-context.ts";
import { createSimulatorPanel } from "../src/simulator-panel.ts";
import type { SimulatorPanel, SimulatorPanelView } from "../src/simulator-panel.ts";
import { initialState, panelSnapshot } from "../src/simulator-state.ts";
import { frameLayout } from "../src/device-frame-layout.ts";
import { DevicePickerStore } from "../src/device-picker.ts";
import { DeviceSettingsStore } from "../src/device-settings.ts";
import { AppToolsStore } from "../src/app-tools.ts";
import { ScreenAnnotationsStore } from "../src/screen-annotations.ts";
import type { PhysicalIosDevice } from "../../shared/src/ios-devices.ts";
import type { PhysicalAndroidDevice } from "../../shared/src/android-devices.ts";
import type { SimulatorDevice } from "../../shared/src/protocol.ts";
import type { ScreenAnnotation } from "../../shared/src/screen-annotations.ts";
import type { DeviceSettingsResult, PhysicalIosDevicesResult, SimulatorStatusResult, StreamSessionMeta, StreamSessionResult } from "../../shared/src/tool-results.ts";
import type { AndroidVideoBatch } from "../../shared/src/android-video.ts";
import type { IosVideoBatch } from "../../shared/src/ios-video.ts";
import { createDeviceApps } from "../../test-support/device-apps-fixtures.ts";

type Platform = "ios" | "android";
type Call = { name: string; arguments: Record<string, unknown> };
type Handler = (args: Record<string, unknown>) => CallToolResult | Promise<CallToolResult>;

export const physicalBezel = { rect: { x: 27, y: 18, width: 400, height: 872 }, viewport: { width: 454, height: 908 }, clipRadius: 62, image: "data:image/png;base64,AQID", mask: "data:image/png;base64,BAUG" };
export const iphone: SimulatorDevice = { udid: "iphone-1", name: "iPhone", state: "Booted", runtime: "", platform: "ios", kind: "simulator" };
export const pixel: SimulatorDevice = { udid: "emulator-5554", name: "Pixel", state: "Booted", runtime: "", platform: "android", kind: "emulator" };
export const physicalPhone: PhysicalIosDevice = {
  udid: "00008110-000A0B1C2D3E4000", coreDeviceId: "11111111-1111-4111-8111-111111111111",
  name: "Physical iPhone", model: "iPhone 17 Pro", productType: "iPhone18,1", state: "connected", runtime: "iOS 27.0",
  platform: "ios", kind: "physical", transportType: "localNetwork", pairingState: "paired",
};
export const androidPhone: PhysicalAndroidDevice = {
  udid: "phone-serial", name: "Pixel 9", model: "Pixel 9", state: "Booted", runtime: "Android",
  platform: "android", kind: "physical", transportType: "wired",
};

/** The canvas or stage the view would render: pointer capture, drawing and the measurements the panel reads. */
export class FakeElement extends EventTarget {
  width = 0;
  height = 0;
  clientWidth = 300;
  clientHeight = 600;
  captures = new Set<number>();
  draws = 0;
  getContext() { return { drawImage: () => { this.draws++; } }; }
  toDataURL() { return "data:image/png;base64,AA=="; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 150, height: 300 }; }
  setPointerCapture(id: number) { this.captures.add(id); }
  hasPointerCapture(id: number) { return this.captures.has(id); }
  releasePointerCapture(id: number) { this.captures.delete(id); }
  focus() {}
}

export function dispatch(target: EventTarget, name: string, properties: object = {}) { target.dispatchEvent(Object.assign(new Event(name), properties)); }

export function pasteText(target: EventTarget, text: string) {
  const event = new Event("paste", { cancelable: true });
  Object.assign(event, { clipboardData: { getData: (format: string) => format === "text/plain" ? text : "" } });
  target.dispatchEvent(event);
  return event;
}

export async function waitFor(predicate: () => boolean) {
  const end = Date.now() + 2000;
  while (!predicate()) {
    assert.ok(Date.now() < end, "Panel did not reach the expected state");
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

type ViewStores = Partial<Pick<SimulatorPanelView, "picker" | "settings" | "appTools" | "annotations">>;

/** A panel for rendering SimulatorView alone: the given stores and an idle snapshot, without a server behind it. */
export function panelView(platform: Platform, stores: ViewStores = {}): SimulatorPanelView {
  const state = initialState(platform, frameLayout({ stage: { width: 0, height: 0 }, showFrame: true, platform }));
  const snapshot = panelSnapshot(state, { selecting: false, draft: false, capture: false }, { canAttach: true, canAttachScreenshots: true, canMessage: true });
  return {
    platform, getSnapshot: () => snapshot, subscribe: () => () => {},
    picker: stores.picker ?? new DevicePickerStore({ select() {}, async stop() {}, async refresh() {} }),
    settings: stores.settings ?? new DeviceSettingsStore({ async request() { return {}; }, setFrame() {} }),
    appTools: stores.appTools ?? new AppToolsStore(async () => ({})),
    annotations: stores.annotations ?? new ScreenAnnotationsStore({ capture() { throw new Error("No screen"); }, async readTree() { return { tree: [] }; } }),
    attach: () => () => {}, activate() {}, press() {}, screenshot() {}, startDevice() {},
  };
}

const ok = (structuredContent?: Record<string, unknown>, extra: Partial<CallToolResult> = {}): CallToolResult => ({ content: [], ...(structuredContent ? { structuredContent } : {}), ...extra });
const failed = (text: string, meta?: Record<string, unknown>): CallToolResult => ({ isError: true, content: [{ type: "text", text }], ...(meta ? { _meta: meta } : {}) });

/** What one device panel's view would hold: the panel, the canvas and stage it attached, and its snapshot. */
export type PanelHarness = ReturnType<typeof harness>;

function harness(panel: SimulatorPanel) {
  const canvas = new FakeElement();
  const stage = new FakeElement();
  panel.attach(canvas as unknown as HTMLCanvasElement, stage as unknown as HTMLElement);
  return {
    panel, canvas, stage, picker: panel.picker, annotations: panel.annotations, settings: panel.settings,
    get view() { return panel.getSnapshot(); },
    /** The stage's message, when it shows one instead of the screen. */
    get message() { const display = panel.getSnapshot().display; return display.kind === "message" ? display : undefined; },
  };
}

export type DeviceTools = {
  simulators?: SimulatorDevice[];
  android?: SimulatorDevice[];
  physical?: PhysicalIosDevice[];
  /** Tools that answer with this error text, by name. */
  failures?: Record<string, string>;
};

/**
 * A Mobile Dev server for two device panels. Each tool is answered by name with a result typed by the
 * shared tool-result schemas; the device listings follow boots and stops. Each stream's first frame
 * arrives at once, later ones when `frame()` releases them.
 */
export function fakeDeviceTools(t: TestContext, { simulators = [iphone], android = [pixel], physical = [], failures = {} }: DeviceTools = {}) {
  const devices: Record<Platform, SimulatorDevice[]> = { ios: [...simulators], android: [...android] };
  let paired = [...physical];
  const calls: Call[] = [];
  const closed: string[] = [];
  const selections: { platform: string; active?: boolean }[] = [];
  const screenshots: ScreenshotAttachment[] = [];
  const attachedAnnotations: ScreenAnnotation[] = [];
  const delays = new Map<string, Promise<void>>();
  const once = new Map<string, CallToolResult>();
  const overrides = new Map<string, Handler>();
  const video = { held: false, observe: true, invalid: false, generation: 1, empty: false, failDecode: false };
  const attach = { error: "", encoding: "" };
  let blockedIos = false;
  let sessions = 0;

  const status = (platform: Platform): CallToolResult => ok({ connected: true, managed: true, baseUrl: "http://127.0.0.1:8421/", devices: devices[platform] } satisfies SimulatorStatusResult);
  const setState = (platform: Platform, id: unknown, state: "Booted" | "Shutdown") => {
    devices[platform] = devices[platform].map(device => {
      if (device.udid !== id) return device;
      // Emulators boot into a serial and stop back to their avd: ID.
      const udid = platform === "android" && device.kind === "emulator" ? state === "Booted" ? "emulator-5554" : `avd:${device.name}` : device.udid;
      return { ...device, udid, state };
    });
  };
  const openStream = (android: boolean): CallToolResult => {
    const id = `${android ? "android" : "ios"}-${++sessions}`;
    const meta: StreamSessionMeta = { sessionId: id, frameUri: android ? `stream://mobile-dev/${id}/frame` : `mobile-frame://${id}/latest` };
    const result: StreamSessionResult = { definition: { screen: { rect: { width: 390, height: 844 } } }, inputStatus: { state: !android && blockedIos ? "blocked" : "ready" } };
    return ok(result, { _meta: meta });
  };
  const handlers: Record<string, Handler> = {
    mobile_list_simulators: () => status("ios"),
    mobile_list_android_devices: () => status("android"),
    mobile_list_ios_devices: () => ok({ physicalDevices: paired } satisfies PhysicalIosDevicesResult),
    mobile_boot_simulator: ({ udid }) => { setState("ios", udid, "Booted"); return status("ios"); },
    mobile_boot_android_emulator: ({ deviceId }) => { setState("android", deviceId, "Booted"); return status("android"); },
    mobile_shutdown_simulator: ({ udid }) => { setState("ios", udid, "Shutdown"); return status("ios"); },
    mobile_shutdown_android_emulator: ({ deviceId }) => { setState("android", deviceId, "Shutdown"); return status("android"); },
    mobile_stream_session: () => openStream(false),
    mobile_android_stream_session: () => openStream(true),
    mobile_ios_mirror_session: () => {
      const id = `physical-${++sessions}`;
      return ok({ name: "Physical iPhone" }, { _meta: { bezel: physicalBezel, sessionId: id, frameUri: `ios-video://mobile-dev/${id}/video` } satisfies StreamSessionMeta });
    },
    mobile_device_settings: () => ok({ settings: { appearance: "dark", locationSupported: true } } satisfies DeviceSettingsResult),
    mobile_update_device_setting: () => ok({ settings: { appearance: "dark", locationSupported: true } } satisfies DeviceSettingsResult),
    mobile_inspect_ui: () => ok({ runtime: { available: true }, tree: [{ source: "react-native", name: "Continue", role: "Pressable", bounds: { x: 10, y: 20, width: 100, height: 100 }, nodeId: "node-0", depth: 0 }] }),
    mobile_describe_ui: () => ok({ tree: { elements: [{ label: "Continue", role: "AXButton", frame: { x: 10, y: 20, width: 100, height: 100 } }] } }),
    mobile_android_describe_ui: () => ok({ tree: { elements: [{ label: "Continue", role: "AXButton", frame: { x: 10, y: 20, width: 100, height: 100 } }] } }),
  };
  const screenshot: Handler = args => ({ content: [{ type: "image", mimeType: "image/png", data: typeof args.image === "string" ? args.image : "AA==" }], structuredContent: { copied: true } });
  for (const name of ["mobile_capture_screenshot", "mobile_android_capture_screenshot", "mobile_ios_mirror_capture_screenshot"]) handlers[name] = screenshot;
  for (const name of ["mobile_stream_close", "mobile_android_stream_close", "mobile_ios_mirror_close"]) handlers[name] = ({ sessionId }) => { closed.push(String(sessionId)); return ok(); };

  const reads = new Set<string>();
  const pendingReads = new Map<string, (sequence: number) => void>();
  function frameResult(uri: string, id: string, sequence: number) {
    const serverPreparedAt = performance.timeOrigin + performance.now();
    let contents: unknown[];
    if (uri.startsWith("ios-video:")) {
      const batch: IosVideoBatch = { generation: 1, sequence, dropped: 0, configuration: { revision: 1, width: 400, height: 800, codec: "hvc1.1.6.L150.B0", description: "AQ==" }, frames: [{ sequence, data: "AA==", timestamp: 0, key: true }] };
      contents = [{ uri, mimeType: "application/json", text: JSON.stringify(batch) }];
    } else if (id.startsWith("ios")) {
      contents = [{ uri, mimeType: "image/jpeg", blob: "AA==", _meta: { sequence: video.invalid ? 0 : sequence, receivedAt: Date.now(), bytes: 1, serverWaitMs: 0, serverStartedAt: serverPreparedAt, serverPreparedAt } }];
    } else {
      const packet = Buffer.from([0, 0, 0, 1, 0x67, 0x64, 0, 0x28, 0, 0, 0, 1, 0x65, 1]).toString("base64");
      const batch: AndroidVideoBatch = { sequence, generation: video.generation, packets: video.empty ? [] : [{ sequence, data: packet }] };
      contents = [{ uri, mimeType: "application/json", text: JSON.stringify(batch) }];
    }
    video.invalid = false;
    video.empty = false;
    const result = { contents };
    if (video.observe) window.dispatchEvent(Object.assign(new Event("message"), { data: { jsonrpc: "2.0", result }, source: undefined }));
    return result;
  }

  let capabilities: Record<string, unknown> = { message: { text: {} } };
  const app = {
    getHostCapabilities: () => capabilities,
    async callServerTool(call: Call) {
      calls.push(call);
      await delays.get(call.name);
      const result = once.get(call.name);
      if (result) { once.delete(call.name); return result; }
      if (failures[call.name]) return failed(failures[call.name]);
      return (overrides.get(call.name) ?? handlers[call.name] ?? (() => ok()))(call.arguments ?? {});
    },
    async readServerResource({ uri }: { uri: string }, { signal }: { signal: AbortSignal }) {
      const address = new URL(uri);
      const id = address.protocol === "mobile-frame:" ? address.hostname : address.pathname.split("/")[1];
      if (!reads.has(id)) {
        reads.add(id);
        if (!video.held) return frameResult(uri, id, 1);
      }
      return new Promise((resolve, reject) => {
        const abort = () => { pendingReads.delete(id); reject(new Error("Aborted")); };
        pendingReads.set(id, sequence => { pendingReads.delete(id); signal.removeEventListener("abort", abort); resolve(frameResult(uri, id, sequence)); });
        if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
      });
    },
  } as unknown as HostBridge;

  const document = Object.assign(new EventTarget(), { visibilityState: "visible", createElement: () => new FakeElement() });
  class Decoder {
    state = "configured";
    decodeQueueSize = 0;
    output: (frame: object) => void;
    error: (error: Error) => void;
    constructor(options: { output: (frame: object) => void; error: (error: Error) => void }) { this.output = options.output; this.error = options.error; }
    static async isConfigSupported() { return { supported: true }; }
    configure() {}
    decode() {
      if (video.failDecode) { video.failDecode = false; this.error(new Error("Decoder recovery")); return; }
      this.output({ displayWidth: 400, displayHeight: 800, close() {} });
    }
    close() { this.state = "closed"; }
  }
  const globals = {
    document, window: new EventTarget(),
    ResizeObserver: class { observe() {} disconnect() {} },
    getComputedStyle: () => ({ paddingLeft: "16", paddingRight: "16", paddingTop: "16", paddingBottom: "16" }),
    VideoDecoder: Decoder, EncodedVideoChunk: class {},
    requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0),
    cancelAnimationFrame: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    OffscreenCanvas: class {
      width: number;
      height: number;
      constructor(width: number, height: number) { this.width = width; this.height = height; }
      getContext() { return { fillStyle: "", fillRect() {}, drawImage() {} }; }
      async convertToBlob() {
        if (attach.encoding) throw new Error(attach.encoding);
        return new Blob([new Uint8Array([255, 216, 255, 217])], { type: "image/jpeg" });
      }
    },
    createImageBitmap: async () => ({ width: 390, height: 844, close() {} }),
  };
  const restore: (() => void)[] = [];
  for (const [name, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true });
    restore.push(() => { if (previous) Object.defineProperty(globalThis, name, previous); else Reflect.deleteProperty(globalThis, name); });
  }

  const context = {
    canAttach: true, canAttachScreenshots: true, screenAnnotations: attachedAnnotations, subscribe: () => () => {},
    async attachScreenshot(screenshot: ScreenshotAttachment) {
      if (attach.error) throw new Error(attach.error);
      screenshots.push(screenshot);
      return true;
    },
    async attachAnnotation(annotation: ScreenAnnotation) { attachedAnnotations.push(annotation); return true; },
  } as unknown as PanelContext;
  const deviceApps = createDeviceApps(app as never);
  const [ios, androidPanel] = (["ios", "android"] as const).map(platform => {
    const panel = createSimulatorPanel(app, platform, { context, deviceApps }, (_device, active) => selections.push({ platform, active }));
    panel.setAvailable(true);
    return harness(panel);
  });
  t.after(async () => { await Promise.all([ios.panel.dispose(), androidPanel.panel.dispose()]); deviceApps.dispose(); for (const reset of restore) reset(); });

  return {
    app, calls, closed, selections, screenshots, attachedAnnotations, ios, android: androidPanel,
    panels: [ios.panel, androidPanel.panel] as const,
    /** Replaces a platform's listed simulators, emulators or Android hardware. */
    setDevices(platform: Platform, list: SimulatorDevice[]) { devices[platform] = [...list]; },
    setPhysical(list: PhysicalIosDevice[]) { paired = [...list]; },
    /** Stops every listed device outside the panel. */
    stopDevices() { for (const platform of ["ios", "android"] as const) devices[platform] = devices[platform].map(device => ({ ...device, state: "Shutdown" })); },
    /** Makes a tool fail with `text`, or answer normally again with none. */
    fail(name: string, text = "") { if (text) failures[name] = text; else delete failures[name]; },
    failOnce(name: string, text: string, meta?: Record<string, unknown>) { once.set(name, failed(text, meta)); },
    answer(name: string, handler: Handler) { overrides.set(name, handler); },
    delay(name: string, gate: Promise<void> | undefined) { if (gate) delays.set(name, gate); else delays.delete(name); },
    blockIos() { blockedIos = true; },
    withoutChat() { capabilities = {}; },
    failScreenshotAttachment(message: string) { attach.error = message; },
    failScreenshotEncoding(message: string) { attach.encoding = message; },
    holdInitialFrames() { video.held = true; },
    missTiming() { video.observe = false; },
    invalidFrame() { video.invalid = true; },
    failAndroidDecode() { video.failDecode = true; },
    visibility(value: string) { document.visibilityState = value; document.dispatchEvent(new Event("visibilitychange")); },
    frame(platform: Platform, sequence: number, options: { generation?: number; empty?: boolean } = {}) {
      const id = [...pendingReads.keys()].find(id => id.startsWith(platform));
      assert.ok(id);
      if (options.generation !== undefined) video.generation = options.generation;
      video.empty = options.empty ?? false;
      pendingReads.get(id)!(sequence);
    },
    waitingForFrame(platform: Platform) { return [...pendingReads.keys()].some(id => id.startsWith(platform)); },
    streams(name?: string) { return calls.filter(call => name ? call.name === name : call.name.endsWith("_stream_session") || call.name === "mobile_ios_mirror_session"); },
  };
}
