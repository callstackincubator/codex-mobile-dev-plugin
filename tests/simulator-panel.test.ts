import { getDevicePicker } from "../src/ui/device-picker.ts";
import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import type { App } from "@modelcontextprotocol/ext-apps";
import type { PanelContext } from "../src/ui/model-context.ts";
import { createSimulatorPanel } from "../src/ui/simulator-panel.ts";
import { getDeviceSettings } from "../src/ui/device-settings.ts";
import { getScreenAnnotations } from "../src/ui/screen-annotations.ts";
import type { PhysicalIosDevice } from "../src/shared/ios-devices.ts";
import type { PhysicalAndroidDevice } from "../src/shared/android-devices.ts";
import type { SimulatorDevice } from "../src/shared/protocol.ts";

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

function fixture(t: TestContext) {
  const calls: { name: string; arguments: Record<string, unknown> }[] = [];
  const reads = new Set<string>();
  const pendingReads = new Map<string, (sequence: number) => void>();
  const closed: string[] = [];
  const selections: { platform: string; active?: boolean }[] = [];
  let sessionNumber = 0;
  let delayedOpen: Promise<void> | undefined;
  let blockedIos = false;
  let stopped = false;
  let physicalDevices: PhysicalIosDevice[] = [];
  let physicalError = "";
  let simulatorError = "";
  let delayedDiscovery: Promise<void> | undefined;
  let androidDevices: SimulatorDevice[] | undefined;
  const stoppedPlatforms = new Set<string>();
  let failedInputPlatform: "ios" | "android" | undefined;
  let inspectionFailure = false;
  let observeFrames = true;
  let invalidFrame = false;
  const document = Object.assign(new EventTarget(), { visibilityState: "visible", createElement: () => new Element() });
  class Decoder {
    state = "configured";
    decodeQueueSize = 0;
    output: (frame: object) => void;
    constructor(options: { output: (frame: object) => void }) { this.output = options.output; }
    static async isConfigSupported() { return { supported: true }; }
    configure() {}
    decode() { this.output({ displayWidth: 400, displayHeight: 800, close() {} }); }
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
      : [{ uri, mimeType: "application/json", text: JSON.stringify({ sequence, generation: 1, packets: [{ sequence, data: Buffer.from([0, 0, 0, 1, 0x67, 0x64, 0, 0x28, 0, 0, 0, 1, 0x65, 1]).toString("base64") }] }) }] };
    invalidFrame = false;
    if (observeFrames) window.dispatchEvent(Object.assign(new Event("message"), { data: { jsonrpc: "2.0", result }, source: undefined }));
    return result;
  }
  const app = {
    async callServerTool(call: { name: string; arguments: Record<string, unknown> }) {
      calls.push(call);
      if (call.name === "mobile_list_android_devices") {
        await delayedDiscovery;
        if (androidDevices) return { content: [], structuredContent: { connected: true, devices: androidDevices } };
      }
      if (call.name === "mobile_list_ios_devices") {
        await delayedDiscovery;
        if (physicalError) return { isError: true, content: [{ type: "text", text: physicalError }] };
        return { content: [], structuredContent: { physicalDevices } };
      }
      if (call.name === "mobile_list_simulators" && simulatorError) return { isError: true, content: [{ type: "text", text: simulatorError }] };
      const inputTool = failedInputPlatform === "android" ? "mobile_android_stream_input" : "mobile_stream_input";
      if (failedInputPlatform && call.name === inputTool) {
        failedInputPlatform = undefined;
        return { isError: true, content: [{ type: "text", text: "Input disconnected" }], _meta: { streamDisconnected: true } };
      }
      if (call.name === "mobile_ios_mirror_session") {
        const id = `physical-${++sessionNumber}`;
        await delayedOpen;
        return { content: [], _meta: { bezel: physicalBezel, sessionId: id, frameUri: `ios-video://mobile-dev/${id}/video` }, structuredContent: { name: "Physical iPhone" } };
      }
      if (call.name.endsWith("_stream_session")) {
        const android = call.name.includes("android");
        const id = `${android ? "android" : "ios"}-${++sessionNumber}`;
        await delayedOpen;
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
        return { content: [], structuredContent: { runtime: { available: true }, tree: [{ source: "react-native", role: "Pressable", label: "Continue", frame: { x: 10, y: 20, width: 100, height: 100 } }] } };
      }
      if (call.name.endsWith("_describe_ui")) return { content: [], structuredContent: { tree: { elements: [{ label: "Continue", role: "AXButton", frame: { x: 10, y: 20, width: 100, height: 100 } }] } } };
      return { content: [] };
    },
    async readServerResource({ uri }: { uri: string }, { signal }: { signal: AbortSignal }) {
      const address = new URL(uri);
      const id = address.protocol === "mobile-frame:" ? address.hostname : address.pathname.split("/")[1];
      if (!reads.has(id)) {
        reads.add(id);
        return frameResult(uri, id, 1);
      }
      return new Promise((resolve, reject) => {
        const abort = () => { pendingReads.delete(id); reject(new Error("Aborted")); };
        pendingReads.set(id, sequence => { pendingReads.delete(id); signal.removeEventListener("abort", abort); resolve(frameResult(uri, id, sequence)); });
        if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
      });
    },
  } as unknown as App;
  const panels = (["ios", "android"] as const).map(platform => {
    const root = new Element();
    for (const name of ["devices", "settings", "screen", "device-frame", "stage", "device-bezel", "screenshot", "notice", "notice-message", "empty", "empty-description", "stopped", "start-device", "screenshot-status"]) root.elements.set(name, new Element());
    root.elements.get("device-frame")!.hidden = true;
    for (const button of ["home", "app-switcher"]) { const element = new Element(); element.dataset.button = button; root.buttons.push(element); }
    const panel = createSimulatorPanel(app, root as unknown as HTMLElement, platform, { canAttachScreenshots: true, screenAnnotations: [], subscribe: () => () => {} } as unknown as PanelContext, (_device, active) => selections.push({ platform, active }));
    panel.setAvailable(true);
    return { panel, root, element: (name: string) => root.elements.get(name)! };
  });
  t.after(async () => { await Promise.all(panels.map(({ panel }) => panel.dispose())); for (const reset of restore) reset(); });
  return { calls, closed, selections, failInspection() { inspectionFailure = true; }, ios: panels[0], android: panels[1], setAndroidDevices(devices: SimulatorDevice[]) { androidDevices = devices; }, setPhysicalDevices(devices: PhysicalIosDevice[]) { physicalDevices = devices; }, failDiscovery(message: string) { physicalError = message; }, failSimulators(message: string) { simulatorError = message; }, delayDiscovery(value: Promise<void>) { delayedDiscovery = value; }, failInput(platform: "ios" | "android") { failedInputPlatform = platform; }, delayOpen(value: Promise<void>) { delayedOpen = value; }, blockIos() { blockedIos = true; }, stopDevices() { stopped = true; },
    visibility(value: string) { document.visibilityState = value; document.dispatchEvent(new Event("visibilitychange")); },
    frame(platform: "ios" | "android", sequence: number) { const id = [...pendingReads.keys()].find(id => id.startsWith(platform)); assert.ok(id); pendingReads.get(id)!(sequence); },
    missTiming() { observeFrames = false; }, invalidFrame() { invalidFrame = true; },
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

test("physical Android devices appear above emulators and stream without emulator lifecycle calls", async t => {
  const f = fixture(t);
  f.setAndroidDevices([
    { udid: "emulator-5554", name: "Pixel AVD", state: "Booted", runtime: "Android", platform: "android", kind: "emulator" },
    androidPhone,
  ]);
  await f.android.panel.load();
  const pickerElement = f.android.element("devices");
  const picker = getDevicePicker(pickerElement as unknown as HTMLElement);
  const state = picker.getSnapshot();
  const groups = state.items.map(item => item.group);
  assert.deepEqual(groups, ["Connected devices", "Emulators"]);
  assert.equal(state.items[0].label, "Pixel 9 · USB");
  assert.equal(state.items[0].canStop, false);
  picker.value = androidPhone.udid;
  dispatch(pickerElement, "change");
  await waitFor(() => {
    const state = picker.getSnapshot();
    return f.android.panel.selected?.udid === androidPhone.udid && state.disabled === false && f.android.element("screen").draws > 0;
  });
  const session = f.calls.findLast(call => call.name === "mobile_android_stream_session");
  assert.deepEqual(session?.arguments, { deviceId: androidPhone.udid });
  assert.equal(f.android.element("screenshot").disabled, false);
  await picker.stopDevice(androidPhone.udid);
  const lifecycle = f.calls.filter(call => call.name.startsWith("mobile_boot") || call.name.startsWith("mobile_shutdown"));
  assert.equal(lifecycle.length, 0);
  f.setAndroidDevices([{ ...androidPhone, transportType: "localNetwork" }]);
  await picker.refresh?.();
  const wireless = picker.getSnapshot();
  assert.equal(wireless.value, androidPhone.udid);
  assert.equal(wireless.items[0].label, "Pixel 9 · Wi-Fi");
});

for (const state of ["unauthorized", "offline"]) test(`physical Android ${state} devices remain discoverable without booting or streaming`, async t => {
  const f = fixture(t);
  f.setAndroidDevices([{ ...androidPhone, state }]);
  await f.android.panel.load();
  const pickerElement = f.android.element("devices");
  const picker = getDevicePicker(pickerElement as unknown as HTMLElement);
  const snapshot = picker.getSnapshot();
  assert.equal(snapshot.items.length, 1);
  assert.equal(snapshot.items[0].running, false);
  assert.equal(snapshot.items[0].canStop, false);
  assert.match(snapshot.items[0].label, state === "unauthorized" ? /Unauthorized/ : /Offline/);
  picker.value = androidPhone.udid;
  dispatch(pickerElement, "change");
  await waitFor(() => {
    const snapshot = picker.getSnapshot();
    return f.android.panel.selected?.udid === androidPhone.udid && snapshot.disabled === false;
  });
  assert.equal(f.android.element("start-device").disabled, true);
  assert.equal(f.android.element("screenshot").disabled, true);
  const actions = f.calls.filter(call => call.name.startsWith("mobile_boot") || call.name.endsWith("_stream_session"));
  assert.equal(actions.length, 0);
  f.setAndroidDevices([androidPhone]);
  await picker.refresh?.();
  await waitFor(() => f.android.element("screen").draws > 0);
});

test("Android refresh connects an arriving phone once and closes its stream when it disconnects", async t => {
  const f = fixture(t);
  f.setAndroidDevices([]);
  await f.android.panel.load();
  const pickerElement = f.android.element("devices");
  const picker = getDevicePicker(pickerElement as unknown as HTMLElement);
  f.setAndroidDevices([androidPhone]);
  await picker.refresh?.();
  await waitFor(() => f.android.element("screen").draws > 0);
  await picker.refresh?.();
  const streams = f.calls.filter(call => call.name === "mobile_android_stream_session");
  assert.equal(streams.length, 1);
  assert.equal(f.android.panel.selected?.udid, androidPhone.udid);
  f.setAndroidDevices([]);
  await picker.refresh?.();
  await waitFor(() => f.closed.length === 1);
  assert.equal(f.android.panel.selected, undefined);
  assert.equal(f.android.root.buttons[0].disabled, true);
  const lifecycle = f.calls.filter(call => call.name.startsWith("mobile_boot") || call.name.startsWith("mobile_shutdown"));
  assert.equal(lifecycle.length, 0);
});

test("Android discovery polls visible panels, shares refreshes, and removes disconnected phones", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(t);
  f.setAndroidDevices([]);
  await f.android.panel.load();
  const pickerElement = f.android.element("devices");
  const picker = getDevicePicker(pickerElement as unknown as HTMLElement);
  f.android.root.hidden = true;
  t.mock.timers.tick(3000);
  const hiddenReads = f.calls.filter(call => call.name === "mobile_list_android_devices");
  assert.equal(hiddenReads.length, 1);
  f.android.root.hidden = false;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  f.delayDiscovery(gate);
  f.setAndroidDevices([{ ...androidPhone, state: "unauthorized" }]);
  t.mock.timers.tick(3000);
  const refreshing = picker.refresh?.();
  const sharedReads = f.calls.filter(call => call.name === "mobile_list_android_devices");
  assert.equal(sharedReads.length, 2);
  release();
  await refreshing;
  const connected = picker.getSnapshot();
  assert.equal(connected.items[0].value, androidPhone.udid);
  f.setAndroidDevices([]);
  await picker.refresh?.();
  const disconnected = picker.getSnapshot();
  assert.equal(disconnected.items.length, 0);
  await f.android.panel.dispose();
  t.mock.timers.tick(10000);
  const disposedReads = f.calls.filter(call => call.name === "mobile_list_android_devices");
  assert.equal(disposedReads.length, 3);
});

