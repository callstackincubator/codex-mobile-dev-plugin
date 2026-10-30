import test from "node:test";
import assert from "node:assert/strict";
import { androidPhone, dispatch, fakeDeviceTools } from "./simulator-fixture.ts";
import { waitFor } from "@mobile-dev/test-support/wait.ts";

const avd = { udid: "emulator-5554", name: "Pixel AVD", state: "Booted", runtime: "Android", platform: "android", kind: "emulator" } as const;
const lifecycle = (calls: { name: string }[]) => calls.filter(call => call.name.startsWith("mobile_boot") || call.name.startsWith("mobile_shutdown"));

test("physical Android devices appear above emulators and stream without emulator lifecycle calls", async t => {
  const f = fakeDeviceTools(t, { android: [avd, androidPhone] });
  await f.android.panel.load();
  const picker = f.android.picker;
  const state = picker.getSnapshot();
  assert.deepEqual(state.items.map(item => item.group), ["Connected devices", "Emulators"]);
  assert.equal(state.items[0].label, "Pixel 9 · USB");
  assert.equal(state.items[0].canStop, false);
  picker.select(androidPhone.udid);
  await waitFor(() => f.android.panel.selected?.udid === androidPhone.udid && picker.getSnapshot().disabled === false && f.android.canvas.draws > 0);
  assert.deepEqual(f.streams("mobile_android_stream_session").at(-1)?.arguments, { deviceId: androidPhone.udid });
  assert.equal(f.android.view.screenshot.disabled, false);
  for (const button of f.android.view.buttons) {
    assert.equal(button.disabled, false);
    assert.equal(button.unsupported, false);
  }
  assert.deepEqual(f.android.view.buttons.map(button => button.title), ["Home", "App switcher"]);
  await picker.stopDevice(androidPhone.udid);
  assert.equal(lifecycle(f.calls).length, 0);
  f.setDevices("android", [{ ...androidPhone, transportType: "localNetwork" }]);
  await picker.refresh();
  assert.equal(picker.getSnapshot().value, androidPhone.udid);
  assert.equal(picker.getSnapshot().items[0].label, "Pixel 9 · Wi-Fi");
});

for (const state of ["unauthorized", "offline"]) test(`physical Android ${state} devices remain discoverable without booting or streaming`, async t => {
  const f = fakeDeviceTools(t, { android: [{ ...androidPhone, state }] });
  await f.android.panel.load();
  const picker = f.android.picker;
  const [item] = picker.getSnapshot().items;
  assert.equal(picker.getSnapshot().items.length, 1);
  assert.equal(item.running, false);
  assert.equal(item.canStop, false);
  assert.match(item.label, state === "unauthorized" ? /Unauthorized/ : /Offline/);
  picker.select(androidPhone.udid);
  await waitFor(() => f.android.panel.selected?.udid === androidPhone.udid && picker.getSnapshot().disabled === false);
  assert.equal(f.android.view.start.disabled, true);
  assert.equal(f.android.view.screenshot.disabled, true);
  assert.equal(f.calls.filter(call => call.name.startsWith("mobile_boot") || call.name.endsWith("_stream_session")).length, 0);
  f.setDevices("android", [androidPhone]);
  await picker.refresh();
  await waitFor(() => f.android.canvas.draws > 0);
});

test("Android refresh connects an arriving phone once and closes its stream when it disconnects", async t => {
  const f = fakeDeviceTools(t, { android: [] });
  await f.android.panel.load();
  const picker = f.android.picker;
  f.setDevices("android", [androidPhone]);
  await picker.refresh();
  await waitFor(() => f.android.canvas.draws > 0);
  await picker.refresh();
  assert.equal(f.streams("mobile_android_stream_session").length, 1);
  assert.equal(f.android.panel.selected?.udid, androidPhone.udid);
  f.setDevices("android", []);
  await picker.refresh();
  await waitFor(() => f.closed.length === 1);
  assert.equal(f.android.panel.selected, undefined);
  assert.equal(f.android.view.buttons[0].disabled, true);
  assert.equal(lifecycle(f.calls).length, 0);
});

