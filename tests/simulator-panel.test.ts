import { getDevicePicker } from "../src/ui/device-picker.ts";
import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import type { App } from "@modelcontextprotocol/ext-apps";
import type { PanelContext } from "../src/ui/model-context.ts";
import { createSimulatorPanel } from "../src/ui/simulator-panel.ts";
import { getDeviceSettings } from "../src/ui/device-settings.ts";

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
  const closed: string[] = [];
  const selections: { platform: string; active?: boolean }[] = [];
  let sessionNumber = 0;
  let delayedOpen: Promise<void> | undefined;
  let blockedIos = false;
  let stopped = false;
  const stoppedPlatforms = new Set<string>();
  let failedInputPlatform: "ios" | "android" | undefined;
  const document = Object.assign(new EventTarget(), { visibilityState: "visible", createElement: () => new Element() });
  class Decoder {
    state = "configured";
    decodeQueueSize = 0;
    output: (frame: object) => void;
    constructor(options: { output: (frame: object) => void }) { this.output = options.output; }
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
  const app = {
    async callServerTool(call: { name: string; arguments: Record<string, unknown> }) {
      calls.push(call);
      const inputTool = failedInputPlatform === "android" ? "mobile_android_stream_input" : "mobile_stream_input";
      if (failedInputPlatform && call.name === inputTool) {
        failedInputPlatform = undefined;
        return { isError: true, content: [{ type: "text", text: "Input disconnected" }], _meta: { streamDisconnected: true } };
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
      if (call.name.endsWith("_stream_close")) closed.push(call.arguments.sessionId as string);
      const callPlatform = call.name.includes("android") ? "android" : "ios";
      if (call.name.startsWith("mobile_boot")) { stopped = false; stoppedPlatforms.delete(callPlatform); }
      if (call.name.startsWith("mobile_shutdown")) stoppedPlatforms.add(callPlatform);
      if (call.name.startsWith("mobile_list") || call.name.startsWith("mobile_boot") || call.name.startsWith("mobile_shutdown")) {
        const android = call.name.includes("android");
        return { content: [], structuredContent: { connected: true, devices: [{ udid: android ? (stoppedPlatforms.has("android") ? "avd:Pixel" : "emulator-5554") : "iphone-1", name: android ? "Pixel" : "iPhone", state: stopped || stoppedPlatforms.has(callPlatform) ? "Shutdown" : "Booted", runtime: "", platform: android ? "android" : "ios" }] } };
      }
      if (call.name === "mobile_device_settings" || call.name === "mobile_update_device_setting") return { content: [], structuredContent: { settings: { appearance: "dark", locationSupported: true } } };
      return { content: [] };
    },
    async readServerResource({ uri }: { uri: string }, { signal }: { signal: AbortSignal }) {
      const address = new URL(uri);
      const id = address.protocol === "mobile-frame:" ? address.hostname : address.pathname.split("/")[1];
      if (!reads.has(id)) {
        reads.add(id);
        const serverPreparedAt = performance.timeOrigin + performance.now();
        const result = { contents: id.startsWith("ios")
          ? [{ uri, mimeType: "image/jpeg", blob: "AA==", _meta: { sequence: 1, receivedAt: Date.now(), bytes: 1, serverWaitMs: 0, serverStartedAt: serverPreparedAt, serverPreparedAt } }]
          : [{ uri, mimeType: "application/json", text: JSON.stringify({ sequence: 1, generation: 1, packets: [{ sequence: 1, data: Buffer.from([0, 0, 0, 1, 0x67, 0x64, 0, 0x28, 0, 0, 0, 1, 0x65, 1]).toString("base64") }] }) }] };
        const message = Object.assign(new Event("message"), { data: { jsonrpc: "2.0", result }, source: undefined });
        window.dispatchEvent(message);
        return result;
      }
      return new Promise((_, reject) => {
        const abort = () => reject(new Error("Aborted"));
        if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
      });
    },
  } as unknown as App;
  const panels = (["ios", "android"] as const).map(platform => {
    const root = new Element();
    for (const name of ["devices", "settings", "screen", "device-frame", "stage", "device-bezel", "screenshot", "notice", "notice-message", "empty", "empty-description", "stopped", "start-device", "screenshot-status"]) root.elements.set(name, new Element());
    root.elements.get("device-frame")!.hidden = true;
    for (const button of ["home", "app-switcher"]) { const element = new Element(); element.dataset.button = button; root.buttons.push(element); }
    const panel = createSimulatorPanel(app, root as unknown as HTMLElement, platform, { canAttachScreenshots: true } as PanelContext, (_device, active) => selections.push({ platform, active }));
    panel.setAvailable(true);
    return { panel, root, element: (name: string) => root.elements.get(name)! };
  });
  t.after(async () => { await Promise.all(panels.map(({ panel }) => panel.dispose())); for (const reset of restore) reset(); });
  return { calls, closed, selections, ios: panels[0], android: panels[1], failInput(platform: "ios" | "android") { failedInputPlatform = platform; }, delayOpen(value: Promise<void>) { delayedOpen = value; }, blockIos() { blockedIos = true; }, stopDevices() { stopped = true; } };
}

async function waitFor(predicate: () => boolean) {
  const end = Date.now() + 2000;
  while (!predicate()) {
    assert.ok(Date.now() < end, "Panel did not reach the expected state");
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

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
  assert.deepEqual(f.calls.find(call => call.name === "mobile_device_settings")?.arguments, { target: { platform: "ios", id: "iphone-1" } });
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
