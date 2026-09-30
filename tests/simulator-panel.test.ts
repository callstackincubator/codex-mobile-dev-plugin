import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import type { App } from "@modelcontextprotocol/ext-apps";
import type { PanelContext } from "../src/ui/model-context.ts";
import { createSimulatorPanel } from "../src/ui/simulator-panel.ts";

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
    Option: class extends Element { constructor(text: string) { super(); this.textContent = text; } },
    VideoDecoder: Decoder, EncodedVideoChunk: class {},
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
      if (call.name.endsWith("_stream_session")) {
        const android = call.name.includes("android");
        const id = `${android ? "android" : "ios"}-${++sessionNumber}`;
        await delayedOpen;
        return { content: [], _meta: { sessionId: id, frameUri: `stream://mobile-dev/${id}/frame` }, structuredContent: {
          definition: { screen: { rect: { width: 390, height: 844 } } },
          inputStatus: { state: !android && blockedIos ? "blocked" : "ready" },
        } };
      }
      if (call.name.endsWith("_stream_close")) closed.push(call.arguments.sessionId as string);
      if (call.name.startsWith("mobile_list")) {
        const android = call.name.includes("android");
        return { content: [], structuredContent: { connected: true, devices: [{ udid: android ? "emulator-5554" : "iphone-1", name: android ? "Pixel" : "iPhone", state: "Booted", runtime: "", platform: android ? "android" : "ios" }] } };
      }
      return { content: [] };
    },
    async readServerResource({ uri }: { uri: string }, { signal }: { signal: AbortSignal }) {
      const id = new URL(uri).pathname.split("/")[1];
      if (!reads.has(id)) {
        reads.add(id);
        return { contents: id.startsWith("ios")
          ? [{ mimeType: "image/jpeg", blob: "AA==", _meta: { sequence: 1 } }]
          : [{ mimeType: "application/json", text: JSON.stringify({ sequence: 1, generation: 1, packets: [{ sequence: 1, data: Buffer.from([0, 0, 0, 1, 0x67, 0x64, 0, 0x28, 0, 0, 0, 1, 0x65, 1]).toString("base64") }] }) }] };
      }
      return new Promise((_, reject) => {
        const abort = () => reject(new Error("Aborted"));
        if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
      });
    },
  } as unknown as App;
  const panels = (["ios", "android"] as const).map(platform => {
    const root = new Element();
    for (const name of ["devices", "screen", "device-frame", "stage", "device-bezel", "start", "refresh", "screenshot", "repair-input", "notice", "notice-message", "frame-stats", "stream-format", "empty", "screenshot-status"]) root.elements.set(name, new Element());
    root.elements.get("device-frame")!.hidden = true;
    for (const button of ["back", "home", "power", "app-switcher"]) { const element = new Element(); element.dataset.button = button; root.buttons.push(element); }
    const panel = createSimulatorPanel(app, root as unknown as HTMLElement, platform, { canAttachScreenshots: true } as PanelContext, (_device, active) => selections.push({ platform, active }));
    panel.setAvailable(true);
    return { panel, root, element: (name: string) => root.elements.get(name)! };
  });
  t.after(async () => { await Promise.all(panels.map(({ panel }) => panel.dispose())); for (const reset of restore) reset(); });
  return { calls, closed, selections, ios: panels[0], android: panels[1], delayOpen(value: Promise<void>) { delayedOpen = value; }, blockIos() { blockedIos = true; } };
}

async function waitFor(predicate: () => boolean) {
  const end = Date.now() + 2000;
  while (!predicate()) {
    assert.ok(Date.now() < end, "Panel did not reach the expected state");
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

function dispatch(target: Element, name: string, properties: object = {}) { target.dispatchEvent(Object.assign(new Event(name), properties)); }

test("both platforms stream at once and each routes input to its own session", async t => {
  const f = fixture(t);
  await Promise.all([f.ios.panel.load(), f.android.panel.load()]);
  await waitFor(() => f.ios.element("screen").draws > 0 && f.android.element("screen").draws > 0);
  assert.equal(f.ios.element("start").textContent, "Pause");
  assert.equal(f.android.element("start").textContent, "Pause");
  dispatch(f.ios.root.buttons[1], "click");
  dispatch(f.android.root.buttons[0], "click");
  await waitFor(() => f.calls.filter(call => call.name.endsWith("_stream_input")).length === 2);
  const input = f.calls.filter(call => call.name.endsWith("_stream_input"));
  assert.equal(input[0].name, "mobile_stream_input");
  assert.match(input[0].arguments.sessionId as string, /^ios-/);
  assert.equal(input[1].name, "mobile_android_stream_input");
  assert.match(input[1].arguments.sessionId as string, /^android-/);
  assert.equal(f.closed.length, 0);
});

test("pausing or changing one device leaves the other stream and controls active", async t => {
  const f = fixture(t);
  await Promise.all([f.ios.panel.load(), f.android.panel.load()]);
  await waitFor(() => f.android.element("screen").draws > 0);
  dispatch(f.ios.element("start"), "click");
  await waitFor(() => f.ios.element("start").textContent === "Start");
  assert.ok(f.closed.some(id => id.startsWith("ios-")));
  assert.equal(f.closed.some(id => id.startsWith("android-")), false);
  assert.equal(f.android.element("start").textContent, "Pause");
  assert.equal(f.android.root.buttons[1].disabled, false);
  dispatch(f.ios.element("devices"), "change");
  await waitFor(() => f.calls.filter(call => call.name === "mobile_stream_session").length === 2);
  assert.equal(f.calls.filter(call => call.name === "mobile_android_stream_session").length, 1);
  dispatch(f.android.root, "pointerdown");
  assert.deepEqual(f.selections.at(-1), { platform: "android", active: true });
});

test("blocked iOS input leaves Android controls working", async t => {
  const f = fixture(t); f.blockIos();
  await Promise.all([f.ios.panel.load(), f.android.panel.load()]);
  await waitFor(() => f.ios.element("screen").draws > 0 && f.android.element("screen").draws > 0);
  assert.equal(f.ios.root.buttons[1].disabled, true);
  assert.equal(f.ios.element("repair-input").hidden, false);
  assert.equal(f.android.root.buttons[1].disabled, false);
  assert.equal(f.android.element("repair-input").hidden, true);
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
