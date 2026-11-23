import { DeviceInventory } from "../src/device-inventory.ts";
import { initialPanelDevice } from "../src/device-layout.ts";
import { DeviceWorkspace, resolvePaneDevice } from "../src/device-workspace.ts";
import type { PanelTarget } from "../../shared/src/panel-target.ts";
import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { setImmediate as flushTasks } from "node:timers/promises";
import type { App } from "@modelcontextprotocol/ext-apps";
import { PanelContext } from "../src/model-context.ts";
import { createSimulatorPanel } from "../src/simulator-panel.ts";
import { getDeviceSettings } from "../src/device-settings.ts";
import { getScreenAnnotations } from "../src/screen-annotations.ts";
import type { PhysicalIosDevice } from "../../shared/src/ios-devices.ts";
import type { SimulatorDevice } from "../../shared/src/protocol.ts";
import type { AndroidBookingNames, PhysicalAndroidDevice } from "../../shared/src/android-devices.ts";
import type { ScreenAnnotation } from "../../shared/src/screen-annotations.ts";
import type { ScreenshotAttachment } from "../src/model-context.ts";

const physicalBezel = { rect: { x: 27, y: 18, width: 400, height: 872 }, viewport: { width: 454, height: 908 }, clipRadius: 62, image: "data:image/png;base64,AQID", mask: "data:image/png;base64,BAUG" };

class Element extends EventTarget {
  hidden = false;
  disabled = false;
  textContent = "";
  title = "";
  value = "";
  dataset: Record<string, string> = {};
  style = { setProperty() {} };
  width = 0;
  height = 0;
  clientWidth = 300;
  clientHeight = 600;
  children: Element[] = [];
  elements = new Map<string, Element>();
  buttons: Element[] = [];
  captures = new Set<number>();
  draws = 0;
  append(child: Element) { this.children.push(child); if (this.children.length === 1) this.value = child.value; }
  prepend(child: Element) { this.children.unshift(child); }
  replaceChildren() { this.children = []; this.value = ""; }
  removeAttribute() {}
  getContext() { return { drawImage: () => { this.draws++; } }; }
  toDataURL() { return "data:image/png;base64,AA=="; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 150, height: 300 }; }
  setPointerCapture(id: number) { this.captures.add(id); }
  hasPointerCapture(id: number) { return this.captures.has(id); }
  releasePointerCapture(id: number) { this.captures.delete(id); }
  focus() {}
  querySelector(selector: string) {
    const element = selector.match(/data-element="([^"]+)"/)?.[1];
    if (element) return this.elements.get(element);
    return this.buttons.find(button => button.dataset.button === selector.match(/data-button="([^"]+)"/)?.[1]);
  }
  querySelectorAll() { return this.buttons; }
}

function createPanelRoot() {
  const root = new Element();
  for (const name of ["settings", "screen", "device-frame", "stage", "device-bezel", "screenshot", "notice", "notice-message", "empty", "empty-description", "stopped", "start-device", "screenshot-status"]) root.elements.set(name, new Element());
  root.elements.get("device-frame")!.hidden = true;
  for (const button of ["home", "app-switcher"]) { const element = new Element(); element.dataset.button = button; root.buttons.push(element); }
  return root;
}

