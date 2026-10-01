import test from "node:test";
import assert from "node:assert/strict";
import type { App } from "@modelcontextprotocol/ext-apps";
import type { OpenAIExtensions } from "@openai/mcp-extensions/app";
import type { ScreenAnnotation } from "../src/shared/screen-annotations.ts";
import { PanelContext } from "../src/ui/model-context.ts";
import { ANNOTATION_EDIT_GUIDANCE, ANNOTATION_EDIT_PROMPT, formatAnnotationContext, formatAnnotationMessage } from "../src/shared/screen-annotations.ts";

const annotation: ScreenAnnotation = {
  id: "header-note", number: 1, text: "Make this\n  smaller.",
  simulator: { udid: "test-device", name: "iPhone", runtime: "iOS 26", state: "Booted", platform: "ios" },
  component: { name: "Header title", depth: 2, bounds: { x: 20, y: 80, width: 200, height: 30 },
    react: { component: "Text", owners: ["Header"], source: { file: "/app/src/Header.tsx", line: 12 } } },
  point: { x: 40, y: 90 }, screen: { width: 402, height: 874, units: "points" },
  screenshot: { id: "local-capture", data: "local-only", capturedAt: "2026-10-01T10:00:00Z" },
};

function fixture() {
  let composerAvailable = true;
  const updates: Parameters<App["updateModelContext"]>[0][] = [];
  const messages: Parameters<App["sendMessage"]>[0][] = [];
  const context = new PanelContext({
    getHostCapabilities: () => ({ message: { text: {} } }),
    async sendMessage(message: Parameters<App["sendMessage"]>[0]) { messages.push(message); return {}; },
  } as unknown as App, { modelContext: {
    async update(params: Parameters<App["updateModelContext"]>[0]) {
      if (!composerAvailable) throw new Error("MCP model context requires an available composer");
      updates.push(params); return { updateId: String(updates.length) };
    },
  } } as unknown as OpenAIExtensions);
  return { context, updates, messages, composer(available: boolean) { composerAvailable = available; } };
}

test("annotation chips show element and note titles while preserving full model context", async () => {
  const f = fixture();
  await f.context.attachAnnotation(annotation);
  const attachment = f.updates.at(-1)!.content!.find(item => item._meta?.["mobile-dev/annotationId"] === annotation.id)!;
  assert.equal(attachment._meta?.["openai/title"], "Header title: Make this smaller.");
  assert.equal(attachment.type, "text");
  if (attachment.type !== "text") return;
  assert.match(attachment.text, /\/app\/src\/Header\.tsx:12/);
  assert.doesNotMatch(attachment.text, /Bounds:|Captured at|Device:/);
  assert.equal(f.updates.at(-1)!.structuredContent?.screenAnnotations, undefined);
  assert.equal(f.updates.at(-1)!.content!.some(item => item.type === "image"), false);
  await f.context.sendAnnotationsToChat(annotation.simulator.udid);
  assert.deepEqual(f.messages[0].content, [{ type: "text", text: ANNOTATION_EDIT_PROMPT }]);
  assert.equal(f.context.screenAnnotations.length, 0);
});

test("annotation instructions remain distinct from display text on attachment and copy routes", async () => {
  const f = fixture();
  const note = { ...annotation, text: "change to hi max", component: { ...annotation.component, label: "Interactive destination" } };
  await f.context.attachAnnotation(note); await f.context.sendAnnotationsToChat(note.simulator.udid);
  const sent = f.messages[0].content[0];
  assert.equal(sent.type, "text");
  if (sent.type !== "text") return;
  assert.equal(sent.text, "Apply these annotations.");
  const guidance = f.updates.at(-1)!.content!.filter(item => item.type === "text" && item.text === ANNOTATION_EDIT_GUIDANCE);
  assert.equal(guidance.length, 1);
  assert.deepEqual(guidance[0].annotations?.audience, ["assistant"]);
  const details = formatAnnotationContext(note);
  assert.match(details, /Edit: "change to hi max"/);
  assert.match(details, /Target: "Interactive destination"/);
  assert.equal(formatAnnotationMessage([note]), `${sent.text}\n${ANNOTATION_EDIT_GUIDANCE}\n\n${details}`);
  const style = formatAnnotationMessage([{ ...note, text: "make this orange" }]);
  assert.match(style, /Apply each Edit as a request, not verbatim app text/);
  assert.match(style, /"make this orange"/);
});

test("deferred annotation chips attach before sending the short message", async () => {
  const f = fixture(); f.composer(false);
  await f.context.attachAnnotation(annotation);
  assert.equal(f.context.annotationsPending, true);
  f.composer(true);
  await f.context.sendAnnotationsToChat(annotation.simulator.udid);
  assert.equal(f.updates.length, 1);
  assert.equal(f.messages.length, 1);
  assert.equal(f.context.annotationsPending, false);
});

test("an unavailable composer keeps deferred chips and does not send a message without context", async () => {
  const f = fixture(); f.composer(false);
  await f.context.attachAnnotation(annotation);
  await assert.rejects(f.context.sendAnnotationsToChat(annotation.simulator.udid), /could not find this chat's input/);
  assert.equal(f.messages.length, 0);
  assert.equal(f.context.screenAnnotations.length, 1);
});

test("batch context shares hidden guidance once and bounds locator text without cutting edits", async () => {
  const f = fixture();
  const note = { ...annotation, text: "change to hi max\n".repeat(100), nearbyText: ["Header title", "Header title", "detail".repeat(100), "second", "third", "fourth"], component: { ...annotation.component, react: { ...annotation.component.react!, owners: ["App", "Root", "Navigator", "Screen", "Card", "Header", "Text"] } } };
  await f.context.attachAnnotation(note);
  await f.context.attachAnnotation({ ...annotation, id: "second-note", number: 2 });
  const update = f.updates.at(-1)!;
  const guidance = update.content!.filter(item => item.type === "text" && item.text === ANNOTATION_EDIT_GUIDANCE);
  assert.equal(guidance.length, 1);
  assert.deepEqual(guidance[0].annotations?.audience, ["assistant"]);
  const details = formatAnnotationContext(note);
  assert.ok(details.includes(`Edit: ${JSON.stringify(note.text)}`));
  assert.match(details, /React: Navigator > Screen > Card > Header > Text/);
  assert.doesNotMatch(details, /fourth|Root|Bounds:|Captured at/);
  assert.equal(details.split("\n").filter(line => line.startsWith("Nearby:"))[0].length < 200, true);
  assert.equal(update.structuredContent?.screenAnnotations, undefined);
  assert.ok(formatAnnotationContext(annotation).length < 200);
});
