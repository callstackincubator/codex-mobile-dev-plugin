import test from "node:test";
import assert from "node:assert/strict";
import { componentAt, componentsAt, screenComponents } from "../src/shared/screen-annotations.ts";
import { ScreenAnnotationsStore } from "../src/ui/screen-annotations.ts";
import type { ScreenAnnotation } from "../src/shared/screen-annotations.ts";
import { PanelContext } from "../src/ui/model-context.ts";
import type { App } from "@modelcontextprotocol/ext-apps";
import type { OpenAIExtensions, OpenAIModelContextHostState } from "@openai/mcp-extensions/app";
import { PNG, UDID } from "./fixtures.ts";

const simulator = { udid: UDID, name: "iPhone", runtime: "iOS 26", state: "Booted", platform: "ios" as const };
const capture = { screenshot: { id: "screen-1", data: PNG.toString("base64"), capturedAt: "2026-10-01T10:00:00Z" }, screen: { width: 393, height: 852, units: "points" as const } };
const component = { name: "Continue", identifier: "continue-button", role: "AXButton", depth: 2, bounds: { x: 10, y: 20, width: 100, height: 40 } };
const annotation: ScreenAnnotation = { ...capture, id: "note-1", number: 1, text: "Make this button larger", simulator, point: { x: 50, y: 40 }, component };

function fixture() {
  let current: OpenAIModelContextHostState | undefined;
  let failure: string | undefined;
  let failuresLeft = Infinity;
  let sendFailures = 0;
  let imageMessages = false;
  let rejected = false;
  let gate: Promise<void> | undefined;
  const updates: Parameters<App["updateModelContext"]>[0][] = [];
  const messages: Parameters<App["sendMessage"]>[0][] = [];
  const context = new PanelContext({
    getHostCapabilities: () => ({ message: { text: {}, ...(imageMessages ? { image: {} } : {}) }, updateModelContext: { image: {} } }),
    async sendMessage(message: Parameters<App["sendMessage"]>[0]) { if (sendFailures-- > 0) throw new Error("MCP app messages require an available composer"); messages.push(message); return { isError: rejected }; },
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
    restoreComposer() { failure = undefined; }, imageMessages() { imageMessages = true; }, delayMessageComposer() { sendFailures = 1; },
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
  assert.match(JSON.stringify(f.updates.at(-1)?.content), /No native component name is available/);
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

test("multiple notes attach with one capture, survive device changes, and retain element metadata", async () => {
  const f = fixture();
  f.context.selectSimulator(simulator);
  await f.context.attachAnnotation(annotation);
  await f.context.attachAnnotation({ ...annotation, id: "note-2", number: 2, text: "Use a darker color" });
  const update = f.updates.at(-1)!;
  assert.equal(update.content?.filter(item => item.type === "image").length, 1);
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
  assert.equal(f.updates.at(-1)?.content?.filter(item => item.type === "image").length, 1);
  await f.context.removeAnnotation("note-2");
  assert.equal(f.updates.at(-1)?.content?.filter(item => item.type === "image").length, 0);
  f.store.dispose();
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

test("send includes every note and original coordinates with captures in model context, and reports rejection", async () => {
  const f = fixture();
  await f.context.attachAnnotation(annotation);
  await f.context.attachAnnotation({ ...annotation, id: "note-2", number: 2, text: "Use a darker color" });
  f.reject(); await f.store.send();
  assert.match(f.store.getSnapshot().error, /Could not send/);
  assert.equal(f.context.screenAnnotations.length, 2);
  f.reject(false); await f.store.send();
  assert.equal(f.messages.length, 2);
  assert.match(JSON.stringify(f.messages[0].content), /Make this button larger/);
  assert.match(JSON.stringify(f.messages[0].content), /Use a darker color/);
  assert.match(JSON.stringify(f.messages[0].content), /393/);
  assert.equal(f.updates.at(-1)?.content?.some(item => item.type === "image"), true);
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
  assert.equal(f.updates.at(-1)?.content?.some(item => item.type === "image"), true);
  f.store.dispose();
});

test("image-capable chats send the complete capture without a composer context write", async () => {
  const f = fixture(); await f.context.attachAnnotation(annotation);
  const writes = f.updates.length;
  f.imageMessages(); f.noComposer(); f.delayMessageComposer();
  await f.store.send();
  assert.equal(f.updates.length, writes);
  assert.equal(f.messages.length, 1);
  assert.equal(f.messages[0].content.filter(item => item.type === "image").length, 1);
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
