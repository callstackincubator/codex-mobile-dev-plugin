import test from "node:test";
import assert from "node:assert/strict";
import { dispatch, fakeDeviceTools, waitFor } from "./simulator-fixture.ts";

test("screenshot attachment failures remain visible until the next action on both platforms", async t => {
  const f = fakeDeviceTools(t);
  f.holdInitialFrames();
  for (const target of [f.ios, f.android]) {
    await target.panel.load();
    await waitFor(() => target.view.screenshot.disabled === false);
    await waitFor(() => f.waitingForFrame(target.panel.platform));
    assert.equal(target.canvas.draws, 0);
    const attached = f.screenshots.length;
    f.failScreenshotAttachment("MCP error -32000: Maximum call stack size exceeded");
    target.panel.screenshot();
    await waitFor(() => target.view.notice.message !== "" && target.view.screenshot.disabled === false);
    assert.match(target.view.notice.message, /screenshot.*not.*attached.*chat/i);
    assert.equal(f.screenshots.length, attached);
    f.frame(target.panel.platform, 1);
    await waitFor(() => target.canvas.draws > 0);
    assert.match(target.view.notice.message, /screenshot.*not.*attached.*chat/i);
    await target.picker.refresh();
    assert.match(target.view.notice.message, /screenshot.*not.*attached.*chat/i);
    f.failScreenshotAttachment("");
    target.panel.screenshot();
    await waitFor(() => f.screenshots.length === attached + 1 && target.view.screenshot.disabled === false);
    assert.equal(target.view.notice.message, "");
    assert.equal(f.screenshots.at(-1)?.mimeType, "image/jpeg");
    assert.equal(f.screenshots.at(-1)?.data, "/9j/2Q==");
  }
});

test("JPEG encoding failures keep chat empty, show a notice and allow another screenshot", async t => {
  const f = fakeDeviceTools(t);
  await f.ios.panel.load();
  await waitFor(() => f.ios.view.screenshot.disabled === false);
  f.failScreenshotEncoding("JPEG encoder failed");
  f.ios.panel.screenshot();
  await waitFor(() => f.ios.view.notice.message !== "" && f.ios.view.screenshot.disabled === false);
  assert.equal(f.screenshots.length, 0);
  assert.match(f.ios.view.notice.message, /screenshot.*not.*attached.*chat/i);
  assert.ok(f.calls.find(call => call.name === "mobile_capture_screenshot"), "The original PNG is captured for the clipboard before JPEG encoding.");
  f.failScreenshotEncoding("");
  f.ios.panel.screenshot();
  await waitFor(() => f.screenshots.length === 1 && f.ios.view.screenshot.disabled === false);
  assert.equal(f.ios.view.notice.message, "");
  assert.equal(f.screenshots[0].mimeType, "image/jpeg");
});

test("missing timing observations do not disconnect valid iOS frames", async t => {
  const f = fakeDeviceTools(t);
  f.missTiming();
  await f.ios.panel.load();
  await waitFor(() => f.ios.canvas.draws > 0);
  assert.equal(f.streams("mobile_stream_session").length, 1);
  assert.equal(f.closed.length, 0);
});

for (const platform of ["ios", "android"] as const) test(`leaving Select restores the latest ${platform} frame even when the device is quiet`, async t => {
  const f = fakeDeviceTools(t);
  const target = f[platform];
  await target.panel.load();
  await waitFor(() => target.canvas.draws > 0);
  await target.annotations.toggle();
  f.frame(platform, 2);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(target.canvas.draws, 1);
  target.annotations.exit();
  assert.equal(target.canvas.draws, 2);
  assert.equal(f.closed.length, 0);
});

