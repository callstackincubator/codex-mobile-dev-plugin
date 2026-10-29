import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { recordingFixture } from "@mobile-dev/test-support/recording-fixtures.ts";
import { recordingPreview } from "@mobile-dev/shared/recordings.ts";

// Tools that show a recording send its ID and, when it fits, a preview without thread or
// frame detail: hosts cap tool results (Codex keeps ~50 KB), and some let cards call
// tools (Codex, Claude chat) while others do not (Claude Code). Cards draw the preview
// and read the full recording where they can.

const built = await build({
  stdin: { contents: `
    export { RecordingController } from "./packages/ui/src/recording-controller.ts";
    export { ComparisonController } from "./packages/ui/src/comparison-controller.ts";`, resolveDir: process.cwd(), loader: "ts" },
  bundle: true, write: false, format: "iife", globalName: "Cards", platform: "browser",
  define: { "process.env.NODE_ENV": '"production"' },
});

type Call = { name: string; arguments: Record<string, unknown> };
function load(read: (call: Call) => unknown, { cardsCallTools = true } = {}) {
  const dom = new JSDOM("<html><body></body></html>", { runScripts: "outside-only", url: "https://mobile-dev.test/" });
  dom.window.eval(built.outputFiles[0].text);
  const calls: Call[] = [];
  const app = {
    getHostCapabilities() { return cardsCallTools ? { serverTools: {}, message: { text: {} } } : {}; },
    async callServerTool(call: Call) { calls.push(call); return read(call); },
  };
  return { cards: (dom.window as unknown as { Cards: Record<string, new (app: unknown) => any> }).Cards, app, calls, close: () => dom.window.close() };
}
// Objects made inside the page come from its realm; compare them as plain data.
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
async function until(condition: () => boolean) {
  for (let attempt = 0; attempt < 100 && !condition(); attempt++) await setTimeout(5);
  assert.ok(condition());
}

test("a recording reference makes the card read the recording with its range", async t => {
  const recording = recordingFixture();
  const { cards, app, calls, close } = load(() => ({ content: [], structuredContent: { recording, summary: {}, range: { start: 2, end: 8 } } }));
  t.after(close);
  const controller = new cards.RecordingController(app);
  controller.accept({ content: [], structuredContent: { recordingId: recording.id, title: recording.title, status: "finished", durationSeconds: 30, range: { start: 2, end: 8 }, summary: {} } });
  await until(() => controller.getSnapshot().recording !== undefined);
  assert.deepEqual(plain(calls), [{ name: "mobile_read_performance_recording", arguments: { recordingId: recording.id } }]);
  assert.equal(controller.getSnapshot().recording.id, recording.id);
  assert.deepEqual(plain(controller.getSnapshot().range), { start: 2, end: 8 });
  controller.dispose();
});

test("a recording from an older server renders without reading it again", async t => {
  const recording = recordingFixture();
  const { cards, app, calls, close } = load(() => { throw new Error("must not read"); });
  t.after(close);
  const controller = new cards.RecordingController(app);
  controller.accept({ content: [], structuredContent: { recording, summary: {} } });
  assert.equal(controller.getSnapshot().recording.id, recording.id);
  assert.deepEqual(calls, []);
  controller.dispose();
});

test("a host that drops the samples shows an error instead of loading forever", async t => {
  const recording = recordingFixture();
  // Codex trims large results to text and drops their structured content.
  const { cards, app, close } = load(() => ({ content: [{ type: "text", text: "{\"recording\":{\"id\"" }] }));
  t.after(close);
  const controller = new cards.RecordingController(app);
  controller.accept({ content: [], structuredContent: { recordingId: recording.id, title: recording.title, status: "finished", durationSeconds: 30, summary: {} } });
  await until(() => controller.getSnapshot().error !== "");
  assert.match(controller.getSnapshot().error, /Could not load this recording/);
  assert.equal(controller.getSnapshot().recording, undefined);
  controller.dispose();
});

