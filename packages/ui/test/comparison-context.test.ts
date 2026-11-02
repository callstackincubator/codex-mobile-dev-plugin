import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import type { App } from "@modelcontextprotocol/ext-apps";
import type { OpenAIModelContextHostState } from "@openai/mcp-extensions/app";
import { ComparisonController } from "../src/comparison-controller.ts";
import { recordingWithFramesFixture } from "../../test-support/recording-fixtures.ts";

function fixture(t: TestContext, pills = true) {
  const messages: Parameters<App["sendMessage"]>[0][] = [];
  const updates: Parameters<App["updateModelContext"]>[0][] = [];
  let current: OpenAIModelContextHostState | undefined;
  let attachmentFailure = false;
  let sendTimeout = false;
  let gate: Promise<void> | undefined;
  const modelContext = {
    getCurrent: () => current,
    async update(params: Parameters<App["updateModelContext"]>[0], options: { timeout?: number }) {
      assert.equal(options.timeout, 5000);
      updates.push(params);
      await gate;
      if (attachmentFailure) throw new Error("Host refused context");
      current = { ...params, updateId: String(updates.length) };
      return { updateId: current.updateId };
    },
  };
  const app = {
    getHostCapabilities: () => ({ experimental: { "openai/message": {} }, message: { text: {} } }),
    async sendMessage(params: Parameters<App["sendMessage"]>[0], options: { timeout?: number; maxTotalTimeout?: number }) {
      assert.equal(options.timeout, 5000);
      assert.equal(options.maxTotalTimeout, 5000);
      messages.push(params);
      if (sendTimeout) throw Object.assign(new Error("Request timed out"), { code: -32001 });
      return { isError: false };
    },
    async callServerTool() { throw new Error("Completed comparisons must not read recordings"); },
  } as unknown as App;
  const controller = new ComparisonController(app, { attachments: () => pills ? modelContext : undefined });
  const first = recordingWithFramesFixture();
  const second = recordingWithFramesFixture();
  second.id = "44b7030b-a74e-466f-aeb0-bcd3ae8af972";
  controller.hostChanged();
  controller.accept({ content: [], structuredContent: { title: "Before / after", recordings: [first, second] } });
  t.after(() => controller.dispose());
  return { controller, ids: [first.id, second.id], messages, updates,
    setContext(value: OpenAIModelContextHostState) { current = value; },
    failAttachment() { attachmentFailure = true; },
    timeOutSend() { sendTimeout = true; },
    hold(value: Promise<void>) { gate = value; },
  };
}

test("asking about a range attaches the runs and range as a pill before sending a short prompt", async t => {
  const f = fixture(t);
  f.controller.select({ start: 12, end: 18 });
  await f.controller.ask();
  assert.equal(f.updates.length, 1);
  const pill = f.updates[0].content![0];
  assert.equal(pill._meta?.["openai/title"], "Before / after · 12–18s");
  if (pill.type !== "text") throw new Error("Expected a comparison context pill");
  for (const id of f.ids) assert.match(pill.text, new RegExp(id));
  assert.match(pill.text, /"range":\{"start":12,"end":18\}/);
  assert.match(pill.text, /mobile_compare_performance_recordings/);
  assert.match(pill.text, /Distinguish measurements from hypotheses/);
  assert.deepEqual(f.updates[0].structuredContent?.selectedComparison, { recordingIds: f.ids, range: { start: 12, end: 18 } });
  assert.deepEqual(f.messages[0], {
    role: "user", content: [{ type: "text", text: "Compare this selected range." }],
    _meta: { "openai/message": { target: "active", send: true } },
  });
});

test("whole-run questions use a short prompt and preserve other context pills", async t => {
  const f = fixture(t);
  const recording = { type: "text" as const, text: "Explain this recording", _meta: { "openai/title": "Run 1 · 0–30s", "mobile-dev/recordingReference": true } };
  f.setContext({ updateId: "existing", content: [recording], structuredContent: { selectedRecording: { recordingId: f.ids[0] } } });
  await f.controller.ask();
  assert.equal((f.messages[0].content[0] as { text: string }).text, "Compare these runs.");
  assert.equal(f.updates[0].content![1]._meta?.["openai/title"], "Before / after");
  assert.deepEqual(f.updates[0].content![0], recording);
  assert.deepEqual(f.updates[0].structuredContent?.selectedRecording, { recordingId: f.ids[0] });
  assert.deepEqual(f.updates[0].structuredContent?.selectedComparison, { recordingIds: f.ids });
  f.controller.select({ start: 12, end: 18 });
  await f.controller.ask();
  assert.equal(f.updates[1].content!.length, 2, "Another question replaces the prior comparison pill without duplicating it.");
  assert.deepEqual(f.updates[1].content![0], recording);
});

test("hosts without pills keep the full reference in the message", async t => {
  const f = fixture(t, false);
  await f.controller.ask();
  assert.equal(f.updates.length, 0);
  const text = JSON.stringify(f.messages[0].content);
  for (const id of f.ids) assert.match(text, new RegExp(id));
  assert.match(text, /mobile_compare_performance_recordings/);
});

test("attachment failures never send an incomplete comparison question", async t => {
  const f = fixture(t); f.failAttachment();
  await f.controller.ask();
  assert.equal(f.messages.length, 0);
  assert.match(f.controller.getSnapshot().error, /Host refused context/);
  assert.equal(f.controller.getSnapshot().busy, false);
});

test("attachment writes finish before sending and block duplicate clicks", async t => {
  const f = fixture(t);
  let release!: () => void;
  f.hold(new Promise<void>(resolve => { release = resolve; }));
  const asking = f.controller.ask();
  await f.controller.ask();
  assert.equal(f.updates.length, 1);
  assert.equal(f.messages.length, 0);
  release(); await asking;
  assert.equal(f.messages.length, 1);
  assert.equal(f.controller.getSnapshot().busy, false);
});

test("comparison message timeouts unlock the action without retrying uncertain delivery", async t => {
  const f = fixture(t); f.timeOutSend();
  await f.controller.ask();
  assert.equal(f.messages.length, 1);
  assert.match(f.controller.getSnapshot().error, /Check the chat before retrying/);
  assert.equal(f.controller.getSnapshot().busy, false);
});
