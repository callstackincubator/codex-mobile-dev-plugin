import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import type { App } from "@modelcontextprotocol/ext-apps";
import type { OpenAIExtensions, OpenAIModelContextHostState } from "@openai/mcp-extensions/app";
import { RecordingController } from "../src/ui/recording-controller.ts";
import { recordingWithFramesFixture } from "./recording-fixtures.ts";

function fixture(t: TestContext, pills = true) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { value: new EventTarget(), configurable: true });
  const messages: Parameters<App["sendMessage"]>[0][] = [];
  const updates: Parameters<App["updateModelContext"]>[0][] = [];
  let current: OpenAIModelContextHostState | undefined;
  let attachmentFailure = false;
  let sendFailure = false;
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
    getHostCapabilities: () => ({ message: { text: {} } }),
    async sendMessage(params: Parameters<App["sendMessage"]>[0], options: { timeout?: number; maxTotalTimeout?: number }) {
      assert.equal(options.timeout, 5000);
      assert.equal(options.maxTotalTimeout, 5000);
      messages.push(params);
      if (sendTimeout) throw Object.assign(new Error("Request timed out"), { code: -32001 });
      return { isError: sendFailure };
    },
  } as unknown as App;
  const controller = new RecordingController(app, (pills ? { modelContext } : {}) as OpenAIExtensions);
  const recording = recordingWithFramesFixture();
  controller.hostChanged();
  controller.accept({ content: [], structuredContent: { recording } });
  t.after(() => {
    controller.dispose();
    if (previous) Object.defineProperty(globalThis, "document", previous); else Reflect.deleteProperty(globalThis, "document");
  });
  return { controller, recording, messages, updates,
    setContext(value: OpenAIModelContextHostState) { current = value; },
    failAttachment() { attachmentFailure = true; }, failSend() { sendFailure = true; },
    timeOutSend() { sendTimeout = true; },
    hold(value: Promise<void>) { gate = value; },
  };
}

for (const action of ["ask", "open"] as const) test(`${action} attaches the exact recording and range as a pill before sending a short prompt`, async t => {
  const f = fixture(t);
  f.controller.select({ start: 12, end: 18 });
  await f.controller.send(action);
  assert.equal(f.updates.length, 1);
  const pill = f.updates[0].content![0];
  assert.equal(pill._meta?.["openai/title"], `${f.recording.title} · 12–18s`);
  assert.equal(pill.type, "text");
  if (pill.type !== "text") throw new Error("Expected a recording context pill");
  assert.match(pill.text, new RegExp(f.recording.id));
  assert.match(pill.text, /"range":\{"start":12,"end":18\}/);
  assert.match(pill.text, action === "ask" ? /mobile_read_performance_recording/ : /mobile_open_performance_recording/);
  if (action === "ask") {
    assert.match(pill.text, /device-wide Display FPS/);
    assert.match(pill.text, /summary.frameStats/);
    assert.match(pill.text, /mobile_read_performance_frames/);
    assert.match(pill.text, /mobile_render_performance_recording/);
    assert.match(pill.text, /Distinguish measurements from hypotheses/);
  }
  assert.deepEqual(f.updates[0].structuredContent?.selectedRecording, { recordingId: f.recording.id, range: { start: 12, end: 18 } });
  assert.deepEqual(f.messages[0], {
    role: "user", content: [{ type: "text", text: action === "ask" ? "Explain this selected range." : "Open this recording in Mobile Dev." }],
    _meta: { "openai/message": { target: "active", send: true } },
  });
});

test("full recording questions use a short prompt and preserve other context pills", async t => {
  const f = fixture(t);
  const annotation = { type: "text" as const, text: "Keep this selected component", _meta: { "openai/title": "Continue button" } };
  f.setContext({ updateId: "existing", content: [annotation], structuredContent: { annotationIds: ["note-1"] } });
  await f.controller.send("ask");
  assert.equal(f.messages[0].content[0].type, "text");
  assert.equal((f.messages[0].content[0] as { text: string }).text, "Explain this recording.");
  assert.deepEqual(f.updates[0].content![0], annotation);
  assert.deepEqual(f.updates[0].structuredContent?.annotationIds, ["note-1"]);
  assert.deepEqual(f.updates[0].structuredContent?.selectedRecording, { recordingId: f.recording.id, range: { start: 0, end: 30 } });
  f.controller.select({ start: 12, end: 18 });
  await f.controller.send("ask");
  assert.equal(f.updates[1].content!.length, 2, "Another question replaces the prior recording pill without duplicating it.");
  assert.deepEqual(f.updates[1].content![0], annotation);
  f.setContext(null);
  f.controller.hostChanged();
  assert.equal(f.updates.length, 2, "Cleared pills do not reattach on host updates.");
});

for (const action of ["ask", "open"] as const) test(`${action} keeps the full reference in the message on hosts without pills`, async t => {
  const f = fixture(t, false);
  await f.controller.send(action);
  assert.equal(f.updates.length, 0);
  assert.match(JSON.stringify(f.messages[0].content), new RegExp(f.recording.id));
  assert.match(JSON.stringify(f.messages[0].content), action === "ask" ? /mobile_read_performance_recording/ : /mobile_open_performance_recording/);
});

test("attachment failures never send an incomplete recording question", async t => {
  const f = fixture(t); f.failAttachment();
  await f.controller.send("ask");
  assert.equal(f.messages.length, 0);
  assert.match(f.controller.getSnapshot().error, /Host refused context/);
  assert.equal(f.controller.getSnapshot().busy, false);
});

test("attachment writes finish before sending and block duplicate clicks", async t => {
  const f = fixture(t);
  let release!: () => void;
  f.hold(new Promise<void>(resolve => { release = resolve; }));
  const sending = f.controller.send("ask");
  await f.controller.send("ask");
  assert.equal(f.updates.length, 1);
  assert.equal(f.messages.length, 0);
  release(); await sending;
  assert.equal(f.messages.length, 1);
  assert.equal(f.controller.getSnapshot().busy, false);
});

test("teardown during an attachment write prevents sending", async t => {
  const f = fixture(t);
  let release!: () => void;
  f.hold(new Promise<void>(resolve => { release = resolve; }));
  const sending = f.controller.send("ask");
  f.controller.dispose(); release(); await sending;
  assert.equal(f.messages.length, 0);
});

test("host message rejection reports failure and does not resend", async t => {
  const f = fixture(t); f.failSend();
  await f.controller.send("ask");
  assert.equal(f.messages.length, 1);
  assert.match(f.controller.getSnapshot().error, /could not send this recording/);
  assert.equal(f.controller.getSnapshot().busy, false);
});

test("message timeouts unlock the action without retrying uncertain delivery", async t => {
  const f = fixture(t); f.timeOutSend();
  await f.controller.send("ask");
  assert.equal(f.messages.length, 1);
  assert.match(f.controller.getSnapshot().error, /Check the chat before retrying/);
  assert.equal(f.controller.getSnapshot().busy, false);
});
