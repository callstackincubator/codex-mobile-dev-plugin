import test from "node:test";
import assert from "node:assert/strict";
import { componentAt, componentsAt, screenComponents, formatAnnotationContext } from "../src/shared/screen-annotations.ts";
import { ScreenAnnotationsStore } from "../src/ui/screen-annotations.ts";
import type { ScreenAnnotation } from "../src/shared/screen-annotations.ts";
import { PanelContext } from "../src/ui/model-context.ts";
import { App } from "@modelcontextprotocol/ext-apps";
import { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { OpenAIExtensions, OpenAIModelContextHostState } from "@openai/mcp-extensions/app";
import { PNG, UDID } from "./fixtures.ts";

const simulator = { udid: UDID, name: "iPhone", runtime: "iOS 26", state: "Booted", platform: "ios" as const };
const capture = { screenshot: { id: "screen-1", data: PNG.toString("base64"), capturedAt: "2026-10-01T10:00:00Z" }, screen: { width: 393, height: 852, units: "points" as const } };
const component = { name: "Continue", identifier: "continue-button", role: "AXButton", depth: 2, bounds: { x: 10, y: 20, width: 100, height: 40 } };
const annotation: ScreenAnnotation = { ...capture, id: "note-1", number: 1, text: "Make this button larger", simulator, point: { x: 50, y: 40 }, component };

function fixture(messageApp?: App) {
  let current: OpenAIModelContextHostState | undefined;
  let failure: string | undefined;
  let failuresLeft = Infinity;
  let sendFailures = 0;
  let imageMessages = false;
  let imageAttachments = true;
  let rejected = false;
  let gate: Promise<void> | undefined;
  const updates: Parameters<App["updateModelContext"]>[0][] = [];
  const messages: Parameters<App["sendMessage"]>[0][] = [];
  const context = new PanelContext({
    getHostCapabilities: () => ({ message: { text: {}, ...(imageMessages ? { image: {} } : {}) }, updateModelContext: imageAttachments ? { image: {} } : {} }),
    async sendMessage(message: Parameters<App["sendMessage"]>[0], options: Parameters<App["sendMessage"]>[1]) { if (sendFailures-- > 0) throw new Error("MCP app messages require an available composer"); messages.push(message); return messageApp ? messageApp.sendMessage(message, options) : { isError: rejected }; },
  } as unknown as App, { modelContext: {
    getCurrent: () => current,
    async update(params: Parameters<App["updateModelContext"]>[0]) {
      updates.push(params); await gate;
      if (failure && failuresLeft-- > 0) throw new Error(failure);
      current = { ...params, updateId: String(updates.length) }; return { updateId: current.updateId };
    },
  } } as unknown as OpenAIExtensions);
  const store = new ScreenAnnotationsStore();
  store.connect(context); store.configure(simulator, false); store.capture = () => capture;
  store.readTree = async () => ({ elements: [{ ...component, label: component.name, frame: component.bounds }] });
  return { context, store, updates, messages,
    clear() { current = null; context.hostChanged(); },
    remove(id: string) { if (current) current = { ...current, updateId: "removed", content: current.content?.filter(item => item._meta?.["mobile-dev/annotationId"] !== id) }; context.hostChanged(); },
    fail() { failure = "Host refused context"; }, reject(value = true) { rejected = value; }, hold(value?: Promise<void>) { gate = value; },
    noComposer(count = Infinity) { failure = "MCP model context requires an available composer"; failuresLeft = count; },
    restoreComposer() { failure = undefined; }, imageMessages() { imageMessages = true; }, noImages() { imageAttachments = false; }, delayMessageComposer(count = 1) { sendFailures = count; },
  };
}

test("iOS hit testing selects nested elements and ignores hidden nodes and empty container frames", () => {
  const components = screenComponents({ role: "AXApplication", frame: { x: 0, y: 0, width: 0, height: 0 }, children: [
    { role: "AXButton", label: "Continue", identifier: "continue", frame: component.bounds, children: [{ role: "AXStaticText", label: "Text", frame: { x: 20, y: 30, width: 30, height: 10 } }] },
    { label: "Hidden", hidden: true, frame: component.bounds },
  ] });
  assert.equal(componentAt(components, { x: 25, y: 35 })?.name, "Text");
  assert.equal(componentAt(components, { x: 60, y: 40 })?.identifier, "continue");
  assert.equal(componentAt(components, { x: 110, y: 40 }), undefined);
});

test("Android hit testing uses pixel bounds and chooses the smallest flat node", () => {
  const components = screenComponents({ nodes: [
    { className: "android.widget.FrameLayout", bounds: { left: 0, top: 0, right: 1080, bottom: 2400 } },
    { text: "Sign in", resourceId: "app:id/sign_in", className: "android.widget.Button", bounds: { left: 80, top: 160, right: 300, bottom: 240 } },
  ] });
  const hit = componentAt(components, { x: 100, y: 200 });
  assert.equal(hit?.name, "Sign in"); assert.equal(hit?.bounds.width, 220); assert.equal(hit?.identifier, "app:id/sign_in");
});

test("screen-wide containers never win and smaller controls beat deeper containers", () => {
  const screen = { width: 393, height: 852 };
  const components = screenComponents({ role: "AXApplication", frame: { x: 0, y: 0, ...screen }, children: [
    { role: "AXWindow", frame: { x: 0, y: 0, ...screen }, children: [
      { role: "AXGroup", frame: { x: 0, y: 0, ...screen } },
      { role: "AXGroup", frame: { x: 5, y: 10, width: 300, height: 300 }, children: [
        { role: "AXGroup", frame: { x: 5, y: 10, width: 300, height: 300 } },
      ] },
      { role: "AXButton", label: "Continue", frame: component.bounds },
    ] },
  ] });
  assert.equal(components.some(item => item.role === "AXApplication" || item.role === "AXWindow"), false);
  assert.equal(componentAt(components, { x: 50, y: 40 }, screen)?.name, "Continue");
  assert.equal(componentAt(components, { x: 350, y: 500 }, screen), undefined);
});

test("a sparse accessibility tree supports explicit regions without pixel guesses", async () => {
  const f = fixture();
  f.store.readTree = async () => ({ role: "AXApplication", frame: { x: 0, y: 0, width: 393, height: 852 } });
  await f.store.toggle();
  f.store.hover({ x: 150, y: 280 });
  assert.equal(f.store.getSnapshot().hovered, undefined);
  assert.equal(f.store.beginSelection({ x: 300, y: 450 }), true);
  f.store.moveSelection({ x: 20, y: 400 });
  assert.deepEqual(f.store.getSnapshot().selectionBounds, { x: 20, y: 400, width: 280, height: 50 });
  f.store.endSelection({ x: 20, y: 400 });
  assert.equal(f.store.getSnapshot().selectionBounds, undefined);
  assert.deepEqual(f.store.getSnapshot().draft?.component.bounds, { x: 20, y: 400, width: 280, height: 50 });
  assert.equal(f.store.getSnapshot().draft?.component.role, "manual-region");
  f.store.setText("Make this button bigger"); await f.store.save();
  assert.match(JSON.stringify(f.updates.at(-1)?.content), /No component or source location was reported/);
  f.store.dispose();
});

test("pending inspection accepts clicks and upgrades the open note when elements arrive", async () => {
  const f = fixture();
  let release!: (tree: unknown) => void;
  f.store.readTree = () => new Promise(resolve => { release = resolve; });
  const reading = f.store.toggle();
  assert.equal(f.store.getSnapshot().loading, true);
  assert.equal(f.store.beginSelection({ x: 50, y: 40 }), true);
  f.store.endSelection({ x: 50, y: 40 });
  assert.equal(f.store.getSnapshot().draft?.component.name, "Screen point");
  f.store.setText("Make this wider");
  release({ label: "Continue", role: "AXButton", frame: component.bounds });
  await reading;
  assert.equal(f.store.getSnapshot().draft?.component.name, "Continue");
  assert.equal(f.store.getSnapshot().draft?.text, "Make this wider");
  f.store.dispose();
});

test("pending or failed inspection keeps manual region selection working", async () => {
  const f = fixture();
  let reject!: (error: Error) => void;
  f.store.readTree = () => new Promise((_resolve, fail) => { reject = fail; });
  const reading = f.store.toggle();
  f.store.beginSelection({ x: 10, y: 20 });
  f.store.endSelection({ x: 110, y: 60 });
  reject(new Error("Request timed out"));
  await reading;
  assert.equal(f.store.getSnapshot().draft?.component.role, "manual-region");
  assert.deepEqual(f.store.getSnapshot().draft?.component.bounds, component.bounds);
  f.store.dispose();
});

test("real parents remain selectable without choosing overlapping siblings", async () => {
  const tree = { role: "AXGroup", label: "Card", frame: { x: 10, y: 100, width: 350, height: 70 }, children: [
    { role: "AXStaticText", label: "Title", frame: { x: 30, y: 120, width: 150, height: 20 } },
    { role: "AXGroup", label: "Overlapping sibling", frame: { x: 20, y: 110, width: 200, height: 40 } },
  ] };
  const items = screenComponents(tree);
  const candidates = componentsAt(items, { x: 40, y: 125 }, capture.screen);
  assert.deepEqual(candidates.map(item => item.name), ["Title", "Card"]);
  assert.equal(candidates[0].parentId, candidates[1].nodeId);
  assert.equal(componentAt(items, { x: 300, y: 130 }, capture.screen)?.name, "Card");
  const f = fixture();
  f.store.readTree = async () => tree;
  await f.store.toggle();
  f.store.select({ x: 40, y: 125 });
  f.store.setText("Keep this note");
  f.store.chooseComponent(f.store.getSnapshot().candidates[1]);
  assert.equal(f.store.getSnapshot().draft?.component.name, "Card");
  assert.equal(f.store.getSnapshot().draft?.text, "Keep this note");
  f.store.dispose();
});

test("flat MCP snapshots retain element names, depths and real parents", async () => {
  const tree = { source: "react-native", role: "Pressable", label: "Card", frame: { x: 10, y: 100, width: 350, height: 70 }, children: [
    { source: "react-native", role: "Text", label: "Title", frame: { x: 30, y: 120, width: 150, height: 20 } },
    { source: "react-native", role: "View", frame: { x: 20, y: 110, width: 200, height: 40 } },
  ] };
  const items = screenComponents(tree);
  const snapshot = JSON.parse(JSON.stringify(items));
  assert.deepEqual(screenComponents(snapshot), items);
  const f = fixture();
  f.store.readTree = async () => snapshot;
  await f.store.toggle();
  f.store.hover({ x: 300, y: 130 });
  assert.equal(f.store.getSnapshot().hovered?.name, "Card");
  f.store.select({ x: 40, y: 125 });
  assert.deepEqual(f.store.getSnapshot().candidates.map(item => item.name), ["Title", "Card"]);
  f.store.chooseComponent(f.store.getSnapshot().candidates[1]);
  assert.equal(f.store.getSnapshot().draft?.component.name, "Card");
  f.store.dispose();
});

test("a saved and sent note retains its source location, owners, testID and nearby text", async () => {
  const react = { component: "Text", owners: ["HomeScreen", "CardRow", "Text"], source: { file: "/project/src/HomeScreen.tsx", line: 49, column: 11, functionName: "HomeScreen.renderItem" } };
  const f = fixture();
  f.store.readTree = async () => [{ ...component, source: "react-native", react, label: "Continue" }, { name: "Go to the next step", label: "Go to the next step", role: "Text", bounds: { x: 10, y: 65, width: 100, height: 20 } }];
  await f.store.toggle(); f.store.select({ x: 50, y: 40 }); f.store.setText("Make this larger"); await f.store.save();
  assert.deepEqual(f.context.screenAnnotations[0].component.react, react);
  assert.deepEqual(f.context.screenAnnotations[0].nearbyText, ["Go to the next step"]);
  const message = f.updates.at(-1)!.content!.find(item => item._meta?.["mobile-dev/annotationId"] === f.context.screenAnnotations[0].id)!;
  await f.store.send();
  assert.equal(message.type, "text");
  if (message.type !== "text") return;
  assert.match(message.text, /Edit location: \/project\/src\/HomeScreen\.tsx:49:11/);
  assert.match(message.text, /React owners, outer to inner: HomeScreen > CardRow > Text/);
  assert.match(message.text, /testID: "continue-button"/);
  assert.match(message.text, /Nearby text.*Go to the next step/);
  assert.ok(message.text.indexOf("Edit location") < message.text.indexOf("Position fallback"));
  assert.doesNotMatch(message.text, /screenshot|note-1|screen-1/);
  f.store.dispose();
});

test("native and manual annotations do not invent React components or source locations", () => {
  assert.match(formatAnnotationContext(annotation), /Accessibility element only/);
  assert.doesNotMatch(formatAnnotationContext(annotation), /React component:|Edit location:/);
  const manual = { ...annotation, component: { ...component, source: "screen" as const, role: "manual-region" } };
  assert.match(formatAnnotationContext(manual), /Manual selection/);
  assert.doesNotMatch(formatAnnotationContext(manual), /React component:|Edit location:/);
});

test("region drags clamp to screen bounds and cancel without creating a note", async () => {
  const f = fixture();
  await f.store.toggle();
  f.store.beginSelection({ x: 10, y: 10 });
  f.store.moveSelection({ x: 900, y: 900 });
  assert.deepEqual(f.store.getSnapshot().selectionBounds, { x: 10, y: 10, width: 383, height: 842 });
  f.store.cancelSelection();
  f.store.endSelection({ x: 50, y: 50 });
  assert.equal(f.store.getSnapshot().draft, undefined);
  f.store.beginSelection({ x: 20, y: 20 });
  f.store.configure(simulator, true);
  f.store.endSelection({ x: 100, y: 100 });
  assert.equal(f.store.getSnapshot().draft, undefined);
  assert.equal(f.store.getSnapshot().selectionBounds, undefined);
  f.store.dispose();
});

test("multiple notes attach as text, keep captures local, and survive device changes", async () => {
  const f = fixture();
  f.context.selectSimulator(simulator);
  await f.context.attachAnnotation(annotation);
  await f.context.attachAnnotation({ ...annotation, id: "note-2", number: 2, text: "Use a darker color" });
  const update = f.updates.at(-1)!;
  assert.equal(update.content?.filter(item => item.type === "image").length, 0);
  assert.doesNotMatch(JSON.stringify(update), new RegExp(capture.screenshot.data));
  assert.deepEqual(update.structuredContent?.annotationIds, ["note-1", "note-2"]);
  assert.match(JSON.stringify(update.content), /continue-button/);
  assert.match(JSON.stringify(update.content), /Make this button larger/);
  assert.deepEqual((update.structuredContent?.screenAnnotations as { point: { x: number; y: number } }[])[0].point, { x: 50, y: 40 });
  f.store.configure({ ...simulator, udid: "other-device" }, false);
  assert.equal(f.store.getSnapshot().annotations.length, 0);
  assert.equal(f.context.screenAnnotations.length, 2);
  f.store.configure(simulator, false);
  assert.equal(f.store.getSnapshot().annotations.length, 2);
  await f.context.removeAnnotation("note-1");
  assert.equal(f.updates.at(-1)?.content?.filter(item => item.type === "image").length, 0);
  await f.context.removeAnnotation("note-2");
  assert.equal(f.updates.at(-1)?.content?.filter(item => item.type === "image").length, 0);
  f.store.dispose();
});

test("annotations work on text-only hosts and preserve explicitly attached screenshots", async () => {
  const f = fixture(); f.noImages();
  assert.equal(f.context.canAttachScreenshots, false);
  await f.context.attachAnnotation(annotation);
  await f.context.sendAnnotationsToChat(simulator.udid);
  assert.equal(f.messages[0].content.some(item => item.type === "image"), false);
  const images = fixture();
  await images.context.attachScreenshot({ id: "explicit", data: capture.screenshot.data, simulator });
  await images.context.attachAnnotation(annotation);
  assert.equal(images.updates.at(-1)?.content?.filter(item => item.type === "image").length, 1);
  assert.equal(images.updates.at(-1)?.content?.find(item => item.type === "image")?._meta?.["mobile-dev/screenshotId"], "explicit");
  f.store.dispose(); images.store.dispose();
});

test("host removals clear markers and a later device selection does not reattach notes", async () => {
  const f = fixture();
  await f.context.attachAnnotation(annotation);
  await f.context.attachAnnotation({ ...annotation, id: "note-2", number: 2 });
  f.remove("note-1"); assert.equal(f.store.getSnapshot().annotations.length, 1);
  f.clear(); assert.equal(f.store.getSnapshot().annotations.length, 0);
  f.context.selectSimulator(simulator); await f.context.attach(undefined);
  assert.deepEqual(f.updates.at(-1)?.structuredContent?.annotationIds, []);
  f.store.dispose();
});

test("a failed annotation write preserves the draft for retry", async () => {
  const f = fixture(); await f.store.toggle(); f.store.select({ x: 50, y: 40 }); f.store.setText("Make this wider");
  f.fail(); await f.store.save();
  assert.equal(f.context.screenAnnotations.length, 0);
  assert.equal(f.store.getSnapshot().draft?.text, "Make this wider");
  assert.match(f.store.getSnapshot().error, /Host refused/);
  assert.equal(f.store.getSnapshot().busy, false);
  f.store.dispose();
});

test("a host clear during a write wins and removes the note and image", async () => {
  const f = fixture(); let release!: () => void;
  f.hold(new Promise<void>(resolve => { release = resolve; }));
  const writing = f.context.attachAnnotation(annotation);
  await new Promise(resolve => setTimeout(resolve, 0)); f.clear(); release();
  assert.equal(await writing, false);
  await f.context.attach(undefined);
  assert.deepEqual(f.updates.at(-1)?.structuredContent?.annotationIds, []);
  assert.equal(f.updates.at(-1)?.content?.some(item => item.type === "image"), false);
  f.store.dispose();
});

test("selecting supports hover, multiple notes, edits, regions, and Escape without stale tree updates", async () => {
  const f = fixture(); await f.store.toggle();
  f.store.hover({ x: 50, y: 40 }); assert.equal(f.store.getSnapshot().hovered?.name, "Continue");
  f.store.select({ x: 50, y: 40 }); f.store.setText("Make it bigger"); await f.store.save();
  assert.equal(f.store.getSnapshot().annotations.length, 1); assert.equal(f.store.getSnapshot().draft, undefined);
  f.store.select({ x: 250, y: 250 }); assert.equal(f.store.getSnapshot().draft?.component.name, "Screen point");
  f.store.setText("Add a heading"); await f.store.save();
  assert.equal(f.store.getSnapshot().annotations[1].number, 2);
  f.store.edit(f.context.screenAnnotations[0]); f.store.setText("Make it blue"); await f.store.save();
  assert.equal(f.context.screenAnnotations.length, 2); assert.equal(f.context.screenAnnotations.at(-1)?.text, "Make it blue");
  f.store.exit();
  let release!: (value: unknown) => void;
  f.store.readTree = () => new Promise(resolve => { release = resolve; });
  const reading = f.store.toggle(); f.store.exit(); release({ elements: [component] }); await reading;
  assert.equal(f.store.getSnapshot().selecting, false); assert.equal(f.store.getSnapshot().loading, false);
  f.store.dispose();
});

test("send preserves every note in text attachments without automatic screenshots, and reports rejection", async () => {
  const f = fixture();
  await f.context.attachAnnotation(annotation);
  await f.context.attachAnnotation({ ...annotation, id: "note-2", number: 2, text: "Use a darker color" });
  f.reject(); await f.store.send();
  assert.match(f.store.getSnapshot().error, /Could not send/);
  assert.equal(f.context.screenAnnotations.length, 2);
  f.reject(false); await f.store.send();
  assert.equal(f.messages.length, 2);
  assert.match(JSON.stringify(f.updates.at(-1)?.content), /Make this button larger/);
  assert.match(JSON.stringify(f.updates.at(-1)?.content), /Use a darker color/);
  assert.match(JSON.stringify(f.updates.at(-1)?.content), /393/);
  assert.equal(f.messages[0].content[0].type, "text");
  assert.match(JSON.stringify(f.messages[0].content), /attached simulator screen annotations/);
  assert.equal(f.updates.at(-1)?.content?.some(item => item.type === "image"), false);
  assert.equal(f.messages[0].content.some(item => item.type === "image"), false);
  assert.equal(f.context.screenAnnotations.length, 0);
  assert.deepEqual(f.messages[0]._meta?.["openai/message"], { target: "active", send: true });
  f.store.dispose();
});

test("an annotation retries while a restored chat registers its composer", async () => {
  const f = fixture(); f.noComposer(1);
  await f.store.toggle(); f.store.select({ x: 50, y: 40 }); f.store.setText("Make this wider"); await f.store.save();
  assert.equal(f.updates.length, 2);
  assert.equal(f.context.annotationsPending, false);
  assert.equal(f.store.getSnapshot().annotations.length, 1);
  assert.match(f.store.getSnapshot().status, /Attached/);
  f.store.dispose();
});

test("an unavailable composer keeps notes locally and reattaches them on return", async () => {
  const f = fixture(); f.noComposer();
  await f.store.toggle(); f.store.select({ x: 50, y: 40 }); f.store.setText("Make this wider"); await f.store.save();
  assert.equal(f.context.annotationsPending, true);
  assert.equal(f.store.getSnapshot().draft, undefined);
  assert.match(f.store.getSnapshot().status, /Note saved/);
  f.clear(); assert.equal(f.context.screenAnnotations.length, 1);
  f.restoreComposer(); f.context.resume();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(f.context.annotationsPending, false);
  assert.equal(f.updates.at(-1)?.content?.some(item => item.type === "image"), false);
  f.store.dispose();
});

test("even image-capable chats send annotations as text without a composer context write", async () => {
  const f = fixture(); await f.context.attachAnnotation(annotation);
  const writes = f.updates.length;
  f.imageMessages(); f.noComposer(); f.delayMessageComposer();
  await f.store.send();
  assert.equal(f.updates.length, writes);
  assert.equal(f.messages.length, 1);
  assert.equal(f.messages[0].content.filter(item => item.type === "image").length, 0);
  assert.equal(f.context.screenAnnotations.length, 0);
  assert.equal(f.store.getSnapshot().error, "");
  f.store.dispose();
});

test("clearing notes during a composer retry cancels the message", async () => {
  const f = fixture(); await f.context.attachAnnotation(annotation); f.imageMessages(); f.delayMessageComposer();
  const sending = f.context.sendAnnotationsToChat(simulator.udid);
  const rejected = assert.rejects(sending, /removed from chat before sending/);
  await new Promise(resolve => setTimeout(resolve, 0)); f.clear();
  await rejected;
  assert.equal(f.messages.length, 0);
  f.store.dispose();
});

test("a second batch survives a missing composer and sends after a manual retry", async () => {
  const f = fixture(); await f.context.attachAnnotation(annotation); await f.store.send();
  await f.context.attachAnnotation({ ...annotation, id: "next-batch", text: "SECOND_BATCH" });
  f.delayMessageComposer(Infinity); await f.store.send();
  assert.equal(f.store.getSnapshot().busy, false);
  assert.equal(f.store.getSnapshot().sending, false);
  assert.match(f.store.getSnapshot().sendError, /Codex could not find this chat's input/);
  assert.equal(f.context.screenAnnotations.length, 1);
  assert.match(f.store.messageText, /SECOND_BATCH/);
  assert.doesNotMatch(f.store.messageText, /Make this button larger|data:image|AA==/);
  f.delayMessageComposer(0); await f.store.send();
  assert.equal(f.messages.length, 2);
  assert.equal(f.messages[1].content[0].type, "text");
  assert.equal(f.store.getSnapshot().sendError, "");
  assert.equal(f.context.screenAnnotations.length, 0);
  f.store.dispose();
});

test("a stalled SDK send times out, unlocks after a stream reset, and never resends automatically", async t => {
  const app = new App({ name: "annotation-test", version: "1" }, {}, { autoResize: false });
  const bridge = new AppBridge(null, { name: "host-test", version: "1" }, { message: { text: {} } });
  let attempts = 0;
  bridge.onmessage = async () => { attempts++; return new Promise(() => {}); };
  const [appTransport, hostTransport] = InMemoryTransport.createLinkedPair();
  await bridge.connect(hostTransport); await app.connect(appTransport);
  const f = fixture(app);
  t.after(async () => { f.store.dispose(); await app.close(); await bridge.close(); });
  await f.context.attachAnnotation(annotation);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sending = f.store.send();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.store.getSnapshot().sending, true);
  f.store.configure(simulator, true); f.store.configure(simulator, false);
  await f.store.send();
  assert.equal(attempts, 1, "A stream reset must not allow a duplicate send.");
  t.mock.timers.tick(5000); await sending;
  assert.equal(f.store.getSnapshot().busy, false);
  assert.equal(f.store.getSnapshot().sending, false);
  assert.match(f.store.getSnapshot().sendError, /did not confirm delivery.*before retrying/);
  assert.equal(f.context.screenAnnotations.length, 1);
  t.mock.timers.tick(60000); await new Promise(resolve => setImmediate(resolve));
  assert.equal(attempts, 1);
  bridge.onmessage = async () => { attempts++; return {}; };
  await f.store.send();
  assert.equal(attempts, 2);
  assert.equal(f.store.getSnapshot().sendError, "");
  assert.equal(f.context.screenAnnotations.length, 0);
});

test("a fresh annotation batch starts at one after chat clears or sends the prior batch", async () => {
  const f = fixture(); await f.store.toggle();
  f.store.select({ x: 50, y: 40 }); f.store.setText("First"); await f.store.save();
  f.clear(); f.store.select({ x: 50, y: 40 });
  assert.equal(f.store.getSnapshot().draft?.number, 1);
  f.store.setText("Second batch"); await f.store.save(); await f.store.send();
  f.store.configure(simulator, true); f.store.configure(simulator, false);
  await f.store.toggle(); f.store.select({ x: 50, y: 40 });
  assert.equal(f.store.getSnapshot().draft?.number, 1);
  f.store.setText("Keep this draft"); f.store.configure(simulator, true);
  assert.equal(f.store.getSnapshot().draft?.text, "Keep this draft");
  f.store.dispose();
});