test("Android discovery polls visible panels, shares refreshes, and removes disconnected phones", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fakeDeviceTools(t, { android: [] });
  await f.android.panel.load();
  const reads = () => f.calls.filter(call => call.name === "mobile_list_android_devices").length;
  f.android.panel.setVisible(false);
  t.mock.timers.tick(3000);
  assert.equal(reads(), 1);
  f.android.panel.setVisible(true);
  let release!: () => void;
  f.delay("mobile_list_android_devices", new Promise<void>(resolve => { release = resolve; }));
  f.setDevices("android", [{ ...androidPhone, state: "unauthorized" }]);
  t.mock.timers.tick(3000);
  const refreshing = f.android.picker.refresh();
  assert.equal(reads(), 2);
  release();
  await refreshing;
  assert.equal(f.android.picker.getSnapshot().items[0].value, androidPhone.udid);
  f.setDevices("android", []);
  await f.android.picker.refresh();
  assert.equal(f.android.picker.getSnapshot().items.length, 0);
  await f.android.panel.dispose();
  t.mock.timers.tick(10000);
  assert.equal(reads(), 3);
});

for (const recovery of ["generation", "decoder"] as const) test(`Android ${recovery} recovery keeps Select and its frozen capture active`, async t => {
  const f = fakeDeviceTools(t);
  const panel = f.android;
  await panel.panel.load();
  const store = panel.annotations;
  await waitFor(() => !store.getSnapshot().disabled && f.waitingForFrame("android"));
  await store.toggle();
  const capture = store.getSnapshot().capture;
  const screen = panel.canvas, draws = screen.draws;
  dispatch(screen, "pointermove", { pointerId: 1, clientX: 20, clientY: 30 });
  assert.equal(store.getSnapshot().hovered?.name, "Continue");
  if (recovery === "generation") f.frame("android", 2, { generation: 2, empty: true });
  else { f.failAndroidDecode(); f.frame("android", 2); }
  await waitFor(() => f.waitingForFrame("android"));
  assert.equal(store.getSnapshot().selecting, true);
  assert.equal(store.getSnapshot().disabled, false);
  assert.equal(store.getSnapshot().capture, capture);
  assert.equal(screen.draws, draws);
  dispatch(screen, "pointerdown", { button: 0, pointerId: 1, clientX: 20, clientY: 30 });
  dispatch(screen, "pointerup", { button: 0, pointerId: 1, clientX: 20, clientY: 30 });
  const draft = store.getSnapshot().draft;
  assert.equal(draft?.component.name, "Continue");
  store.setText("Keep this element");
  f.frame("android", 3);
  await waitFor(() => f.waitingForFrame("android"));
  assert.equal(store.getSnapshot().selecting, true);
  assert.equal(store.getSnapshot().draft?.id, draft?.id);
  assert.equal(store.getSnapshot().draft?.text, "Keep this element");
  assert.equal(screen.draws, draws);
  assert.equal(f.calls.some(call => call.name === "mobile_android_stream_input"), false);
  dispatch(screen, "keydown", { key: "Escape", code: "Escape" });
  assert.equal(store.getSnapshot().selecting, false);
  assert.ok(screen.draws > draws, "Leaving Select displays the latest recovered frame.");
  assert.equal(panel.view.buttons[0].disabled, false);
  await store.toggle();
  f.visibility("hidden");
  assert.equal(store.getSnapshot().selecting, false);
  assert.equal(store.getSnapshot().disabled, true);
});

test("Android fallback selection scales physical accessibility bounds to the captured video", async t => {
  const f = fakeDeviceTools(t, { failures: { mobile_inspect_ui: "Inspection unavailable" } });
  f.answer("mobile_android_describe_ui", () => ({ content: [], structuredContent: { screen: { width: 1080, height: 2160 }, tree: { nodes: [
    { text: "Continue", resourceId: "app:id/continue", className: "android.widget.Button", bounds: { left: 270, top: 1080, right: 810, bottom: 1296 } },
  ] } } }));
  const panel = f.android;
  await panel.panel.load();
  await waitFor(() => panel.canvas.draws > 0);
  const store = panel.annotations;
  await store.toggle();
  dispatch(panel.canvas, "pointermove", { pointerId: 1, clientX: 75, clientY: 165 });
  assert.equal(store.getSnapshot().hovered?.name, "Continue");
  dispatch(panel.canvas, "pointerdown", { button: 0, pointerId: 1, clientX: 75, clientY: 165 });
  dispatch(panel.canvas, "pointerup", { button: 0, pointerId: 1, clientX: 75, clientY: 165 });
  assert.deepEqual(store.getSnapshot().draft?.component.bounds, { x: 100, y: 400, width: 200, height: 80 });
  assert.equal(store.getSnapshot().draft?.component.identifier, "app:id/continue");
  assert.equal(f.calls.some(call => call.name.endsWith("_stream_input")), false);
});