function fixture(t: TestContext) {
  const calls: { name: string; arguments: Record<string, unknown> }[] = [];
  const reads = new Set<string>();
  const pendingReads = new Map<string, (sequence: number) => void>();
  const closed: string[] = [];
  const selections: { platform: string; active?: boolean }[] = [];
  const screenshots: ScreenshotAttachment[] = [];
  const attachedAnnotations: ScreenAnnotation[] = [];
  let screenshotCopied = true;
  let screenshotAttachmentError = "";
  let screenshotEncodingError = "";
  let sessionNumber = 0;
  let delayedOpen: Promise<void> | undefined;
  let blockedIos = false;
  let stopped = false;
  let physicalDevices: PhysicalIosDevice[] = [];
  let physicalError = "";
  let physicalCaptureError = "";
  let physicalInputBusy = false;
  let simulatorError = "";
  let delayedDiscovery: Promise<void> | undefined;
  let androidDevices: SimulatorDevice[] | undefined;
  let iosDevices: SimulatorDevice[] | undefined;
  let bookingNames: AndroidBookingNames | undefined;
  const stoppedPlatforms = new Set<string>();
  let failedInputPlatform: "ios" | "android" | undefined;
  let inspectionFailure = false;
  let androidAccessibility: { tree: unknown; screen: { width: number; height: number } } | undefined;
  let observeFrames = true;
  let invalidFrame = false;
  let androidGeneration = 1;
  let emptyAndroidFrame = false;
  let failAndroidDecode = false;
  let initialFramesHeld = false;
  const document = Object.assign(new EventTarget(), { visibilityState: "visible", createElement: () => new Element() });
  class Decoder {
    state = "configured";
    decodeQueueSize = 0;
    output: (frame: object) => void;
    error: (error: Error) => void;
    constructor(options: { output: (frame: object) => void; error: (error: Error) => void }) { this.output = options.output; this.error = options.error; }
    static async isConfigSupported() { return { supported: true }; }
    configure() {}
    decode() {
      if (failAndroidDecode) { failAndroidDecode = false; this.error(new Error("Decoder recovery")); return; }
      this.output({ displayWidth: 400, displayHeight: 800, close() {} });
    }
    close() { this.state = "closed"; }
  }
  const globals = {
    document, window: new EventTarget(),
    ResizeObserver: class { observe() {} disconnect() {} },
    getComputedStyle: () => ({ paddingLeft: "16", paddingRight: "16", paddingTop: "16", paddingBottom: "16" }),
    Option: class extends Element { constructor(text: string, value = "") { super(); this.textContent = text; this.value = value; } },
    VideoDecoder: Decoder, EncodedVideoChunk: class {},
    requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0),
    cancelAnimationFrame: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    OffscreenCanvas: class {
      width: number;
      height: number;
      constructor(width: number, height: number) { this.width = width; this.height = height; }
      getContext() { return { fillStyle: "", fillRect() {}, drawImage() {} }; }
      async convertToBlob() {
        if (screenshotEncodingError) throw new Error(screenshotEncodingError);
        const bytes = new Uint8Array([255, 216, 255, 217]);
        return new Blob([bytes], { type: "image/jpeg" });
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
  function frameResult(uri: string, id: string, sequence: number) {
    const serverPreparedAt = performance.timeOrigin + performance.now();
    const physical = uri.startsWith("ios-video:");
    const result = { contents: physical
      ? [{ uri, mimeType: "application/json", text: JSON.stringify({ generation: 1, sequence, dropped: 0, configuration: { revision: 1, width: 400, height: 800, codec: "hvc1.1.6.L150.B0", description: "AQ==" }, frames: [{ sequence, data: "AA==", timestamp: 0, key: true }] }) }]
      : id.startsWith("ios")
      ? [{ uri, mimeType: "image/jpeg", blob: "AA==", _meta: { sequence: invalidFrame ? 0 : sequence, receivedAt: Date.now(), bytes: 1, serverWaitMs: 0, serverStartedAt: serverPreparedAt, serverPreparedAt } }]
      : [{ uri, mimeType: "application/json", text: JSON.stringify({ sequence, generation: androidGeneration, packets: emptyAndroidFrame ? [] : [{ sequence, data: Buffer.from([0, 0, 0, 1, 0x67, 0x64, 0, 0x28, 0, 0, 0, 1, 0x65, 1]).toString("base64") }] }) }] };
    invalidFrame = false;
    emptyAndroidFrame = false;
    if (observeFrames) window.dispatchEvent(Object.assign(new Event("message"), { data: { jsonrpc: "2.0", result }, source: undefined }));
    return result;
  }
  async function waitForOpen(timeout: number | undefined) {
    if (delayedOpen === undefined) return;
    const deadline = Promise.withResolvers<void>();
    const timer = setTimeout(() => {
      const error = new Error("Request timed out");
      deadline.reject(error);
    }, timeout);
    try { await Promise.race([delayedOpen, deadline.promise]); }
    finally { clearTimeout(timer); }
  }
  const app = {
    async callServerTool(call: { name: string; arguments: Record<string, unknown> }, options: { timeout?: number } = {}) {
      calls.push(call);
      if (call.name === "mobile_list_android_devices") {
        await delayedDiscovery;
        if (androidDevices) return { content: [], structuredContent: { connected: true, devices: androidDevices }, _meta: { bookingNames } };
      }
      if (call.name === "mobile_list_ios_devices") {
        await delayedDiscovery;
        if (physicalError) return { isError: true, content: [{ type: "text", text: physicalError }] };
        return { content: [], structuredContent: { physicalDevices } };
      }
      if (call.name === "mobile_list_simulators" && iosDevices) return { content: [], structuredContent: { connected: true, devices: iosDevices } };
      if (call.name === "mobile_list_simulators" && simulatorError) return { isError: true, content: [{ type: "text", text: simulatorError }] };
      const inputTool = failedInputPlatform === "android" ? "mobile_android_stream_input" : "mobile_stream_input";
      if (failedInputPlatform && call.name === inputTool) {
        failedInputPlatform = undefined;
        return { isError: true, content: [{ type: "text", text: "Input disconnected" }], _meta: { streamDisconnected: true } };
      }
      if (call.name === "mobile_ios_mirror_input" && physicalInputBusy) {
        physicalInputBusy = false;
        return { isError: true, content: [{ type: "text", text: "Another panel is currently touching this iPhone." }], _meta: { inputBusy: true, streamDisconnected: false } };
      }
      if (call.name === "mobile_ios_mirror_session") {
        if (physicalCaptureError) return { isError: true, content: [{ type: "text", text: physicalCaptureError }] };
        const id = `physical-${++sessionNumber}`;
        await waitForOpen(options.timeout);
        return { content: [], _meta: { bezel: physicalBezel, sessionId: id, frameUri: `ios-video://mobile-dev/${id}/video` }, structuredContent: { name: "Physical iPhone" } };
      }
      if (call.name.endsWith("_stream_session")) {
        const android = call.name.includes("android");
        const id = `${android ? "android" : "ios"}-${++sessionNumber}`;
        await waitForOpen(options.timeout);
        return { content: [], _meta: { sessionId: id, frameUri: android ? `stream://mobile-dev/${id}/frame` : `mobile-frame://${id}/latest` }, structuredContent: {
          definition: { screen: { rect: { width: 390, height: 844 } } },
          inputStatus: { state: !android && blockedIos ? "blocked" : "ready" },
        } };
      }
      if (call.name.endsWith("_stream_close") || call.name === "mobile_ios_mirror_close") closed.push(call.arguments.sessionId as string);
      const callPlatform = call.name.includes("android") ? "android" : "ios";
      if (call.name.startsWith("mobile_boot")) { stopped = false; stoppedPlatforms.delete(callPlatform); }
      if (call.name.startsWith("mobile_shutdown")) stoppedPlatforms.add(callPlatform);
      if (call.name.startsWith("mobile_list") || call.name.startsWith("mobile_boot") || call.name.startsWith("mobile_shutdown")) {
        const android = call.name.includes("android");
        return { content: [], structuredContent: { connected: true, devices: [{ udid: android ? (stoppedPlatforms.has("android") ? "avd:Pixel" : "emulator-5554") : "iphone-1", name: android ? "Pixel" : "iPhone", state: stopped || stoppedPlatforms.has(callPlatform) ? "Shutdown" : "Booted", runtime: "", platform: android ? "android" : "ios" }] } };
      }
      if (call.name === "mobile_device_settings" || call.name === "mobile_update_device_setting") return { content: [], structuredContent: { settings: { appearance: "dark", locationSupported: true } } };
      if (call.name === "mobile_inspect_ui") {
        if (inspectionFailure) return { isError: true, content: [{ type: "text", text: "Inspection unavailable" }] };
        return { content: [], structuredContent: { runtime: { available: true }, tree: [{ source: "react-native", name: "Continue", role: "Pressable", bounds: { x: 10, y: 20, width: 100, height: 100 }, nodeId: "node-0", depth: 0 }] } };
      }
      if (call.name === "mobile_android_describe_ui" && androidAccessibility) return { content: [], structuredContent: androidAccessibility };
      if (call.name.endsWith("_describe_ui")) return { content: [], structuredContent: { tree: { elements: [{ label: "Continue", role: "AXButton", frame: { x: 10, y: 20, width: 100, height: 100 } }] } } };
      if (call.name.endsWith("_capture_screenshot")) return {
        content: [{ type: "image", mimeType: "image/png", data: call.arguments.image ?? "AA==" }],
        structuredContent: { copied: screenshotCopied, ...(screenshotCopied ? {} : { clipboardError: "Clipboard unavailable" }) },
      };
      return { content: [] };
    },
    async readServerResource({ uri }: { uri: string }, { signal }: { signal: AbortSignal }) {
      const address = new URL(uri);
      const id = address.protocol === "mobile-frame:" ? address.hostname : address.pathname.split("/")[1];
      if (!reads.has(id)) {
        reads.add(id);
        if (initialFramesHeld === false) return frameResult(uri, id, 1);
      }
      return new Promise((resolve, reject) => {
        const abort = () => { pendingReads.delete(id); reject(new Error("Aborted")); };
        pendingReads.set(id, sequence => { pendingReads.delete(id); signal.removeEventListener("abort", abort); resolve(frameResult(uri, id, sequence)); });
        if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
      });
    },
  } as unknown as App;
  const panels = (["ios", "android"] as const).map(platform => {
    const root = createPanelRoot();
    const panelContext = {
      canAttach: true, canAttachScreenshots: true, screenAnnotations: attachedAnnotations, subscribe: () => () => {},
      async attachScreenshot(screenshot: ScreenshotAttachment) {
        if (screenshotAttachmentError) throw new Error(screenshotAttachmentError);
        screenshots.push(screenshot);
        return true;
      },
      async attachAnnotation(annotation: ScreenAnnotation) { attachedAnnotations.push(annotation); return true; },
    } as unknown as PanelContext;
    const inventory = new DeviceInventory(app, platform);
    const panel = createSimulatorPanel(app, root as unknown as HTMLElement, inventory, panelContext, () => selections.push({ platform, active: true }));
    panel.setAvailable(true);
    let last: SimulatorDevice | undefined;
    let target: PanelTarget | undefined;
    const sync = () => {
      const devices = inventory.status?.devices ?? [];
      const device = last ? resolvePaneDevice(devices, last, platform) : initialPanelDevice(devices, platform, undefined, target);
      if (device) last = device;
      panel.acceptDevice(device);
    };
    inventory.subscribe(sync);
    const picker = {
      get value() { return panel.selected?.udid ?? ""; },
      getSnapshot() { return { items: inventory.items, value: panel.selected?.udid }; },
      refresh: () => inventory.refresh(),
      choose(id: string) {
        const device = inventory.status?.devices.find(item => item.udid === id);
        last = device;
        panel.acceptDevice(device);
        if (device?.state === "Shutdown") void panel.start();
      },
      async stopDevice(id: string) {
        const option = inventory.items.find(item => item.value === id);
        if (option?.canStop) await panel.stop();
      },
    };
    return { panel, picker, inventory, root, element: (name: string) => root.elements.get(name)!,
      load(opening?: PanelTarget) {
        if (opening) { target = opening; last = undefined; }
        return inventory.refresh();
      },
    };
  });
  let activeDevice: SimulatorDevice | undefined;
  const context = { screenAnnotations: [], subscribe: () => () => {}, selectSimulators(_devices: SimulatorDevice[], active?: SimulatorDevice) { activeDevice = active; } } as unknown as PanelContext;
  const workspace = new DeviceWorkspace(app, { context, deviceApps: { selectDevice() {} } } as ConstructorParameters<typeof DeviceWorkspace>[1]);
  t.after(async () => {
    await workspace.dispose();
    for (const { panel } of panels) await panel.dispose();
    for (const reset of restore) reset();
  });
  return { workspace, get activeDevice() { return activeDevice; }, setIosDevices(devices: SimulatorDevice[]) { iosDevices = devices; }, calls, closed, selections, failInspection() { inspectionFailure = true; }, setAndroidAccessibility(value: NonNullable<typeof androidAccessibility>) { androidAccessibility = value; }, screenshots, attachedAnnotations, ios: panels[0], android: panels[1], failClipboard() { screenshotCopied = false; }, setAndroidDevices(devices: SimulatorDevice[], names?: AndroidBookingNames) { androidDevices = devices; bookingNames = names; }, setPhysicalDevices(devices: PhysicalIosDevice[]) { physicalDevices = devices; }, failDiscovery(message: string) { physicalError = message; }, failSimulators(message: string) { simulatorError = message; }, delayDiscovery(value: Promise<void>) { delayedDiscovery = value; }, failInput(platform: "ios" | "android") { failedInputPlatform = platform; }, delayOpen(value: Promise<void>) { delayedOpen = value; }, blockIos() { blockedIos = true; }, stopDevices() { stopped = true; },
    visibility(value: string) { document.visibilityState = value; document.dispatchEvent(new Event("visibilitychange")); },
    frame(platform: "ios" | "android", sequence: number, options: { generation?: number; empty?: boolean } = {}) {
      const id = [...pendingReads.keys()].find(id => id.startsWith(platform)); assert.ok(id);
      if (options.generation !== undefined) androidGeneration = options.generation;
      emptyAndroidFrame = options.empty ?? false;
      pendingReads.get(id)!(sequence);
    },
    waitingForFrame(platform: "ios" | "android") { return [...pendingReads.keys()].some(id => id.startsWith(platform)); },
    holdInitialFrames() { initialFramesHeld = true; },
    failAndroidDecode() { failAndroidDecode = true; },
    missTiming() { observeFrames = false; }, invalidFrame() { invalidFrame = true; },
    failPhysicalCapture(message: string) { physicalCaptureError = message; },
    busyPhysicalInput() { physicalInputBusy = true; },
    failScreenshotEncoding(message: string) { screenshotEncodingError = message; },
    failScreenshotAttachment(message: string) { screenshotAttachmentError = message; },
  };
}

const physicalPhone: PhysicalIosDevice = {
  udid: "00008110-000A0B1C2D3E4000", coreDeviceId: "11111111-1111-4111-8111-111111111111",
  name: "Physical iPhone", model: "iPhone 17 Pro", productType: "iPhone18,1", state: "connected", runtime: "iOS 27.0",
  platform: "ios", kind: "physical", transportType: "localNetwork", pairingState: "paired",
};

const androidPhone: PhysicalAndroidDevice = {
  udid: "phone-serial", name: "Pixel 9", model: "Pixel 9", state: "Booted", runtime: "Android",
  platform: "android", kind: "physical", transportType: "wired",
};

for (const inputFirst of [false, true]) test(`opening an exact Android target waits for the host and intent, input first: ${inputFirst}`, async t => {
  const f = fixture(t);
  const target = { platform: "android", kind: "physical", deviceId: androidPhone.udid } as const;
  f.setAndroidDevices([androidPhone]);
  if (inputFirst) await f.workspace.open(target);
  else await f.workspace.setAvailable(true);
  assert.equal(f.calls.length, 0);
  if (inputFirst) await f.workspace.setAvailable(true);
  else await f.workspace.open(target);
  const panes = f.workspace.getSnapshot().panes;
  assert.deepEqual(panes.map(pane => pane.device?.udid), [androidPhone.udid]);
});

test("missing exact target remains unselected through refreshes, then connects when it arrives", async t => {
  const f = fixture(t);
  await f.ios.load({ platform: "ios", kind: "physical", deviceId: physicalPhone.udid });
  assert.equal(f.ios.panel.selected, undefined);
  const emptyState = f.ios.element("empty");
  assert.equal(emptyState.textContent, "Device unavailable");
  const picker = f.ios.picker;
  await picker.refresh();
  const initialStreams = f.calls.filter(call => call.name === "mobile_stream_session" || call.name === "mobile_ios_mirror_session");
  assert.equal(initialStreams.length, 0);
  f.setPhysicalDevices([physicalPhone]);
  await picker.refresh();
  await waitFor(() => f.calls.some(call => call.name === "mobile_ios_mirror_session"));
  assert.equal(f.ios.panel.selected?.udid, physicalPhone.udid);
  f.setPhysicalDevices([]);
  await picker.refresh();
  assert.equal(f.ios.panel.selected, undefined, "Disconnecting the requested phone does not select a simulator.");
  picker.choose("iphone-1");
  await waitFor(() => f.calls.some(call => call.name === "mobile_stream_session"));
  await picker.refresh();
  assert.equal(f.ios.panel.selected?.udid, "iphone-1");
});

test("manual same-platform and mixed selections survive repeated opening notifications", async t => {
  const f = fixture(t);
  f.setPhysicalDevices([physicalPhone]);
  f.setAndroidDevices([androidPhone]);
  await f.workspace.open({});
  await f.workspace.setAvailable(true);
  const [first] = f.workspace.getSnapshot().panes;
  assert.equal(first.device?.udid, "iphone-1");
  f.workspace.toggle("ios", physicalPhone);
  f.workspace.toggle("android", androidPhone);
  await f.workspace.open({ platform: "android" });
  const panes = f.workspace.getSnapshot().panes;
  assert.deepEqual(panes.map(pane => pane.device?.udid), ["iphone-1", physicalPhone.udid, androidPhone.udid]);
  f.workspace.activate(first.key);
  f.workspace.toggle("ios", physicalPhone);
  assert.equal(f.workspace.getSnapshot().active, first.key);
  assert.deepEqual(f.workspace.getSnapshot().panes.map(pane => pane.key), [first.key, panes[2].key]);
});

test("targeted stopped AVD opens without booting and tracks its running serial after boot", async t => {
  const f = fixture(t);
  f.setAndroidDevices([{ udid: "avd:Pixel", name: "Pixel", state: "Shutdown", runtime: "Android", platform: "android", kind: "emulator" }]);
  await f.android.load({ platform: "android", kind: "emulator", deviceId: "avd:Pixel" });
  assert.equal(f.android.panel.selected?.state, "Shutdown");
  const startButton = f.android.element("start-device");
  assert.equal(startButton.disabled, false);
  const lifecycle = f.calls.filter(call => call.name.startsWith("mobile_boot"));
  assert.equal(lifecycle.length, 0);
  const picker = f.android.picker;
  f.setAndroidDevices([]);
  await picker.refresh();
  assert.equal(f.android.panel.selected, undefined);
  f.setAndroidDevices([{ udid: "emulator-5554", name: "Pixel", state: "Booted", runtime: "Android", platform: "android", kind: "emulator" }]);
  await picker.refresh();
  assert.equal(f.android.panel.selected?.udid, "emulator-5554");
  await picker.refresh();
  assert.equal(f.android.panel.selected?.udid, "emulator-5554");
});

test("two same-platform screens and an Android screen route input independently and release only the removed stream", async t => {
  const f = fixture(t);
  const iphone: SimulatorDevice = { udid: "iphone-1", name: "iPhone", runtime: "iOS", state: "Booted" };
  const ipad = { ...iphone, udid: "ipad-2", name: "iPad" };
  f.setIosDevices([iphone, ipad]);
  f.setAndroidDevices([androidPhone]);
  await f.workspace.setAvailable(true);
  await f.workspace.open({});
  f.workspace.toggle("ios", ipad);
  f.workspace.toggle("android", androidPhone);
  const { panes, active } = f.workspace.getSnapshot();
  const split = panes.map(pane => pane.key);
  f.workspace.setDockSelection(split, active!);
  const screens = panes.map(pane => {
    const root = createPanelRoot();
    const unmount = f.workspace.mount(pane.key, root as unknown as HTMLElement)!;
    return { root, unmount };
  });
  await waitFor(() => screens.every(screen => screen.root.elements.get("screen")!.draws > 0));
  const open = f.calls.filter(call => call.name.endsWith("_stream_session"));
  assert.deepEqual(open.map(call => call.arguments.udid ?? call.arguments.deviceId), [iphone.udid, ipad.udid, androidPhone.udid]);
  for (const screen of screens) dispatch(screen.root.buttons[0], "click");
  await waitFor(() => f.calls.filter(call => call.name.endsWith("_stream_input")).length === 3);
  const inputs = f.calls.filter(call => call.name.endsWith("_stream_input"));
  assert.equal(new Set(inputs.map(call => call.arguments.sessionId)).size, 3);
  dispatch(screens[0].root, "pointerdown");
  assert.equal(f.activeDevice?.udid, iphone.udid);
  f.workspace.toggle("ios", ipad);
  screens[1].unmount();
  await waitFor(() => f.closed.length === 1);
  assert.equal(f.closed[0], inputs[1].arguments.sessionId);
  assert.equal(f.activeDevice?.udid, iphone.udid);
  assert.equal(f.calls.some(call => call.name.startsWith("mobile_shutdown")), false);
  screens[0].unmount();
  screens[2].unmount();
});

test("background tabs suspend their streams and visible splits survive tab switches", async t => {
  const f = fixture(t);
  const iphone: SimulatorDevice = { udid: "iphone-1", name: "iPhone", runtime: "iOS", state: "Booted" };
  const ipad = { ...iphone, udid: "ipad-2", name: "iPad" };
  f.setIosDevices([iphone, ipad]);
  f.setAndroidDevices([androidPhone]);
  await f.workspace.setAvailable(true);
  await f.workspace.open({});
  f.workspace.toggle("ios", ipad);
  f.workspace.toggle("android", androidPhone);
  const [phone, tablet, android] = f.workspace.getSnapshot().panes;
  f.workspace.setDockSelection([phone.key, android.key], android.key);
  for (const pane of [phone, tablet, android]) {
    const root = createPanelRoot();
    f.workspace.mount(pane.key, root as unknown as HTMLElement);
  }
  const sessions = () => f.calls.filter(call => call.name.endsWith("_stream_session"));
  await waitFor(() => sessions().length === 2);
  assert.deepEqual(sessions().map(call => call.arguments.udid ?? call.arguments.deviceId), [iphone.udid, androidPhone.udid]);

  f.workspace.setDockSelection([tablet.key, android.key], tablet.key);
  await f.workspace.inventory.ios.refresh();
  await waitFor(() => f.closed.length === 1 && sessions().length === 3);
  assert.equal(sessions()[2].arguments.udid, ipad.udid);
  assert.equal(f.activeDevice?.udid, ipad.udid);
  f.workspace.setDockSelection([android.key, tablet.key], android.key);
  await f.workspace.inventory.ios.refresh();
  assert.equal(f.activeDevice?.udid, androidPhone.udid);
  assert.equal(sessions().length, 3);
  assert.equal(f.closed.length, 1);
});

test("late discovery cannot overwrite a manual selection", async t => {
  const f = fixture(t);
  const discovery = Promise.withResolvers<void>();
  f.delayDiscovery(discovery.promise);
  await f.workspace.setAvailable(true);
  const opening = f.workspace.open({ platform: "android" });
  f.workspace.toggle("ios", physicalPhone);
  discovery.resolve();
  await opening;
  assert.deepEqual(f.workspace.getSnapshot().panes.map(pane => pane.last.udid), [physicalPhone.udid]);
});

test("an exact Android target keeps the same AVD selected through Stop and Start", async t => {
  const f = fixture(t);
  await f.android.load({ platform: "android", kind: "emulator", deviceId: "emulator-5554" });
  const picker = f.android.picker;
  await picker.stopDevice("emulator-5554");
  assert.equal(f.android.panel.selected?.udid, "avd:Pixel");
  const startButton = f.android.element("start-device");
  assert.equal(startButton.disabled, false);
  dispatch(startButton, "click");
  await waitFor(() => f.android.panel.selected?.state === "Booted" && startButton.disabled);
  await picker.refresh();
  assert.equal(f.android.panel.selected?.udid, "emulator-5554");
});

test("disposing the workspace before host readiness does not start device work", async t => {
  const f = fixture(t);
  await f.workspace.open({ platform: "android" });
  await f.workspace.dispose();
  await f.workspace.setAvailable(true);
  assert.equal(f.calls.length, 0);
});

test("physical Android devices appear above emulators and stream without emulator lifecycle calls", async t => {
  const f = fixture(t);
  f.setAndroidDevices([
    { udid: "emulator-5554", name: "Pixel AVD", state: "Booted", runtime: "Android", platform: "android", kind: "emulator" },
    androidPhone,
  ]);
  await f.android.load();
  const picker = f.android.picker;
  const state = picker.getSnapshot();
  const groups = state.items.map(item => item.group);
  assert.deepEqual(groups, ["Connected devices", "Emulators"]);
  assert.equal(state.items[0].label, "Pixel 9 · USB");
  assert.equal(state.items[0].canStop, false);
  picker.choose(androidPhone.udid);
  await waitFor(() => {
    return f.android.panel.selected?.udid === androidPhone.udid && f.android.element("screen").draws > 0;
  });
  const session = f.calls.findLast(call => call.name === "mobile_android_stream_session");
  assert.deepEqual(session?.arguments, { deviceId: androidPhone.udid });
  assert.equal(f.android.element("screenshot").disabled, false);
  for (const button of f.android.root.buttons) {
    assert.equal(button.disabled, false);
    assert.equal(button.dataset.unsupported, "false");
  }
  assert.equal(f.android.root.buttons[0].title, "Home");
  assert.equal(f.android.root.buttons[1].title, "App switcher");
  await picker.stopDevice(androidPhone.udid);
  const lifecycle = f.calls.filter(call => call.name.startsWith("mobile_boot") || call.name.startsWith("mobile_shutdown"));
  assert.equal(lifecycle.length, 0);
  f.setAndroidDevices([{ ...androidPhone, transportType: "localNetwork" }]);
  await picker.refresh();
  const wireless = picker.getSnapshot();
  assert.equal(wireless.value, androidPhone.udid);
  assert.equal(wireless.items[0].label, "Pixel 9 · Wi-Fi");
});

test("opening an ADC serial streams that device even with another phone of the same model", async t => {
  const f = fixture(t);
  const adcPhone: PhysicalAndroidDevice = { ...androidPhone, udid: "127.0.0.1:15555", transportType: "localNetwork" };
  f.setAndroidDevices([androidPhone, adcPhone]);
  await f.workspace.setAvailable(true);
  await f.workspace.open({ platform: "android", deviceId: adcPhone.udid });
  const [pane] = f.workspace.getSnapshot().panes;
  assert.equal(pane.device?.udid, adcPhone.udid);
  const root = createPanelRoot();
  f.workspace.mount(pane.key, root as unknown as HTMLElement);
  await waitFor(() => root.elements.get("screen")!.draws > 0);
  const streams = f.calls.filter(call => call.name === "mobile_android_stream_session");
  const targets = streams.map(call => call.arguments);
  assert.deepEqual(targets, [{ deviceId: adcPhone.udid }]);
});

test("the Android picker shows an ADC booking name above the device specs for the active connection", async t => {
  const f = fixture(t);
  const name = "Test checkout on Android";
  const model = "ADC Android 14 2 CPU 3 GiB RAM";
  const device: PhysicalAndroidDevice = { ...androidPhone, udid: "127.0.0.1:15555", name: model, model, transportType: "localNetwork" };
  f.setAndroidDevices([device], { [device.udid]: name });
  await f.android.load();
  const picker = f.android.picker;
  const option = picker.getSnapshot().items[0];
  assert.equal(option.label, name);
  assert.equal(option.detail, `${model} · Wi-Fi`);
  assert.equal(f.android.panel.selected?.name, model);
  f.setAndroidDevices([device]);
  await picker.refresh?.();
  const released = picker.getSnapshot().items[0];
  assert.equal(released.label, `${model} · Wi-Fi`);
  assert.equal(released.detail, "Wi-Fi");
});

for (const state of ["unauthorized", "offline"]) test(`physical Android ${state} devices remain discoverable without booting or streaming`, async t => {
  const f = fixture(t);
  f.setAndroidDevices([{ ...androidPhone, state }]);
  await f.android.load();
  const picker = f.android.picker;
  const snapshot = picker.getSnapshot();
  assert.equal(snapshot.items.length, 1);
  assert.equal(snapshot.items[0].running, false);
  assert.equal(snapshot.items[0].canStop, false);
  assert.match(snapshot.items[0].label, state === "unauthorized" ? /Unauthorized/ : /Offline/);
  picker.choose(androidPhone.udid);
  await waitFor(() => {
    return f.android.panel.selected?.udid === androidPhone.udid;
  });
  assert.equal(f.android.element("start-device").disabled, true);
  assert.equal(f.android.element("screenshot").disabled, true);
  const actions = f.calls.filter(call => call.name.startsWith("mobile_boot") || call.name.endsWith("_stream_session"));
  assert.equal(actions.length, 0);
  f.setAndroidDevices([androidPhone]);
  await picker.refresh();
  await waitFor(() => f.android.element("screen").draws > 0);
});

test("Android stream opening waits through device boot and backend readiness", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(t);
  let release!: () => void;
  const opening = new Promise<void>(resolve => { release = resolve; });
  f.delayOpen(opening);
  await f.android.load();
  t.mock.timers.tick(155000);
  await flushTasks();
  const notice = f.android.element("notice");
  assert.equal(notice.hidden, true, "Booting must not report a stream request timeout.");
  release();
  await flushTasks();
  t.mock.timers.tick(0);
  await flushTasks();
  const screen = f.android.element("screen");
  assert.ok(screen.draws > 0);
  const streams = f.calls.filter(call => call.name === "mobile_android_stream_session");
  assert.equal(streams.length, 1);
});

test("Android refresh connects an arriving phone once and closes its stream when it disconnects", async t => {
  const f = fixture(t);
  f.setAndroidDevices([]);
  await f.android.load();
  const picker = f.android.picker;
  f.setAndroidDevices([androidPhone]);
  await picker.refresh();
  await waitFor(() => f.android.element("screen").draws > 0);
  await picker.refresh();
  const streams = f.calls.filter(call => call.name === "mobile_android_stream_session");
  assert.equal(streams.length, 1);
  assert.equal(f.android.panel.selected?.udid, androidPhone.udid);
  f.setAndroidDevices([]);
  await picker.refresh();
  await waitFor(() => f.closed.length === 1);
  assert.equal(f.android.panel.selected, undefined);
  assert.equal(f.android.root.buttons[0].disabled, true);
  const lifecycle = f.calls.filter(call => call.name.startsWith("mobile_boot") || call.name.startsWith("mobile_shutdown"));
  assert.equal(lifecycle.length, 0);
});

test("physical iOS devices mirror above simulators and route touches to their own session", async t => {
  const f = fixture(t);
  f.setPhysicalDevices([physicalPhone]);
  await f.ios.load();
  const picker = f.ios.picker;
  const state = picker.getSnapshot();
  const items = state.items;
  const groups = items.map(item => item.group);
  assert.deepEqual(groups, ["Connected devices", "Simulators"]);
  assert.equal(items[0].label, "Physical iPhone · Wi-Fi");
  assert.equal(items[0].statusLabel, "Connected");
  assert.equal(items[0].canStop, false);
  const previousStreams = f.calls.filter(call => call.name === "mobile_stream_session");
  picker.choose(physicalPhone.udid);
  await waitFor(() => {
    return f.ios.panel.selected?.kind === "physical";
  });
  const empty = f.ios.element("empty");
  const description = f.ios.element("empty-description");
  const start = f.ios.element("start-device");
  const screenshot = f.ios.element("screenshot");
  await waitFor(() => f.ios.element("device-frame").hidden === false);
  const frame = f.ios.element("device-frame");
  const image = f.ios.element("device-bezel");
  const screen = f.ios.element("screen");
  assert.equal(frame.dataset.bezel, "true");
  assert.equal(image.hidden, false);
  assert.equal(Reflect.get(image, "src"), physicalBezel.image);
  assert.equal(Reflect.get(screen.style, "maskImage"), `url("${physicalBezel.mask}")`);
  const physicalStreams = f.calls.filter(call => call.name === "mobile_ios_mirror_session");
  assert.equal(physicalStreams.length, 1);
  assert.equal(physicalStreams[0].arguments.udid, physicalPhone.udid);
  assert.equal(start.disabled, true);
  assert.equal(screenshot.disabled, false);
  const disabledButtons = f.ios.root.buttons.every(button => button.disabled);
  const boots = f.calls.filter(call => call.name.startsWith("mobile_boot"));
  const streams = f.calls.filter(call => call.name === "mobile_stream_session");
  assert.equal(disabledButtons, true);
  for (const button of f.ios.root.buttons) assert.equal(button.dataset.unsupported, "true");
  assert.equal(f.ios.root.buttons[0].title, "Home is unavailable on physical iOS devices");
  assert.equal(f.ios.root.buttons[1].title, "App switcher is unavailable on physical iOS devices");
  dispatch(screen, "pointerdown", { pointerId: 1, button: 0, clientX: 75, clientY: 150 });
  dispatch(screen, "pointermove", { pointerId: 1, clientX: 90, clientY: 150 });
  dispatch(screen, "pointerup", { pointerId: 1 });
  await waitFor(() => {
    const physicalInput = f.calls.filter(call => call.name === "mobile_ios_mirror_input");
    const samples = physicalInput.flatMap(call => call.arguments.messages as { type: string }[]);
    return samples.some(sample => sample.type === "touch1-up");
  });
  const physicalInput = f.calls.filter(call => call.name === "mobile_ios_mirror_input");
  const samples = physicalInput.flatMap(call => call.arguments.messages as unknown[]);
  assert.deepEqual(samples, [
    { type: "touch1-down", x: 200, y: 400, width: 400, height: 800 },
    { type: "touch1-move", x: 240, y: 400, width: 400, height: 800 },
    { type: "touch1-up", x: 240, y: 400, width: 400, height: 800 },
  ]);
  assert.equal(physicalInput.every(call => call.arguments.generation === 1), true);
  assert.equal(boots.length, 0);
  assert.equal(streams.length, previousStreams.length);
  await picker.stopDevice(physicalPhone.udid);
  const shutdowns = f.calls.filter(call => call.name.startsWith("mobile_shutdown"));
  assert.equal(shutdowns.length, 0);
  f.setPhysicalDevices([{ ...physicalPhone, transportType: "wired" }]);
  await picker.refresh();
  assert.equal(picker.value, physicalPhone.udid);
  const wiredState = picker.getSnapshot();
  assert.equal(wiredState.items[0].label, "Physical iPhone · USB");
  const previousDraws = screen.draws;
  f.visibility("hidden");
  await waitFor(() => {
    const closedMirror = f.closed.some(id => id.startsWith("physical-"));
    return closedMirror;
  });
  f.visibility("visible");
  await waitFor(() => screen.draws > previousDraws);
  const resumedMirrors = f.calls.filter(call => call.name === "mobile_ios_mirror_session");
  const buttonsStillDisabled = f.ios.root.buttons.every(button => button.disabled);
  assert.equal(resumedMirrors.length, 2);
  assert.equal(buttonsStillDisabled, true);
  assert.equal(screenshot.disabled, false);
  const unavailablePhone = { ...physicalPhone, state: "unavailable" };
  Reflect.deleteProperty(unavailablePhone, "transportType");
  f.setPhysicalDevices([unavailablePhone]);
  await picker.refresh();
  const disconnectedState = picker.getSnapshot();
  const phonePresent = disconnectedState.items.some(item => item.value === physicalPhone.udid);
  assert.equal(phonePresent, false);
  picker.choose("iphone-1");
  await waitFor(() => {
    const buttonsEnabled = f.ios.root.buttons.every(button => !button.disabled);
    return f.ios.panel.selected?.kind !== "physical" && buttonsEnabled;
  });
  for (const button of f.ios.root.buttons) assert.equal(button.dataset.unsupported, "false");
  assert.equal(f.ios.root.buttons[0].title, "Home");
  assert.equal(f.ios.root.buttons[1].title, "App switcher");
});

test("another panel's held touch does not reconnect the physical video stream", async t => {
  const f = fixture(t);
  f.setPhysicalDevices([physicalPhone]);
  await f.ios.load();
  const picker = f.ios.picker;
  picker.choose(physicalPhone.udid);
  await waitFor(() => f.ios.element("screenshot").disabled === false);
  const screen = f.ios.element("screen");
  f.busyPhysicalInput();
  dispatch(screen, "pointerdown", { pointerId: 1, button: 0, clientX: 75, clientY: 150 });
  await waitFor(() => f.ios.element("notice-message").textContent.includes("Another panel"));
  assert.equal(screen.captures.size, 0);
  assert.equal(f.ios.element("screenshot").disabled, false);
  const mirrors = f.calls.filter(call => call.name === "mobile_ios_mirror_session");
  assert.equal(mirrors.length, 1);
  dispatch(screen, "pointerdown", { pointerId: 2, button: 0, clientX: 75, clientY: 150 });
  dispatch(screen, "pointerup", { pointerId: 2 });
  await waitFor(() => {
    const inputs = f.calls.filter(call => call.name === "mobile_ios_mirror_input");
    return inputs.length >= 2;
  });
});

test("physical iOS capture errors stay visible and clear when mirroring recovers", async t => {
  const f = fixture(t);
  f.setPhysicalDevices([physicalPhone]);
  await f.ios.load();
  await f.android.load();
  await waitFor(() => f.android.element("screen").draws > 0);
  const message = "A phone or VoIP call is currently in progress on the device.";
  f.failPhysicalCapture(message);
  const picker = f.ios.picker;
  picker.choose(physicalPhone.udid);
  await waitFor(() => f.ios.element("empty-description").textContent === message);
  assert.equal(f.ios.element("empty").hidden, false);
  assert.equal(f.ios.element("empty").textContent, "Screen unavailable");
  assert.equal(f.ios.element("empty-description").hidden, false);
  assert.equal(f.ios.element("device-frame").hidden, true);
  assert.equal(f.ios.element("screenshot").disabled, true);
  assert.equal(f.android.element("device-frame").hidden, false);
  f.failPhysicalCapture("");
  await waitFor(() => f.ios.element("device-frame").hidden === false);
  assert.equal(f.ios.element("empty").hidden, true);
  assert.equal(f.ios.element("notice").hidden, true);
  assert.equal(f.ios.element("screenshot").disabled, false);
});

test("screenshot attachment failures remain visible until the next action on both platforms", async t => {
  const f = fixture(t);
  f.holdInitialFrames();
  for (const platform of [f.ios, f.android]) {
    await platform.load();
    const screenshot = platform.element("screenshot");
    const notice = platform.element("notice");
    const message = platform.element("notice-message");
    await waitFor(() => screenshot.disabled === false);
    const devicePlatform = platform.panel.platform;
    await waitFor(() => f.waitingForFrame(devicePlatform));
    const screen = platform.element("screen");
    assert.equal(screen.draws, 0);
    const attached = f.screenshots.length;
    f.failScreenshotAttachment("MCP error -32000: Maximum call stack size exceeded");
    dispatch(screenshot, "click");
    await waitFor(() => notice.hidden === false && screenshot.disabled === false);
    assert.match(message.textContent, /screenshot.*not.*attached.*chat/i);
    assert.equal(f.screenshots.length, attached);
    f.frame(devicePlatform, 1);
    await waitFor(() => screen.draws > 0);
    assert.equal(notice.hidden, false);
    assert.match(message.textContent, /screenshot.*not.*attached.*chat/i);
    const picker = platform.picker;
    await picker.refresh();
    assert.equal(notice.hidden, false);
    assert.match(message.textContent, /screenshot.*not.*attached.*chat/i);
    f.failScreenshotAttachment("");
    dispatch(screenshot, "click");
    await waitFor(() => f.screenshots.length === attached + 1 && screenshot.disabled === false);
    assert.equal(notice.hidden, true);
    assert.equal(f.screenshots.at(-1)?.mimeType, "image/jpeg");
    assert.equal(f.screenshots.at(-1)?.data, "/9j/2Q==");
  }
});

test("JPEG encoding failures keep chat empty, show a notice and allow another screenshot", async t => {
  const f = fixture(t);
  await f.ios.load();
  const screenshot = f.ios.element("screenshot");
  await waitFor(() => screenshot.disabled === false);
  f.failScreenshotEncoding("JPEG encoder failed");
  dispatch(screenshot, "click");
  const notice = f.ios.element("notice");
  await waitFor(() => notice.hidden === false && screenshot.disabled === false);
  assert.equal(f.screenshots.length, 0);
  assert.match(f.ios.element("notice-message").textContent, /screenshot.*not.*attached.*chat/i);
  const capture = f.calls.find(call => call.name === "mobile_capture_screenshot");
  assert.ok(capture, "The original PNG is captured for the clipboard before JPEG encoding.");
  f.failScreenshotEncoding("");
  dispatch(screenshot, "click");
  await waitFor(() => f.screenshots.length === 1 && screenshot.disabled === false);
  assert.equal(notice.hidden, true);
  assert.equal(f.screenshots[0].mimeType, "image/jpeg");
});

test("physical iOS screenshots capture the displayed frame without a simulator backend", async t => {
  const f = fixture(t);
  f.setPhysicalDevices([physicalPhone]);
  f.failSimulators("Simulator backend unavailable");
  await f.ios.load();
  const screenshot = f.ios.element("screenshot");
  f.ios.root.elements.delete("screenshot-status");
  await waitFor(() => screenshot.disabled === false);
  dispatch(screenshot, "click");
  await waitFor(() => f.screenshots.length === 1);
  const captured = f.calls.find(call => call.name === "mobile_ios_mirror_capture_screenshot");
  assert.match(captured?.arguments.sessionId as string, /^physical-/);
  assert.equal(captured?.arguments.image, "AA==");
  assert.equal(f.screenshots[0].data, "/9j/2Q==");
  assert.equal(f.screenshots[0].mimeType, "image/jpeg");
  assert.equal(f.screenshots[0].simulator.udid, physicalPhone.udid);
  await waitFor(() => screenshot.disabled === false);
  f.failClipboard();
  dispatch(screenshot, "click");
  await waitFor(() => f.screenshots.length === 2);
  const simulatorCaptures = f.calls.filter(call => call.name === "mobile_capture_screenshot");
  assert.equal(simulatorCaptures.length, 0);
  f.visibility("hidden");
  assert.equal(screenshot.disabled, true);
  await f.ios.panel.dispose();
  assert.equal(screenshot.disabled, true);
});

test("physical iOS Select annotates screen regions in pixels without simulator accessibility or device input", async t => {
  const f = fixture(t);
  f.setPhysicalDevices([physicalPhone]);
  f.failSimulators("Simulator backend unavailable");
  await f.ios.load();
  const stage = f.ios.element("stage");
  const store = getScreenAnnotations(stage as unknown as HTMLElement);
  await waitFor(() => store.getSnapshot().disabled === false);
  await store.toggle();
  const state = store.getSnapshot();
  assert.equal(state.selecting, true);
  assert.equal(state.error, "");
  assert.deepEqual(state.capture?.screen, { width: 400, height: 800, units: "pixels" });
  const screen = f.ios.element("screen");
  dispatch(screen, "pointermove", { pointerId: 1, clientX: 75, clientY: 150 });
  assert.equal(store.getSnapshot().hovered, undefined);
  dispatch(screen, "pointerdown", { button: 0, pointerId: 1, clientX: 75, clientY: 150 });
  dispatch(screen, "pointerup", { button: 0, pointerId: 1, clientX: 75, clientY: 150 });
  const draft = store.getSnapshot().draft;
  assert.deepEqual(draft?.point, { x: 200, y: 400 });
  assert.equal(draft?.component.name, "Screen point");
  store.setText("Make this larger");
  await store.save();
  assert.equal(f.attachedAnnotations.length, 1);
  assert.equal(f.attachedAnnotations[0].simulator.udid, physicalPhone.udid);
  assert.equal(f.attachedAnnotations[0].screen.units, "pixels");
  dispatch(screen, "keydown", { key: "Escape", code: "Escape" });
  assert.equal(store.getSnapshot().selecting, false);
  dispatch(screen, "keydown", { key: "a", code: "KeyA" });
  const deviceInput = f.calls.filter(call => call.name === "mobile_ios_mirror_input");
  const accessibility = f.calls.filter(call => call.name.endsWith("_describe_ui") || call.name === "mobile_inspect_ui");
  assert.equal(deviceInput.length, 0);
  assert.equal(accessibility.length, 0);
  f.visibility("hidden");
  assert.equal(store.getSnapshot().disabled, true);
});

test("physical iOS Screenshot and Select wait for video and disable when the phone disconnects", async t => {
  const f = fixture(t);
  f.setPhysicalDevices([physicalPhone]);
  f.failSimulators("Simulator backend unavailable");
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  f.delayOpen(pending);
  await f.ios.load();
  const store = getScreenAnnotations(f.ios.element("stage") as unknown as HTMLElement);
  const screenshot = f.ios.element("screenshot");
  assert.equal(screenshot.disabled, true);
  assert.equal(store.getSnapshot().disabled, true);
  release();
  await waitFor(() => screenshot.disabled === false);
  assert.equal(store.getSnapshot().disabled, false);
  f.setPhysicalDevices([]);
  const picker = f.ios.picker;
  await picker.refresh();
  assert.equal(screenshot.disabled, true);
  assert.equal(store.getSnapshot().disabled, true);
});

test("physical discovery failure stays visible while simulator discovery remains usable", async t => {
  const f = fixture(t);
  f.failDiscovery("Physical discovery requires Xcode 27");
  await f.ios.load();
  assert.equal(f.ios.panel.selected?.udid, "iphone-1");
  const picker = f.ios.picker;
  await waitFor(() => f.ios.element("screen").draws > 0);
  const notice = f.ios.element("notice-message");
  assert.match(notice.textContent, /Physical discovery requires Xcode 27/);
  f.failDiscovery("");
  await picker.refresh();
  assert.equal(notice.textContent, "");
});

test("physical devices remain selectable when the simulator backend is unavailable", async t => {
  const f = fixture(t);
  f.setPhysicalDevices([physicalPhone]);
  f.failSimulators("Baguette unavailable");
  await f.ios.load();
  const picker = f.ios.picker;
  const state = picker.getSnapshot();
  assert.equal(state.value, physicalPhone.udid);
  const groups = state.items.map(item => item.group);
  assert.deepEqual(groups, ["Connected devices"]);
  assert.equal(f.ios.panel.selected?.kind, "physical");
  const sessions = f.calls.filter(call => call.name === "mobile_stream_session");
  assert.equal(sessions.length, 0);
});

test("discovery shares one poll per visible platform and stops on teardown", async t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const f = fixture(t);
  f.setPhysicalDevices([physicalPhone]);
  await f.workspace.open({});
  await f.workspace.setAvailable(true);
  f.workspace.toggle("ios", physicalPhone);
  const count = (name: string) => f.calls.filter(call => call.name === name).length;
  f.visibility("hidden");
  t.mock.timers.tick(3000);
  assert.equal(count("mobile_list_simulators"), 1);
  f.visibility("visible");
  const gate = Promise.withResolvers<void>();
  f.delayDiscovery(gate.promise);
  t.mock.timers.tick(3000);
  const reading = f.workspace.inventory.ios.refresh();
  assert.equal(count("mobile_list_simulators"), 2);
  assert.equal(count("mobile_list_android_devices"), 1);
  gate.resolve();
  await reading;
  await f.workspace.dispose();
  t.mock.timers.tick(10000);
  assert.equal(count("mobile_list_simulators"), 2);
});

