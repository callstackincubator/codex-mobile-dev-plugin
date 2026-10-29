import test from "node:test";
import assert from "node:assert/strict";
import { dispatch, fakeDeviceTools, pasteText, physicalPhone, waitFor } from "./simulator-fixture.ts";

const inputs = (calls: { name: string }[]) => calls.filter(call => call.name.endsWith("_stream_input"));

for (const platform of ["ios", "android"] as const) test(`Command-V on ${platform} preserves paste and subsequent typing order in its own session`, async t => {
  const f = fakeDeviceTools(t);
  await Promise.all([f.ios.panel.load(), f.android.panel.load()]);
  await waitFor(() => f.ios.canvas.draws > 0 && f.android.canvas.draws > 0);
  const screen = f[platform].canvas;
  const shortcut = new Event("keydown", { cancelable: true });
  Object.assign(shortcut, { key: "v", code: "KeyV", metaKey: true });
  screen.dispatchEvent(shortcut);
  assert.equal(shortcut.defaultPrevented, false, "Command-V lets the browser deliver its paste event.");
  const text = "https://example.test/path?q=hello%20world&count=2";
  assert.equal(pasteText(screen, text).defaultPrevented, true);
  dispatch(screen, "keydown", { key: "!", code: "Digit1", shiftKey: true });
  await waitFor(() => inputs(f.calls).length === 2);
  const sent = inputs(f.calls) as { name: string; arguments: Record<string, unknown> }[];
  for (const input of sent) {
    assert.equal(input.name, platform === "ios" ? "mobile_stream_input" : "mobile_android_stream_input");
    assert.equal(input.arguments.sessionId, sent[0].arguments.sessionId);
  }
  assert.deepEqual(sent[0].arguments.messages, [{ type: "type", text }]);
  assert.deepEqual(sent[1].arguments.messages, [{ type: "type", text: "!" }]);
});

for (const platform of ["ios", "android"] as const) test(`${platform} paste rejects unsupported text without sending partial content`, async t => {
  const f = fakeDeviceTools(t);
  const target = f[platform];
  await target.panel.load();
  await waitFor(() => target.canvas.draws > 0);
  assert.equal(pasteText(target.canvas, "").defaultPrevented, true);
  assert.equal(target.view.notice.message, "");
  for (const text of ["hello\nworld", "hello\tworld", "café", "a".repeat(4097)]) {
    assert.equal(pasteText(target.canvas, text).defaultPrevented, true);
    assert.match(target.view.notice.message, /4,096 printable US-ASCII/);
  }
  assert.equal(inputs(f.calls).length, 0);
  const supported = "a".repeat(4096);
  pasteText(target.canvas, supported);
  assert.equal(target.view.notice.message, "");
  assert.deepEqual((inputs(f.calls)[0] as { arguments: Record<string, unknown> } | undefined)?.arguments.messages, [{ type: "type", text: supported }]);
});

for (const platform of ["ios", "android"] as const) test(`${platform} paste waits for readiness and stays disabled during selection, unavailability and teardown`, async t => {
  const f = fakeDeviceTools(t);
  const target = f[platform];
  const screen = target.canvas;
  assert.equal(pasteText(screen, "before ready").defaultPrevented, false);
  await target.panel.load();
  await waitFor(() => screen.draws > 0);
  await target.annotations.toggle();
  assert.equal(pasteText(screen, "selecting").defaultPrevented, false);
  dispatch(screen, "pointerdown", { button: 0, pointerId: 1, clientX: 20, clientY: 30 });
  dispatch(screen, "pointerup", { button: 0, pointerId: 1, clientX: 20, clientY: 30 });
  assert.equal(pasteText(screen, "drafting").defaultPrevented, false);
  target.annotations.exit();
  target.panel.setAvailable(false);
  assert.equal(pasteText(screen, "unavailable").defaultPrevented, false);
  await target.panel.dispose();
  assert.equal(pasteText(screen, "disposed").defaultPrevented, false);
  assert.equal(inputs(f.calls).length, 0);
});