test("a comparison reference makes the card read every recording", async t => {
  const first = recordingFixture();
  const second = { ...recordingFixture(), id: "44b7030b-a74e-466f-aeb0-bcd3ae8af972", title: "Run 2" };
  const byId = new Map([[first.id, first], [second.id, second]]);
  const { cards, app, calls, close } = load(call => ({ content: [], structuredContent: { recording: byId.get(call.arguments.recordingId as string), summary: {} } }));
  t.after(close);
  const controller = new cards.ComparisonController(app);
  controller.accept({ content: [], structuredContent: { title: "Before and after", recordingIds: [first.id, second.id], range: { start: 0, end: 10 }, summaries: [] } });
  await until(() => controller.getSnapshot().comparison !== undefined);
  assert.deepEqual(calls.map(call => call.arguments.recordingId), [first.id, second.id]);
  const { comparison, range } = controller.getSnapshot();
  assert.equal(comparison.title, "Before and after");
  assert.deepEqual(plain(comparison.recordings.map((recording: { title: string }) => recording.title)), [first.title, "Run 2"]);
  assert.deepEqual(plain(range), { start: 0, end: 10 });
  controller.dispose();
});

test("a comparison whose recording cannot be read reports it", async t => {
  const first = recordingFixture();
  const { cards, app, close } = load(call => call.arguments.recordingId === first.id
    ? { content: [], structuredContent: { recording: first, summary: {} } }
    : { isError: true, content: [{ type: "text", text: "Recording not found." }] });
  t.after(close);
  const controller = new cards.ComparisonController(app);
  controller.accept({ content: [], structuredContent: { title: "Missing run", recordingIds: [first.id, "27cfecab-d99c-4533-90dd-e14a7cb0087b"], summaries: [] } });
  await until(() => controller.getSnapshot().error !== "");
  assert.equal(controller.getSnapshot().error, "Recording not found.");
  assert.equal(controller.getSnapshot().comparison, undefined);
  controller.dispose();
});

const reference = (recording: ReturnType<typeof recordingFixture>, extra: object = {}) =>
  ({ content: [], structuredContent: { recordingId: recording.id, title: recording.title, status: "finished", durationSeconds: 30, summary: {}, ...extra } });

test("where cards cannot call tools, the preview is the chart", async t => {
  const recording = recordingFixture();
  const { cards, app, calls, close } = load(() => { throw new Error("must not read"); }, { cardsCallTools: false });
  t.after(close);
  const controller = new cards.RecordingController(app);
  controller.accept(reference(recording, { preview: recordingPreview(recording) }));
  const state = controller.getSnapshot();
  assert.equal(state.recording.samples.length, recording.samples.length);
  assert.equal(state.preview, "only");
  assert.equal(state.error, "");
  assert.deepEqual(calls, []);
  controller.dispose();
});

test("where cards can call tools, the full recording replaces the preview and keeps the selection", async t => {
  const recording = recordingFixture();
  let release!: () => void;
  const reading = new Promise<void>(resolve => { release = resolve; });
  const { cards, app, close } = load(async () => { await reading; return { content: [], structuredContent: { recording, summary: {} } }; });
  t.after(close);
  const controller = new cards.RecordingController(app);
  controller.accept(reference(recording, { preview: recordingPreview(recording) }));
  assert.equal(controller.getSnapshot().preview, "loading");
  assert.equal(controller.getSnapshot().recording.samples[0].threads.length, 0);
  controller.select({ start: 3, end: 9 });
  release();
  await until(() => controller.getSnapshot().preview === undefined);
  assert.ok(controller.getSnapshot().recording.samples[0].threads.length > 0);
  assert.deepEqual(plain(controller.getSnapshot().range), { start: 3, end: 9 });
  controller.dispose();
});

test("a failed read keeps the preview on screen", async t => {
  const recording = recordingFixture();
  const { cards, app, close } = load(() => ({ content: [{ type: "text", text: "{\"recording\":" }] }));
  t.after(close);
  const controller = new cards.RecordingController(app);
  controller.accept(reference(recording, { preview: recordingPreview(recording) }));
  await until(() => controller.getSnapshot().preview === "only");
  assert.equal(controller.getSnapshot().error, "");
  assert.equal(controller.getSnapshot().recording.id, recording.id);
  controller.dispose();
});

