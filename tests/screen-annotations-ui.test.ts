import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PanelContext } from "../src/ui/model-context.ts";
import type { App } from "@modelcontextprotocol/ext-apps";
import type { OpenAIExtensions } from "@openai/mcp-extensions/app";

test("the simulator toolbar opens notes, saves blue markers, and lets users edit and remove them", async t => {
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: "http://localhost" });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const globals = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement, HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    Node: dom.window.Node, Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, NodeFilter: dom.window.NodeFilter,
    Element: dom.window.Element, DocumentFragment: dom.window.DocumentFragment, MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} }, IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const [key, value] of Object.entries(globals)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  const directory = await mkdtemp(resolve("node_modules/.mobile-dev-annotation-test-"));
  let cleanup = async () => {};
  t.after(async () => { await cleanup(); dom.window.close(); for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } await rm(directory, { recursive: true, force: true }); });
  const output = resolve(directory, "annotations.mjs");
  await build({ stdin: { contents: 'export { SimulatorView } from "./src/ui/components/simulator-view.tsx"; export { getScreenAnnotations } from "./src/ui/screen-annotations.ts";', resolveDir: process.cwd(), loader: "ts" }, outfile: output, bundle: true, format: "esm", platform: "node", jsx: "automatic", external: ["react", "react/*", "react-dom", "react-dom/*", "radix-ui", "lucide-react", "@base-ui/react/*"] });
  const { SimulatorView, getScreenAnnotations } = await import(pathToFileURL(output).href);
  const { act, createElement } = await import("react"); const { createRoot } = await import("react-dom/client");
  const root = createRoot(dom.window.document.getElementById("root")!);
  cleanup = async () => { await act(async () => { root.unmount(); }); };
  await act(async () => { root.render(createElement(SimulatorView, { platform: "ios", visible: true })); });
  const canvas = dom.window.document.querySelector("canvas");
  const store = getScreenAnnotations(dom.window.document.querySelector('[data-element="stage"]'));
  const context = new PanelContext({ getHostCapabilities: () => ({ updateModelContext: { image: {} }, message: { text: {} } }), async sendMessage() { return { isError: true }; } } as unknown as App, { modelContext: { getCurrent: () => undefined, update: async () => ({ updateId: "annotation-update" }) } } as unknown as OpenAIExtensions);
  store.capture = () => ({ screenshot: { id: "capture", data: "AA==", capturedAt: "2026-10-01T10:00:00Z" }, screen: { width: 390, height: 844, units: "points" } });
  store.readTree = async () => ({ tree: { label: "Continue", identifier: "continue", role: "AXButton", frame: { x: 10, y: 20, width: 100, height: 40 } } });
  await act(async () => {
    store.connect(context); store.configure({ udid: "iphone", name: "iPhone", state: "Booted", runtime: "iOS", platform: "ios" }, false);
    store.setViewport({ x: 16, y: 16, width: 150, height: 300, stageWidth: 640, stageHeight: 360 });
  });
  const selectButton = dom.window.document.querySelector('[data-element="select-mode"]') as HTMLButtonElement;
  await act(async () => { selectButton.click(); });
  assert.equal(selectButton.getAttribute("aria-pressed"), "true");
  await act(async () => { store.hover({ x: 50, y: 40 }); });
  const highlight = dom.window.document.querySelector('[data-element="component-highlight"]') as HTMLElement;
  assert.equal(highlight.textContent, "");
  assert.equal(highlight.dataset.componentSource, "accessibility");
  assert.equal(parseFloat(highlight.style.width), 100 / 390 * 150);
  assert.equal(parseFloat(highlight.style.height), 40 / 844 * 300);
  assert.equal(dom.window.document.querySelector('[aria-label="Annotation note"]'), null);
  await act(async () => { store.hover(); });
  assert.equal(dom.window.document.querySelector('[data-element="component-highlight"]'), null);
  await act(async () => { store.select({ x: 50, y: 40 }); store.setText("Make this button wider"); });
  const noteInput = dom.window.document.querySelector('[aria-label="Annotation note"]') as HTMLInputElement;
  assert.equal(noteInput.value, "Make this button wider"); assert.equal(dom.window.document.activeElement, noteInput);
  await act(async () => { (dom.window.document.querySelector('[aria-label="Save annotation"]') as HTMLButtonElement).click(); });
  const marker = dom.window.document.querySelector('[aria-label="Edit annotation 1: Continue"]') as HTMLButtonElement;
  assert.ok(marker); assert.equal(marker.textContent, "1"); assert.equal(context.screenAnnotations[0].text, "Make this button wider");
  await act(async () => { marker.click(); });
  const editInput = dom.window.document.querySelector('[aria-label="Annotation note"]') as HTMLInputElement;
  assert.equal(editInput.value, "Make this button wider");
  await act(async () => { store.setText("Make this button blue"); });
  await act(async () => { editInput.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
  assert.equal(context.screenAnnotations[0].text, "Make this button blue");
  assert.equal(dom.window.document.querySelector('[aria-label="Annotation note"]'), null);
  await act(async () => { store.configure({ udid: "iphone", name: "iPhone", state: "Booted", runtime: "iOS", platform: "ios" }, true); });
  const sendButton = Array.from(dom.window.document.querySelectorAll("button")).find(button => button.textContent === "Send to chat")!;
  assert.equal(sendButton.disabled, false, "Saved notes can send while the simulator reconnects.");
  await act(async () => { sendButton.click(); });
  assert.equal(sendButton.disabled, false);
  assert.equal(sendButton.textContent, "Retry send");
  assert.equal(context.screenAnnotations.length, 1);
  const errorButton = dom.window.document.querySelector('[aria-label^="Send failed:"]') as HTMLButtonElement;
  assert.ok(errorButton);
  await act(async () => { errorButton.click(); });
  assert.match(dom.window.document.querySelector('[role="alert"]')!.textContent!, /Could not send/);
  const message = dom.window.document.querySelector('[aria-label="Annotation message to copy"]') as HTMLTextAreaElement;
  const errorPopover = message.closest('[data-slot="popover-content"]')!;
  assert.equal(message.value, store.messageText);
  assert.equal(message.readOnly, true);
  assert.match(message.value, /Make this button blue/);
  let copied = "";
  let clipboardFails = true;
  Object.defineProperty(dom.window.navigator, "clipboard", { value: { async writeText(text: string) { if (clipboardFails) throw new Error("Clipboard denied"); copied = text; } } });
  const copyButton = Array.from(dom.window.document.querySelectorAll("button")).find(button => button.textContent === "Copy notes")!;
  await act(async () => { copyButton.click(); });
  assert.match(errorPopover.querySelector('[role="status"]')!.textContent!, /Select and copy/);
  clipboardFails = false;
  await act(async () => { copyButton.click(); });
  assert.equal(copied, message.value);
  assert.equal(errorPopover.querySelector('[role="status"]')!.textContent!, "Copied");
  await act(async () => { errorButton.click(); store.configure({ udid: "iphone", name: "iPhone", state: "Booted", runtime: "iOS", platform: "ios" }, false); });
  // Let the closing popover restore focus before opening the notes menu.
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  await act(async () => { (Array.from(dom.window.document.querySelectorAll("button")).find(button => button.textContent === "1 note") as HTMLButtonElement).click(); });
  await act(async () => { (dom.window.document.querySelector('[aria-label="Remove annotation 1"]') as HTMLButtonElement).click(); });
  assert.equal(dom.window.document.querySelector('.annotation-marker'), null);
  await act(async () => { selectButton.click(); store.dispose(); });
  assert.equal(dom.window.document.querySelector("canvas"), canvas);
});