test("blocked iOS and physical iOS streams do not accept pasted text", async t => {
  const f = fakeDeviceTools(t);
  f.blockIos();
  await f.ios.panel.load();
  await waitFor(() => f.ios.canvas.draws > 0);
  assert.equal(pasteText(f.ios.canvas, "blocked").defaultPrevented, false);
  f.setPhysical([physicalPhone]);
  f.ios.panel.setOpeningTarget({ platform: "ios", kind: "physical", deviceId: physicalPhone.udid });
  await f.ios.panel.load();
  await waitFor(() => f.calls.some(call => call.name === "mobile_ios_mirror_session") && f.ios.view.buttons[0].disabled);
  assert.equal(pasteText(f.ios.canvas, "physical").defaultPrevented, false);
  assert.equal(f.calls.filter(call => call.name.endsWith("_stream_input") || call.name === "mobile_ios_mirror_input").length, 0);
});

test("both platforms stream at once and each routes input to its own session", async t => {
  const f = fakeDeviceTools(t);
  await Promise.all([f.ios.panel.load(), f.android.panel.load()]);
  await waitFor(() => f.ios.canvas.draws > 0 && f.android.canvas.draws > 0);
  f.ios.panel.press("home");
  f.android.panel.press("home");
  await waitFor(() => inputs(f.calls).length === 2);
  const [ios, android] = inputs(f.calls) as { name: string; arguments: Record<string, unknown> }[];
  assert.equal(ios.name, "mobile_stream_input");
  assert.match(ios.arguments.sessionId as string, /^ios-/);
  assert.deepEqual(ios.arguments.messages, [{ type: "button", button: "home" }]);
  assert.equal(android.name, "mobile_android_stream_input");
  assert.match(android.arguments.sessionId as string, /^android-/);
  assert.equal(f.closed.length, 0);
});

test("changing one device leaves the other stream and controls active", async t => {
  const f = fakeDeviceTools(t);
  await Promise.all([f.ios.panel.load(), f.android.panel.load()]);
  await waitFor(() => f.android.canvas.draws > 0);
  f.ios.picker.select(f.ios.picker.value);
  await waitFor(() => f.streams("mobile_stream_session").length === 2);
  assert.equal(f.streams("mobile_android_stream_session").length, 1);
  assert.ok(f.closed.some(id => id.startsWith("ios-")));
  assert.equal(f.closed.some(id => id.startsWith("android-")), false);
  assert.equal(f.android.view.buttons[0].disabled, false);
  f.android.panel.activate();
  assert.deepEqual(f.selections.at(-1), { platform: "android", active: true });
  f.ios.panel.activate();
  assert.deepEqual(f.selections.at(-1), { platform: "ios", active: true });
});

for (const platform of ["ios", "android"] as const) test(`${platform} input failure reconnects its panel without replaying gestures`, async t => {
  const f = fakeDeviceTools(t);
  const target = f[platform];
  const other = platform === "ios" ? f.android : f.ios;
  const sessionTool = platform === "ios" ? "mobile_stream_session" : "mobile_android_stream_session";
  const inputTool = platform === "ios" ? "mobile_stream_input" : "mobile_android_stream_input";
  await Promise.all([target.panel.load(), other.panel.load()]);
  await waitFor(() => target.canvas.draws > 0 && other.canvas.draws > 0);
  f.failOnce(inputTool, "Input disconnected", { streamDisconnected: true });
  target.panel.press("home");
  await waitFor(() => f.streams(sessionTool).length === 2 && target.view.buttons[0].disabled === false);
  assert.equal(f.calls.filter(call => call.name === inputTool).length, 1);
  assert.equal(other.view.buttons[0].disabled, false);
  target.panel.press("home");
  await waitFor(() => f.calls.filter(call => call.name === inputTool).length === 2);
});

test("blocked iOS input leaves Android controls working", async t => {
  const f = fakeDeviceTools(t);
  f.blockIos();
  await Promise.all([f.ios.panel.load(), f.android.panel.load()]);
  await waitFor(() => f.ios.canvas.draws > 0 && f.android.canvas.draws > 0);
  assert.equal(f.ios.view.buttons[1].disabled, true);
  assert.equal(f.ios.view.notice.message, "Simulator input is blocked. Ask the agent to repair it.");
  assert.equal(f.ios.view.notice.destructive, true);
  assert.equal(f.android.view.buttons[1].disabled, false);
  assert.equal(f.android.view.notice.message, "");
});

test("blocked input names no assistant on a host without a chat", async t => {
  const f = fakeDeviceTools(t);
  f.withoutChat();
  f.blockIos();
  await f.ios.panel.load();
  await waitFor(() => f.ios.canvas.draws > 0);
  assert.equal(f.ios.view.notice.message, "Simulator input is blocked.");
});