test("without a preview or tool calls the card explains it cannot load the recording", async t => {
  const recording = recordingFixture();
  const { cards, app, close } = load(() => { throw new Error("must not read"); }, { cardsCallTools: false });
  t.after(close);
  const controller = new cards.RecordingController(app);
  controller.accept(reference(recording));
  assert.match(controller.getSnapshot().error, /cannot load the recording/);
  controller.dispose();
});

test("comparison previews show where cards cannot call tools", async t => {
  const first = recordingFixture();
  const second = { ...recordingFixture(), id: "44b7030b-a74e-466f-aeb0-bcd3ae8af972", title: "Run 2" };
  const { cards, app, calls, close } = load(() => { throw new Error("must not read"); }, { cardsCallTools: false });
  t.after(close);
  const controller = new cards.ComparisonController(app);
  controller.accept({ content: [], structuredContent: { title: "Before and after", recordingIds: [first.id, second.id], summaries: [], previews: [recordingPreview(first), recordingPreview(second)] } });
  const state = controller.getSnapshot();
  assert.equal(state.comparison.recordings.length, 2);
  assert.equal(state.preview, "only");
  assert.deepEqual(calls, []);
  controller.dispose();
});

test("cards offer to open a recording only where the server has the workspace, also after loading it", async t => {
  const recording = recordingFixture();
  const { cards, app, close } = load(() => ({ content: [], structuredContent: { recording, summary: {} } }));
  t.after(close);
  const withWorkspace = new cards.RecordingController(app, { workspace: true });
  assert.equal(withWorkspace.getSnapshot().canOpen, true);
  withWorkspace.dispose();
  const controller = new cards.RecordingController(app);
  controller.accept(reference(recording, { preview: recordingPreview(recording) }));
  await until(() => controller.getSnapshot().preview === undefined);
  assert.equal(controller.getSnapshot().canOpen, false);
  controller.dispose();
});

test("a full read the server refuses keeps the preview instead of loading forever", async t => {
  const recording = recordingFixture();
  const { cards, app, close } = load(() => ({ isError: true, content: [{ type: "text", text: "Recording not found." }] }));
  t.after(close);
  const controller = new cards.RecordingController(app);
  controller.accept(reference(recording, { preview: recordingPreview(recording) }));
  await until(() => controller.getSnapshot().preview === "only");
  assert.equal(controller.getSnapshot().error, "");
  controller.dispose();
});

test("a newer recording replaces one still loading, whichever read finishes last", async t => {
  const first = recordingFixture();
  const second = { ...recordingFixture(), id: "44b7030b-a74e-466f-aeb0-bcd3ae8af972", title: "Run 2" };
  let releaseFirst!: () => void;
  const firstRead = new Promise<void>(resolve => { releaseFirst = resolve; });
  const { cards, app, close } = load(async call => {
    if (call.arguments.recordingId === first.id) await firstRead;
    return { content: [], structuredContent: { recording: call.arguments.recordingId === first.id ? first : second, summary: {} } };
  });
  t.after(close);
  const controller = new cards.RecordingController(app, { workspace: true });
  controller.accept(reference(first, { preview: recordingPreview(first) }));
  controller.accept(reference(second, { preview: recordingPreview(second) }));
  await until(() => controller.getSnapshot().preview === undefined);
  releaseFirst();
  await setTimeout(20);
  assert.equal(controller.getSnapshot().recording.id, second.id);
  assert.equal(controller.getSnapshot().preview, undefined);
  controller.dispose();
});

test("comparison previews stay when a full read is refused", async t => {
  const first = recordingFixture();
  const second = { ...recordingFixture(), id: "44b7030b-a74e-466f-aeb0-bcd3ae8af972", title: "Run 2" };
  const { cards, app, close } = load(() => ({ isError: true, content: [{ type: "text", text: "Recording not found." }] }));
  t.after(close);
  const controller = new cards.ComparisonController(app);
  controller.accept({ content: [], structuredContent: { title: "Before and after", recordingIds: [first.id, second.id], summaries: [], previews: [recordingPreview(first), recordingPreview(second)] } });
  await until(() => controller.getSnapshot().preview === "only");
  assert.equal(controller.getSnapshot().comparison.recordings.length, 2);
  assert.equal(controller.getSnapshot().error, "");
  controller.dispose();
});