async function waitFor(predicate: () => boolean) {
  const end = Date.now() + 2000;
  while (!predicate()) {
    assert.ok(Date.now() < end, "Panel did not reach the expected state");
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

test("missing timing observations do not disconnect valid iOS frames", async t => {
  const f = fixture(t); f.missTiming(); await f.ios.load();
  await waitFor(() => f.ios.element("screen").draws > 0);
  assert.equal(f.calls.filter(call => call.name === "mobile_stream_session").length, 1);
  assert.equal(f.closed.length, 0);
});

for (const platform of ["ios", "android"] as const) test(`leaving Select restores the latest ${platform} frame even when the device is quiet`, async t => {
  const f = fixture(t); const target = f[platform]; await target.load();
  await waitFor(() => target.element("screen").draws > 0);
  const store = getScreenAnnotations(target.element("stage") as unknown as HTMLElement);
  await store.toggle();
  f.frame(platform, 2);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(target.element("screen").draws, 1);
  store.exit();
  assert.equal(target.element("screen").draws, 2);
  assert.equal(f.closed.length, 0);
});

test("returning to a hidden chat reopens its streams and preserves the note input", async t => {
  const f = fixture(t); await Promise.all([f.ios.load(), f.android.load()]);
  await waitFor(() => f.ios.element("screen").draws > 0 && f.android.element("screen").draws > 0);
  const store = getScreenAnnotations(f.ios.element("stage") as unknown as HTMLElement);
  await store.toggle(); store.select({ x: 50, y: 40 }); store.setText("Keep this note");
  f.visibility("hidden");
  await waitFor(() => f.closed.length === 2);
  assert.equal(store.getSnapshot().draft?.text, "Keep this note");
  f.visibility("visible");
  await waitFor(() => f.ios.element("screen").draws > 1 && f.android.element("screen").draws > 1);
  assert.equal(f.calls.filter(call => call.name.endsWith("_stream_session")).length, 4);
  assert.equal(store.getSnapshot().draft?.text, "Keep this note");
  assert.equal(f.calls.some(call => call.name.startsWith("mobile_boot")), false);
});

test("a stopped receive loop retries when its chat becomes visible again", async t => {
  const f = fixture(t); f.invalidFrame(); await f.ios.load();
  await waitFor(() => f.ios.element("notice-message").textContent.includes("invalid frame metadata"));
  f.visibility("visible");
  await waitFor(() => f.ios.element("screen").draws > 0);
  assert.equal(f.calls.filter(call => call.name === "mobile_stream_session").length, 2);
});

test("status arriving during startup still connects the selected device", async t => {
  const f = fixture(t);
  const starting = f.ios.panel.resume();
  f.ios.inventory.apply({ connected: true, managed: true, baseUrl: "http://localhost/", devices: [{ udid: "iphone-1", name: "iPhone", state: "Booted", runtime: "" }] });
  await starting;
  await waitFor(() => f.ios.element("screen").draws > 0);
  assert.equal(f.ios.element("empty").hidden, true);
  assert.equal(f.calls.filter(call => call.name === "mobile_stream_session").length, 1);
  f.ios.inventory.apply({ connected: true, managed: true, baseUrl: "http://localhost/", devices: [{ udid: "iphone-1", name: "iPhone", state: "Booted", runtime: "" }] });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(f.calls.filter(call => call.name === "mobile_stream_session").length, 1);
  assert.equal(f.closed.length, 0);
});

for (const platform of ["ios", "android"] as const) test(`stopping the selected ${platform} device leaves the other stream open and allows restarting it`, async t => {
  const f = fixture(t);
  await Promise.all([f.ios.load(), f.android.load()]);
  await waitFor(() => f.ios.element("screen").draws > 0 && f.android.element("screen").draws > 0);
  const target = f[platform];
  const picker = target.picker;
  await picker.stopDevice(picker.value);
  const shutdown = f.calls.find(call => call.name === (platform === "ios" ? "mobile_shutdown_simulator" : "mobile_shutdown_android_emulator"));
  assert.deepEqual(shutdown?.arguments, platform === "ios" ? { udid: "iphone-1" } : { deviceId: "emulator-5554" });
  assert.equal(f.closed.length, 1);
  assert.ok(f.closed[0].startsWith(platform));
  assert.equal(target.panel.selected?.state, "Shutdown");
  assert.equal(target.panel.selected?.udid, platform === "ios" ? "iphone-1" : "avd:Pixel");
  assert.equal(picker.getSnapshot().items[0].canStop, false);
  await picker.stopDevice(platform === "ios" ? "iphone-1" : "emulator-5554");
  assert.equal(f.calls.filter(call => call.name.startsWith("mobile_shutdown")).length, 1);
  assert.equal(target.root.hidden, false);
  assert.equal(target.element("device-frame").hidden, false);
  assert.equal(target.element("stopped").hidden, false);
  assert.equal(target.element("start-device").disabled, false);
  dispatch(target.element("start-device"), "click");
  await waitFor(() => target.element("stopped").hidden && f.calls.filter(call => call.name.endsWith("stream_session")).length === 3);
  assert.equal(f.closed.length, 1);
});

test("refreshing the picker removes stop controls for devices stopped outside the panel", async t => {
  const f = fixture(t);
  await f.ios.load();
  await waitFor(() => f.ios.element("screen").draws > 0);
  const picker = f.ios.picker;
  f.stopDevices();
  await picker.refresh();
  assert.equal(picker.getSnapshot().items[0].running, false);
  assert.equal(picker.getSnapshot().items[0].canStop, false);
  await picker.stopDevice("iphone-1");
  assert.equal(f.calls.some(call => call.name.startsWith("mobile_shutdown")), false);
  assert.equal(f.ios.root.hidden, false);
});

test("device settings target each selected simulator and leave both streams open", async t => {
  const f = fixture(t);
  await Promise.all([f.ios.load(), f.android.load()]);
  await waitFor(() => f.ios.element("screen").draws > 0 && f.android.element("screen").draws > 0);
  const ios = getDeviceSettings(f.ios.element("settings") as unknown as HTMLElement);
  const android = getDeviceSettings(f.android.element("settings") as unknown as HTMLElement);
  await ios.load();
  await android.change({ setting: "appearance", value: "dark" });
  const iosSettings = f.calls.find(call => {
    const target = call.arguments.target;
    return call.name === "mobile_device_settings" && typeof target === "object" && target !== null && "platform" in target && target.platform === "ios";
  });
  assert.deepEqual(iosSettings?.arguments, { target: { platform: "ios", id: "iphone-1" } });
  assert.deepEqual(f.calls.find(call => call.name === "mobile_update_device_setting")?.arguments, { target: { platform: "android", id: "emulator-5554" }, change: { setting: "appearance", value: "dark" } });
  ios.toggleFrame(false);
  assert.equal(f.ios.element("screen").style.borderRadius, "0");
  ios.toggleFrame(true);
  assert.equal(f.closed.length, 0);
  assert.equal(f.calls.filter(call => call.name.endsWith("stream_session")).length, 2);
});

function dispatch(target: Element, name: string, properties: object = {}) { target.dispatchEvent(Object.assign(new Event(name), properties)); }

function pasteText(target: Element, text: string) {
  const event = new Event("paste", { cancelable: true });
  Object.assign(event, { clipboardData: { getData: (format: string) => format === "text/plain" ? text : "" } });
  target.dispatchEvent(event);
  return event;
}

for (const platform of ["ios", "android"] as const) test(`Command-V on ${platform} preserves paste and subsequent typing order in its own session`, async t => {
  const f = fixture(t);
  await Promise.all([f.ios.load(), f.android.load()]);
  await waitFor(() => f.ios.element("screen").draws > 0 && f.android.element("screen").draws > 0);
  const screen = f[platform].element("screen");
  const shortcut = new Event("keydown", { cancelable: true });
  Object.assign(shortcut, { key: "v", code: "KeyV", metaKey: true });
  screen.dispatchEvent(shortcut);
  assert.equal(shortcut.defaultPrevented, false, "Command-V lets the browser deliver its paste event.");
  const text = "https://example.test/path?q=hello%20world&count=2";
  const paste = pasteText(screen, text);
  assert.equal(paste.defaultPrevented, true);
  dispatch(screen, "keydown", { key: "!", code: "Digit1", shiftKey: true });
  await waitFor(() => f.calls.filter(call => call.name.endsWith("_stream_input")).length === 2);
  const inputs = f.calls.filter(call => call.name.endsWith("_stream_input"));
  const tool = platform === "ios" ? "mobile_stream_input" : "mobile_android_stream_input";
  for (const input of inputs) {
    assert.equal(input.name, tool);
    assert.equal(input.arguments.sessionId, inputs[0].arguments.sessionId);
  }
  assert.deepEqual(inputs[0].arguments.messages, [{ type: "type", text }]);
  assert.deepEqual(inputs[1].arguments.messages, [{ type: "type", text: "!" }]);
});

for (const platform of ["ios", "android"] as const) test(`${platform} paste rejects unsupported text without sending partial content`, async t => {
  const f = fixture(t);
  const panel = f[platform];
  await panel.load();
  await waitFor(() => panel.element("screen").draws > 0);
  const screen = panel.element("screen");
  const empty = pasteText(screen, "");
  assert.equal(empty.defaultPrevented, true);
  const notice = panel.element("notice");
  const message = panel.element("notice-message");
  assert.equal(notice.hidden, true);
  const oversized = "a".repeat(4097);
  for (const text of ["hello\nworld", "hello\tworld", "caf\u00e9", oversized]) {
    const paste = pasteText(screen, text);
    assert.equal(paste.defaultPrevented, true);
    assert.match(message.textContent, /4,096 printable US-ASCII/);
  }
  const inputs = f.calls.filter(call => call.name.endsWith("_stream_input"));
  assert.equal(inputs.length, 0);
  const supported = "a".repeat(4096);
  pasteText(screen, supported);
  assert.equal(notice.hidden, true);
  const input = f.calls.find(call => call.name.endsWith("_stream_input"));
  assert.deepEqual(input?.arguments.messages, [{ type: "type", text: supported }]);
});

for (const platform of ["ios", "android"] as const) test(`${platform} paste waits for readiness and stays disabled during selection, unavailability and teardown`, async t => {
  const f = fixture(t);
  const panel = f[platform];
  const screen = panel.element("screen");
  const beforeReady = pasteText(screen, "before ready");
  assert.equal(beforeReady.defaultPrevented, false);
  await panel.load();
  await waitFor(() => screen.draws > 0);
  const stage = panel.element("stage");
  const store = getScreenAnnotations(stage as unknown as HTMLElement);
  await store.toggle();
  const selecting = pasteText(screen, "selecting");
  assert.equal(selecting.defaultPrevented, false);
  dispatch(screen, "pointerdown", { button: 0, pointerId: 1, clientX: 20, clientY: 30 });
  dispatch(screen, "pointerup", { button: 0, pointerId: 1, clientX: 20, clientY: 30 });
  const drafting = pasteText(screen, "drafting");
  assert.equal(drafting.defaultPrevented, false);
  store.exit();
  panel.panel.setAvailable(false);
  const unavailable = pasteText(screen, "unavailable");
  assert.equal(unavailable.defaultPrevented, false);
  await panel.panel.dispose();
  const disposed = pasteText(screen, "disposed");
  assert.equal(disposed.defaultPrevented, false);
  const inputs = f.calls.filter(call => call.name.endsWith("_stream_input"));
  assert.equal(inputs.length, 0);
});

test("blocked iOS and physical iOS streams do not accept pasted text", async t => {
  const f = fixture(t);
  f.blockIos();
  await f.ios.load();
  await waitFor(() => f.ios.element("screen").draws > 0);
  const screen = f.ios.element("screen");
  const blocked = pasteText(screen, "blocked");
  assert.equal(blocked.defaultPrevented, false);
  f.setPhysicalDevices([physicalPhone]);
  await f.ios.load({ platform: "ios", kind: "physical", deviceId: physicalPhone.udid });
  await waitFor(() => f.calls.some(call => call.name === "mobile_ios_mirror_session") && f.ios.root.buttons[0].disabled);
  const physical = pasteText(screen, "physical");
  assert.equal(physical.defaultPrevented, false);
  const inputs = f.calls.filter(call => call.name.endsWith("_stream_input") || call.name === "mobile_ios_mirror_input");
  assert.equal(inputs.length, 0);
});

test("both platforms stream at once and each routes input to its own session", async t => {
  const f = fixture(t);
  await Promise.all([f.ios.load(), f.android.load()]);
  await waitFor(() => f.ios.element("screen").draws > 0 && f.android.element("screen").draws > 0);
  dispatch(f.ios.root.buttons[0], "click");
  dispatch(f.android.root.buttons[0], "click");
  await waitFor(() => f.calls.filter(call => call.name.endsWith("_stream_input")).length === 2);
  const input = f.calls.filter(call => call.name.endsWith("_stream_input"));
  assert.equal(input[0].name, "mobile_stream_input");
  assert.match(input[0].arguments.sessionId as string, /^ios-/);
  assert.equal(input[1].name, "mobile_android_stream_input");
  assert.match(input[1].arguments.sessionId as string, /^android-/);
  assert.equal(f.closed.length, 0);
});

test("changing one device leaves the other stream and controls active", async t => {
  const f = fixture(t);
  await Promise.all([f.ios.load(), f.android.load()]);
  await waitFor(() => f.android.element("screen").draws > 0);
  await f.ios.panel.resume();
  await waitFor(() => f.calls.filter(call => call.name === "mobile_stream_session").length === 2);
  assert.equal(f.calls.filter(call => call.name === "mobile_android_stream_session").length, 1);
  assert.ok(f.closed.some(id => id.startsWith("ios-")));
  assert.equal(f.closed.some(id => id.startsWith("android-")), false);
  assert.equal(f.android.root.buttons[0].disabled, false);
  dispatch(f.android.root, "pointerdown");
  assert.deepEqual(f.selections.at(-1), { platform: "android", active: true });
  dispatch(f.ios.root, "focusin");
  assert.deepEqual(f.selections.at(-1), { platform: "ios", active: true });
});

for (const platform of ["ios", "android"] as const) test(`${platform} input failure reconnects its panel without replaying gestures`, async t => {
  const f = fixture(t);
  const panel = f[platform];
  const other = platform === "ios" ? f.android : f.ios;
  const sessionTool = platform === "ios" ? "mobile_stream_session" : "mobile_android_stream_session";
  const inputTool = platform === "ios" ? "mobile_stream_input" : "mobile_android_stream_input";
  await Promise.all([panel.load(), other.load()]);
  await waitFor(() => panel.element("screen").draws > 0 && other.element("screen").draws > 0);
  f.failInput(platform);
  dispatch(panel.root.buttons[0], "click");
  await waitFor(() => f.calls.filter(call => call.name === sessionTool).length === 2 && panel.root.buttons[0].disabled === false);
  assert.equal(f.calls.filter(call => call.name === inputTool).length, 1);
  assert.equal(other.root.buttons[0].disabled, false);
  dispatch(panel.root.buttons[0], "click");
  await waitFor(() => f.calls.filter(call => call.name === inputTool).length === 2);
});

test("blocked iOS input leaves Android controls working", async t => {
  const f = fixture(t); f.blockIos();
  await Promise.all([f.ios.load(), f.android.load()]);
  await waitFor(() => f.ios.element("screen").draws > 0 && f.android.element("screen").draws > 0);
  assert.equal(f.ios.root.buttons[1].disabled, true);
  assert.match(f.ios.element("notice-message").textContent, /input is blocked/);
  assert.equal(f.android.root.buttons[1].disabled, false);
  assert.equal(f.android.element("notice").hidden, true);
});

test("teardown closes both streams and closes sessions that finish opening late", async t => {
  const f = fixture(t);
  let release!: () => void;
  f.delayOpen(new Promise<void>(resolve => { release = resolve; }));
  await Promise.all([f.ios.load(), f.android.load()]);
  await waitFor(() => f.calls.filter(call => call.name.endsWith("_stream_session")).length === 2);
  await Promise.all([f.ios.panel.dispose(), f.android.panel.dispose()]);
  release();
  await waitFor(() => f.closed.length === 2);
  assert.ok(f.closed.some(id => id.startsWith("ios-")));
  assert.ok(f.closed.some(id => id.startsWith("android-")));
  assert.equal(f.ios.element("screen").draws, 0);
  assert.equal(f.android.element("screen").draws, 0);
});

for (const platform of ["ios", "android"] as const) test(`select mode on ${platform} maps screen coordinates without sending device input`, async t => {
  const f = fixture(t); const panel = f[platform];
  await panel.load(); await waitFor(() => panel.element("screen").draws > 0);
  const store = getScreenAnnotations(panel.element("stage") as unknown as HTMLElement);
  await store.toggle();
  assert.equal(store.getSnapshot().selecting, true);
  assert.equal(panel.root.buttons[0].disabled, true);
  dispatch(panel.element("screen"), "pointermove", { pointerId: 1, clientX: 20, clientY: 30 });
  assert.equal(store.getSnapshot().hovered?.name, "Continue");
  assert.equal(store.getSnapshot().draft, undefined);
  dispatch(panel.element("screen"), "pointerleave", {});
  assert.equal(store.getSnapshot().hovered, undefined);
  dispatch(panel.element("screen"), "pointerdown", { button: 0, pointerId: 1, clientX: 20, clientY: 30 });
  assert.equal(store.getSnapshot().draft, undefined);
  dispatch(panel.element("screen"), "pointerup", { button: 0, pointerId: 1, clientX: 20, clientY: 30 });
  assert.equal(store.getSnapshot().draft?.component.name, "Continue");
  assert.equal(store.getSnapshot().draft?.screen.units, platform === "ios" ? "points" : "pixels");
  assert.equal(f.calls.some(call => call.name.endsWith("_stream_input")), false);
  dispatch(panel.element("screen"), "keydown", { key: "a", code: "KeyA" });
  assert.equal(f.calls.some(call => call.name.endsWith("_stream_input")), false);
  dispatch(panel.element("screen"), "keydown", { key: "Escape", code: "Escape" });
  assert.equal(store.getSnapshot().selecting, false); assert.equal(store.getSnapshot().draft, undefined);
  assert.equal(panel.root.buttons[0].disabled, false);
});

for (const recovery of ["generation", "decoder"] as const) test(`Android ${recovery} recovery keeps Select and its frozen capture active`, async t => {
  const f = fixture(t), panel = f.android;
  await panel.load();
  const store = getScreenAnnotations(panel.element("stage") as unknown as HTMLElement);
  await waitFor(() => !store.getSnapshot().disabled && f.waitingForFrame("android"));
  await store.toggle();
  const capture = store.getSnapshot().capture;
  const screen = panel.element("screen"), draws = screen.draws;
  dispatch(screen, "pointermove", { pointerId: 1, clientX: 20, clientY: 30 });
  assert.equal(store.getSnapshot().hovered?.name, "Continue");
  if (recovery === "generation") f.frame("android", 2, { generation: 2, empty: true });
  else { f.failAndroidDecode(); f.frame("android", 2); }
  await waitFor(() => f.waitingForFrame("android"));
  assert.equal(store.getSnapshot().selecting, true);
  assert.equal(store.getSnapshot().disabled, false);
  assert.equal(store.getSnapshot().capture, capture);
  assert.equal(screen.draws, draws);
  dispatch(screen, "pointerdown", { button: 0, pointerId: 1, clientX: 20, clientY: 30 });
  dispatch(screen, "pointerup", { button: 0, pointerId: 1, clientX: 20, clientY: 30 });
  const draft = store.getSnapshot().draft;
  assert.equal(draft?.component.name, "Continue");
  store.setText("Keep this element");
  f.frame("android", 3);
  await waitFor(() => f.waitingForFrame("android"));
  assert.equal(store.getSnapshot().selecting, true);
  assert.equal(store.getSnapshot().draft?.id, draft?.id);
  assert.equal(store.getSnapshot().draft?.text, "Keep this element");
  assert.equal(screen.draws, draws);
  assert.equal(f.calls.some(call => call.name === "mobile_android_stream_input"), false);
  dispatch(screen, "keydown", { key: "Escape", code: "Escape" });
  assert.equal(store.getSnapshot().selecting, false);
  assert.ok(screen.draws > draws, "Leaving Select displays the latest recovered frame.");
  assert.equal(panel.root.buttons[0].disabled, false);
  await store.toggle();
  f.visibility("hidden");
  assert.equal(store.getSnapshot().selecting, false);
  assert.equal(store.getSnapshot().disabled, true);
});

for (const platform of ["ios", "android"] as const) test(`failed inspection on ${platform} falls back to native elements and accepts clicks`, async t => {
  const f = fixture(t), panel = f[platform];
  f.failInspection();
  await panel.load(); await waitFor(() => panel.element("screen").draws > 0);
  const store = getScreenAnnotations(panel.element("stage") as unknown as HTMLElement);
  await store.toggle();
  dispatch(panel.element("screen"), "pointermove", { pointerId: 1, clientX: 20, clientY: 30 });
  assert.equal(store.getSnapshot().hovered?.name, "Continue");
  assert.equal(store.getSnapshot().hovered?.source, "accessibility");
  dispatch(panel.element("screen"), "pointerdown", { button: 0, pointerId: 1, clientX: 20, clientY: 30 });
  dispatch(panel.element("screen"), "pointerup", { button: 0, pointerId: 1, clientX: 20, clientY: 30 });
  assert.equal(store.getSnapshot().draft?.component.name, "Continue");
  assert.ok(f.calls.some(call => call.name === (platform === "ios" ? "mobile_describe_ui" : "mobile_android_describe_ui")));
  assert.equal(f.calls.some(call => call.name.endsWith("_stream_input")), false);
});

test("Android selection attaches a scaled accessibility element to the composer and sends its note to chat", async t => {
  const f = fixture(t), panel = f.android;
  f.failInspection();
  f.setAndroidAccessibility({ screen: { width: 1080, height: 2160 }, tree: { nodes: [
    { text: "Continue", resourceId: "app:id/continue", className: "android.widget.Button", bounds: { left: 270, top: 1080, right: 810, bottom: 1296 } },
  ] } });
  await panel.load(); await waitFor(() => panel.element("screen").draws > 0);
  const store = getScreenAnnotations(panel.element("stage") as unknown as HTMLElement);
  const updates: Parameters<App["updateModelContext"]>[0][] = [];
  const messages: Parameters<App["sendMessage"]>[0][] = [];
  store.connect(new PanelContext({
    getHostCapabilities: () => ({ message: { text: {} } }),
    async sendMessage(message) { messages.push(message); return {}; },
  } as App, () => ({
    getCurrent: () => undefined,
    async update(params) { updates.push(params); return { updateId: String(updates.length) }; },
  })));
  await store.toggle();
  dispatch(panel.element("screen"), "pointermove", { pointerId: 1, clientX: 75, clientY: 165 });
  assert.equal(store.getSnapshot().hovered?.name, "Continue");
  dispatch(panel.element("screen"), "pointerdown", { button: 0, pointerId: 1, clientX: 75, clientY: 165 });
  dispatch(panel.element("screen"), "pointerup", { button: 0, pointerId: 1, clientX: 75, clientY: 165 });
  assert.deepEqual(store.getSnapshot().draft?.component.bounds, { x: 100, y: 400, width: 200, height: 80 });
  assert.equal(store.getSnapshot().draft?.component.identifier, "app:id/continue");
  store.setText("Make this button wider");
  await store.save();
  const attachment = updates.at(-1)?.content?.[0];
  assert.equal(attachment?.type, "text");
  assert.equal(attachment._meta?.["openai/title"], "Continue: Make this button wider");
  assert.match(attachment.text, /emulator-5554/);
  assert.match(attachment.text, /app:id\/continue/);
  assert.match(attachment.text, /100,400,200,80 pixels/);
  await store.send();
  assert.equal(messages.length, 1);
  assert.equal(store.getSnapshot().annotations.length, 0);
  assert.equal(f.calls.some(call => call.name.endsWith("_stream_input")), false);
});

for (const platform of ["ios", "android"] as const) test(`selecting a stopped ${platform} device boots and streams it without Start`, async t => {
  const f = fixture(t); f.stopDevices();
  const panel = f[platform];
  await panel.load();
  assert.equal(panel.picker.value, "");
  assert.equal(f.calls.some(call => call.name.startsWith("mobile_boot")), false);
  panel.picker.choose(platform === "ios" ? "iphone-1" : "emulator-5554");
  await waitFor(() => panel.element("screen").draws > 0);
  assert.equal(f.calls.filter(call => call.name === (platform === "ios" ? "mobile_boot_simulator" : "mobile_boot_android_emulator")).length, 1);
  assert.equal(panel.root.buttons[0].disabled, false);
});