test("returning to a hidden chat reopens its streams and preserves the note input", async t => {
  const f = fakeDeviceTools(t);
  await Promise.all([f.ios.panel.load(), f.android.panel.load()]);
  await waitFor(() => f.ios.canvas.draws > 0 && f.android.canvas.draws > 0);
  const store = f.ios.annotations;
  await store.toggle(); store.select({ x: 50, y: 40 }); store.setText("Keep this note");
  f.visibility("hidden");
  await waitFor(() => f.closed.length === 2);
  assert.equal(store.getSnapshot().draft?.text, "Keep this note");
  f.visibility("visible");
  await waitFor(() => f.ios.canvas.draws > 1 && f.android.canvas.draws > 1);
  assert.equal(f.streams().length, 4);
  assert.equal(store.getSnapshot().draft?.text, "Keep this note");
  assert.equal(f.calls.some(call => call.name.startsWith("mobile_boot")), false);
});

test("a stopped receive loop retries when its chat becomes visible again", async t => {
  const f = fakeDeviceTools(t);
  f.invalidFrame();
  await f.ios.panel.load();
  await waitFor(() => f.ios.view.notice.message.includes("invalid frame metadata"));
  f.visibility("visible");
  await waitFor(() => f.ios.canvas.draws > 0);
  assert.equal(f.streams("mobile_stream_session").length, 2);
});

for (const platform of ["ios", "android"] as const) test(`select mode on ${platform} maps screen coordinates without sending device input`, async t => {
  const f = fakeDeviceTools(t);
  const target = f[platform];
  await target.panel.load();
  await waitFor(() => target.canvas.draws > 0);
  const store = target.annotations;
  await store.toggle();
  assert.equal(store.getSnapshot().selecting, true);
  assert.equal(target.view.buttons[0].disabled, true);
  assert.equal(target.view.selecting, true);
  dispatch(target.canvas, "pointermove", { pointerId: 1, clientX: 20, clientY: 30 });
  assert.equal(store.getSnapshot().hovered?.name, "Continue");
  assert.equal(store.getSnapshot().draft, undefined);
  dispatch(target.canvas, "pointerleave", {});
  assert.equal(store.getSnapshot().hovered, undefined);
  dispatch(target.canvas, "pointerdown", { button: 0, pointerId: 1, clientX: 20, clientY: 30 });
  assert.equal(store.getSnapshot().draft, undefined);
  dispatch(target.canvas, "pointerup", { button: 0, pointerId: 1, clientX: 20, clientY: 30 });
  assert.equal(store.getSnapshot().draft?.component.name, "Continue");
  assert.equal(store.getSnapshot().draft?.screen.units, platform === "ios" ? "points" : "pixels");
  assert.equal(f.calls.some(call => call.name.endsWith("_stream_input")), false);
  dispatch(target.canvas, "keydown", { key: "a", code: "KeyA" });
  assert.equal(f.calls.some(call => call.name.endsWith("_stream_input")), false);
  dispatch(target.canvas, "keydown", { key: "Escape", code: "Escape" });
  assert.equal(store.getSnapshot().selecting, false);
  assert.equal(store.getSnapshot().draft, undefined);
  assert.equal(target.view.buttons[0].disabled, false);
  assert.equal(target.view.selecting, false);
});

for (const platform of ["ios", "android"] as const) test(`failed inspection on ${platform} falls back to native elements and accepts clicks`, async t => {
  const f = fakeDeviceTools(t, { failures: { mobile_inspect_ui: "Inspection unavailable" } });
  const target = f[platform];
  await target.panel.load();
  await waitFor(() => target.canvas.draws > 0);
  const store = target.annotations;
  await store.toggle();
  dispatch(target.canvas, "pointermove", { pointerId: 1, clientX: 20, clientY: 30 });
  assert.equal(store.getSnapshot().hovered?.name, "Continue");
  assert.equal(store.getSnapshot().hovered?.source, "accessibility");
  dispatch(target.canvas, "pointerdown", { button: 0, pointerId: 1, clientX: 20, clientY: 30 });
  dispatch(target.canvas, "pointerup", { button: 0, pointerId: 1, clientX: 20, clientY: 30 });
  assert.equal(store.getSnapshot().draft?.component.name, "Continue");
  assert.ok(f.calls.some(call => call.name === (platform === "ios" ? "mobile_describe_ui" : "mobile_android_describe_ui")));
  assert.equal(f.calls.some(call => call.name.endsWith("_stream_input")), false);
});