test("physical iOS devices mirror above simulators and route touches to their own session", async t => {
  const f = fixture(t);
  f.setPhysicalDevices([physicalPhone]);
  await f.ios.panel.load();
  const pickerElement = f.ios.element("devices");
  const picker = getDevicePicker(pickerElement as unknown as HTMLElement);
  const state = picker.getSnapshot();
  const items = state.items;
  const groups = items.map(item => item.group);
  assert.deepEqual(groups, ["Connected devices", "Simulators"]);
  assert.equal(items[0].label, "Physical iPhone · Wi-Fi");
  assert.equal(items[0].statusLabel, "Connected");
  assert.equal(items[0].canStop, false);
  const previousStreams = f.calls.filter(call => call.name === "mobile_stream_session");
  picker.value = physicalPhone.udid;
  dispatch(pickerElement, "change");
  await waitFor(() => {
    const state = picker.getSnapshot();
    return f.ios.panel.selected?.kind === "physical" && state.disabled === false;
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
  assert.equal(screenshot.disabled, true);
  const disabledButtons = f.ios.root.buttons.every(button => button.disabled);
  const boots = f.calls.filter(call => call.name.startsWith("mobile_boot"));
  const streams = f.calls.filter(call => call.name === "mobile_stream_session");
  assert.equal(disabledButtons, true);
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
  await picker.refresh?.();
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
  assert.equal(screenshot.disabled, true);
  f.setPhysicalDevices([{ ...physicalPhone, state: "disconnected", transportType: "none" }]);
  await picker.refresh?.();
  const disconnectedState = picker.getSnapshot();
  const phonePresent = disconnectedState.items.some(item => item.value === physicalPhone.udid);
  assert.equal(phonePresent, false);
});

test("physical discovery failure stays visible while simulator discovery remains usable", async t => {
  const f = fixture(t);
  f.failDiscovery("Physical discovery requires Xcode 27");
  await f.ios.panel.load();
  assert.equal(f.ios.panel.selected?.udid, "iphone-1");
  const pickerElement = f.ios.element("devices");
  const picker = getDevicePicker(pickerElement as unknown as HTMLElement);
  const state = picker.getSnapshot();
  assert.equal(state.disabled, false);
  await waitFor(() => f.ios.element("screen").draws > 0);
  const notice = f.ios.element("notice-message");
  assert.match(notice.textContent, /Physical discovery requires Xcode 27/);
  f.failDiscovery("");
  await picker.refresh?.();
  assert.equal(notice.textContent, "");
});

test("physical devices remain selectable when the simulator backend is unavailable", async t => {
  const f = fixture(t);
  f.setPhysicalDevices([physicalPhone]);
  f.failSimulators("Baguette unavailable");
  await f.ios.panel.load();
  const element = f.ios.element("devices");
  const picker = getDevicePicker(element as unknown as HTMLElement);
  const state = picker.getSnapshot();
  assert.equal(state.disabled, false);
  assert.equal(state.value, physicalPhone.udid);
  const groups = state.items.map(item => item.group);
  assert.deepEqual(groups, ["Connected devices"]);
  assert.equal(f.ios.panel.selected?.kind, "physical");
  const sessions = f.calls.filter(call => call.name === "mobile_stream_session");
  assert.equal(sessions.length, 0);
});

test("discovery polls only visible panels, shares an in-flight refresh, and stops on disposal", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(t);
  f.setPhysicalDevices([physicalPhone]);
  f.failSimulators("Baguette unavailable");
  await f.ios.panel.load();
  const element = f.ios.element("devices");
  const picker = getDevicePicker(element as unknown as HTMLElement);
  f.ios.root.hidden = true;
  t.mock.timers.tick(3000);
  const hiddenReads = f.calls.filter(call => call.name === "mobile_list_ios_devices");
  assert.equal(hiddenReads.length, 1);
  f.ios.root.hidden = false;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  f.delayDiscovery(gate);
  f.setPhysicalDevices([]);
  t.mock.timers.tick(3000);
  const refreshing = picker.refresh?.();
  const sharedReads = f.calls.filter(call => call.name === "mobile_list_ios_devices");
  assert.equal(sharedReads.length, 2);
  release();
  await refreshing;
  const state = picker.getSnapshot();
  assert.equal(state.items.length, 0);
  await f.ios.panel.dispose();
  t.mock.timers.tick(10000);
  const disposedReads = f.calls.filter(call => call.name === "mobile_list_ios_devices");
  assert.equal(disposedReads.length, 2);
});

async function waitFor(predicate: () => boolean) {
  const end = Date.now() + 2000;
  while (!predicate()) {
    assert.ok(Date.now() < end, "Panel did not reach the expected state");
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

test("missing timing observations do not disconnect valid iOS frames", async t => {
  const f = fixture(t); f.missTiming(); await f.ios.panel.load();
  await waitFor(() => f.ios.element("screen").draws > 0);
  assert.equal(f.calls.filter(call => call.name === "mobile_stream_session").length, 1);
  assert.equal(f.closed.length, 0);
});

for (const platform of ["ios", "android"] as const) test(`leaving Select restores the latest ${platform} frame even when the device is quiet`, async t => {
  const f = fixture(t); const target = f[platform]; await target.panel.load();
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
  const f = fixture(t); await Promise.all([f.ios.panel.load(), f.android.panel.load()]);
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
  const f = fixture(t); f.invalidFrame(); await f.ios.panel.load();
  await waitFor(() => f.ios.element("notice-message").textContent.includes("invalid frame metadata"));
  f.visibility("visible");
  await waitFor(() => f.ios.element("screen").draws > 0);
  assert.equal(f.calls.filter(call => call.name === "mobile_stream_session").length, 2);
});

test("status arriving during startup still connects the selected device", async t => {
  const f = fixture(t);
  const starting = f.ios.panel.resume();
  f.ios.panel.acceptStatus({ connected: true, managed: true, baseUrl: "http://localhost/", devices: [{ udid: "iphone-1", name: "iPhone", state: "Booted", runtime: "" }] });
  await starting;
  await waitFor(() => f.ios.element("screen").draws > 0);
  assert.equal(f.ios.element("empty").hidden, true);
  assert.equal(f.calls.filter(call => call.name === "mobile_stream_session").length, 1);
  f.ios.panel.acceptStatus({ connected: true, managed: true, baseUrl: "http://localhost/", devices: [{ udid: "iphone-1", name: "iPhone", state: "Booted", runtime: "" }] });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(f.calls.filter(call => call.name === "mobile_stream_session").length, 1);
  assert.equal(f.closed.length, 0);
});

for (const platform of ["ios", "android"] as const) test(`stopping the selected ${platform} device leaves the other stream open and allows restarting it`, async t => {
  const f = fixture(t);
  await Promise.all([f.ios.panel.load(), f.android.panel.load()]);
  await waitFor(() => f.ios.element("screen").draws > 0 && f.android.element("screen").draws > 0);
  const target = f[platform];
  const picker = getDevicePicker(target.element("devices") as unknown as HTMLElement);
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
  await f.ios.panel.load();
  await waitFor(() => f.ios.element("screen").draws > 0);
  const picker = getDevicePicker(f.ios.element("devices") as unknown as HTMLElement);
  f.stopDevices();
  await picker.refresh!();
  assert.equal(picker.getSnapshot().items[0].running, false);
  assert.equal(picker.getSnapshot().items[0].canStop, false);
  await picker.stopDevice("iphone-1");
  assert.equal(f.calls.some(call => call.name.startsWith("mobile_shutdown")), false);
  assert.equal(f.ios.root.hidden, false);
});

test("device settings target each selected simulator and leave both streams open", async t => {
  const f = fixture(t);
  await Promise.all([f.ios.panel.load(), f.android.panel.load()]);
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

test("both platforms stream at once and each routes input to its own session", async t => {
  const f = fixture(t);
  await Promise.all([f.ios.panel.load(), f.android.panel.load()]);
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
  await Promise.all([f.ios.panel.load(), f.android.panel.load()]);
  await waitFor(() => f.android.element("screen").draws > 0);
  dispatch(f.ios.element("devices"), "change");
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
  await Promise.all([panel.panel.load(), other.panel.load()]);
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
  await Promise.all([f.ios.panel.load(), f.android.panel.load()]);
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
  await Promise.all([f.ios.panel.load(), f.android.panel.load()]);
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
  await panel.panel.load(); await waitFor(() => panel.element("screen").draws > 0);
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

for (const platform of ["ios", "android"] as const) test(`failed inspection on ${platform} falls back to native elements and accepts clicks`, async t => {
  const f = fixture(t), panel = f[platform];
  f.failInspection();
  await panel.panel.load(); await waitFor(() => panel.element("screen").draws > 0);
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

for (const platform of ["ios", "android"] as const) test(`selecting a stopped ${platform} device boots and streams it without Start`, async t => {
  const f = fixture(t); f.stopDevices();
  const panel = f[platform];
  await panel.panel.load();
  assert.equal(getDevicePicker(panel.element("devices") as unknown as HTMLElement).value, "");
  assert.equal(f.calls.some(call => call.name.startsWith("mobile_boot")), false);
  getDevicePicker(panel.element("devices") as unknown as HTMLElement).value = platform === "ios" ? "iphone-1" : "emulator-5554";
  dispatch(panel.element("devices"), "change");
  await waitFor(() => panel.element("screen").draws > 0);
  assert.equal(f.calls.filter(call => call.name === (platform === "ios" ? "mobile_boot_simulator" : "mobile_boot_android_emulator")).length, 1);
  assert.equal(panel.root.buttons[0].disabled, false);
});
