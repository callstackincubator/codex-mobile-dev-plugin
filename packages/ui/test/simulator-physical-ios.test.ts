import test from "node:test";
import assert from "node:assert/strict";
import { dispatch, fakeDeviceTools, physicalBezel, physicalPhone } from "./simulator-fixture.ts";
import { waitFor } from "@mobile-dev/test-support/wait.ts";

const backendDown = { physical: [physicalPhone], failures: { mobile_list_simulators: "Simulator backend unavailable" } };

test("physical iOS devices mirror above simulators and route touches to their own session", async t => {
  const f = fakeDeviceTools(t, { physical: [physicalPhone] });
  await f.ios.panel.load();
  const picker = f.ios.picker;
  const items = picker.getSnapshot().items;
  assert.deepEqual(items.map(item => item.group), ["Connected devices", "Simulators"]);
  assert.equal(items[0].label, "Physical iPhone · Wi-Fi");
  assert.equal(items[0].statusLabel, "Connected");
  assert.equal(items[0].canStop, false);
  const previousStreams = f.streams("mobile_stream_session").length;
  picker.select(physicalPhone.udid);
  await waitFor(() => f.ios.panel.selected?.kind === "physical" && picker.getSnapshot().disabled === false);
  await waitFor(() => f.ios.view.display.kind === "frame");
  const { layout } = f.ios.view;
  assert.equal(layout.chrome, "bezel");
  assert.equal(layout.bezelImage, physicalBezel.image);
  assert.equal(layout.screen.maskImage, `url("${physicalBezel.mask}")`);
  const mirrors = f.streams("mobile_ios_mirror_session");
  assert.equal(mirrors.length, 1);
  assert.equal(mirrors[0].arguments.udid, physicalPhone.udid);
  assert.equal(f.ios.view.start.disabled, true);
  assert.equal(f.ios.view.screenshot.disabled, false);
  assert.equal(f.ios.view.buttons.every(button => button.disabled && button.unsupported), true);
  assert.deepEqual(f.ios.view.buttons.map(button => button.title), ["Home is unavailable on physical iOS devices", "App switcher is unavailable on physical iOS devices"]);
  const screen = f.ios.canvas;
  dispatch(screen, "pointerdown", { pointerId: 1, button: 0, clientX: 75, clientY: 150 });
  dispatch(screen, "pointermove", { pointerId: 1, clientX: 90, clientY: 150 });
  dispatch(screen, "pointerup", { pointerId: 1 });
  const touches = () => f.calls.filter(call => call.name === "mobile_ios_mirror_input");
  await waitFor(() => touches().flatMap(call => call.arguments.messages as { type: string }[]).some(sample => sample.type === "touch1-up"));
  assert.deepEqual(touches().flatMap(call => call.arguments.messages as unknown[]), [
    { type: "touch1-down", x: 200, y: 400, width: 400, height: 800 },
    { type: "touch1-move", x: 240, y: 400, width: 400, height: 800 },
    { type: "touch1-up", x: 240, y: 400, width: 400, height: 800 },
  ]);
  assert.equal(touches().every(call => call.arguments.generation === 1), true);
  assert.equal(f.calls.filter(call => call.name.startsWith("mobile_boot")).length, 0);
  assert.equal(f.streams("mobile_stream_session").length, previousStreams);
  await picker.stopDevice(physicalPhone.udid);
  assert.equal(f.calls.filter(call => call.name.startsWith("mobile_shutdown")).length, 0);
  f.setPhysical([{ ...physicalPhone, transportType: "wired" }]);
  await picker.refresh();
  assert.equal(picker.value, physicalPhone.udid);
  assert.equal(picker.getSnapshot().items[0].label, "Physical iPhone · USB");
  const previousDraws = screen.draws;
  f.visibility("hidden");
  await waitFor(() => f.closed.some(id => id.startsWith("physical-")));
  f.visibility("visible");
  await waitFor(() => screen.draws > previousDraws);
  assert.equal(f.streams("mobile_ios_mirror_session").length, 2);
  assert.equal(f.ios.view.buttons.every(button => button.disabled), true);
  assert.equal(f.ios.view.screenshot.disabled, false);
  const unavailablePhone = { ...physicalPhone, state: "unavailable" };
  Reflect.deleteProperty(unavailablePhone, "transportType");
  f.setPhysical([unavailablePhone]);
  await picker.refresh();
  assert.equal(picker.getSnapshot().items.some(item => item.value === physicalPhone.udid), false);
  picker.select("iphone-1");
  await waitFor(() => f.ios.panel.selected?.kind !== "physical" && f.ios.view.buttons.every(button => !button.disabled));
  assert.equal(f.ios.view.buttons.every(button => !button.unsupported), true);
  assert.deepEqual(f.ios.view.buttons.map(button => button.title), ["Home", "App switcher"]);
});

test("another panel's held touch does not reconnect the physical video stream", async t => {
  const f = fakeDeviceTools(t, { physical: [physicalPhone] });
  await f.ios.panel.load();
  f.ios.picker.select(physicalPhone.udid);
  await waitFor(() => f.ios.view.screenshot.disabled === false);
  const screen = f.ios.canvas;
  f.failOnce("mobile_ios_mirror_input", "Another panel is currently touching this iPhone.", { inputBusy: true, streamDisconnected: false });
  dispatch(screen, "pointerdown", { pointerId: 1, button: 0, clientX: 75, clientY: 150 });
  await waitFor(() => f.ios.view.notice.message.includes("Another panel"));
  assert.equal(screen.captures.size, 0);
  assert.equal(f.ios.view.screenshot.disabled, false);
  assert.equal(f.streams("mobile_ios_mirror_session").length, 1);
  dispatch(screen, "pointerdown", { pointerId: 2, button: 0, clientX: 75, clientY: 150 });
  dispatch(screen, "pointerup", { pointerId: 2 });
  await waitFor(() => f.calls.filter(call => call.name === "mobile_ios_mirror_input").length >= 2);
});

test("physical iOS capture errors stay visible and clear when mirroring recovers", async t => {
  const f = fakeDeviceTools(t, { physical: [physicalPhone] });
  await f.ios.panel.load();
  await f.android.panel.load();
  await waitFor(() => f.android.canvas.draws > 0);
  const message = "A phone or VoIP call is currently in progress on the device.";
  f.fail("mobile_ios_mirror_session", message);
  f.ios.picker.select(physicalPhone.udid);
  await waitFor(() => f.ios.message?.description === message);
  assert.equal(f.ios.message?.title, "Screen unavailable");
  assert.equal(f.ios.view.screenshot.disabled, true);
  assert.equal(f.android.view.display.kind, "frame");
  f.fail("mobile_ios_mirror_session");
  await waitFor(() => f.ios.view.display.kind === "frame");
  assert.equal(f.ios.view.notice.message, "");
  assert.equal(f.ios.view.screenshot.disabled, false);
});

test("physical iOS screenshots capture the displayed frame without a simulator backend", async t => {
  const f = fakeDeviceTools(t, backendDown);
  await f.ios.panel.load();
  await waitFor(() => f.ios.view.screenshot.disabled === false);
  f.ios.panel.screenshot();
  await waitFor(() => f.screenshots.length === 1);
  const captured = f.calls.find(call => call.name === "mobile_ios_mirror_capture_screenshot");
  assert.match(captured?.arguments.sessionId as string, /^physical-/);
  assert.equal(captured?.arguments.image, "AA==");
  assert.equal(f.screenshots[0].data, "/9j/2Q==");
  assert.equal(f.screenshots[0].mimeType, "image/jpeg");
  assert.equal(f.screenshots[0].simulator.udid, physicalPhone.udid);
  await waitFor(() => f.ios.view.screenshot.disabled === false);
  // The clipboard copy is the server's business; the chat attachment still arrives.
  f.answer("mobile_ios_mirror_capture_screenshot", args => ({ content: [{ type: "image", mimeType: "image/png", data: String(args.image) }], structuredContent: { copied: false, clipboardError: "Clipboard unavailable" } }));
  f.ios.panel.screenshot();
  await waitFor(() => f.screenshots.length === 2);
  assert.equal(f.calls.filter(call => call.name === "mobile_capture_screenshot").length, 0);
  f.visibility("hidden");
  assert.equal(f.ios.view.screenshot.disabled, true);
  await f.ios.panel.dispose();
  assert.equal(f.ios.view.screenshot.disabled, true);
});

test("physical iOS Select annotates screen regions in pixels without simulator accessibility or device input", async t => {
  const f = fakeDeviceTools(t, backendDown);
  await f.ios.panel.load();
  const store = f.ios.annotations;
  await waitFor(() => store.getSnapshot().disabled === false);
  await store.toggle();
  const state = store.getSnapshot();
  assert.equal(state.selecting, true);
  assert.equal(state.error, "");
  assert.deepEqual(state.capture?.screen, { width: 400, height: 800, units: "pixels" });
  const screen = f.ios.canvas;
  dispatch(screen, "pointermove", { pointerId: 1, clientX: 75, clientY: 150 });
  assert.equal(store.getSnapshot().hovered, undefined);
  dispatch(screen, "pointerdown", { button: 0, pointerId: 1, clientX: 75, clientY: 150 });
  dispatch(screen, "pointerup", { button: 0, pointerId: 1, clientX: 75, clientY: 150 });
  const draft = store.getSnapshot().draft;
  assert.deepEqual(draft?.point, { x: 200, y: 400 });
  assert.equal(draft?.component.name, "Screen point");
  store.setText("Make this larger");
  await store.save();
  assert.equal(f.attachedAnnotations.length, 1);
  assert.equal(f.attachedAnnotations[0].simulator.udid, physicalPhone.udid);
  assert.equal(f.attachedAnnotations[0].screen.units, "pixels");
  dispatch(screen, "keydown", { key: "Escape", code: "Escape" });
  assert.equal(store.getSnapshot().selecting, false);
  dispatch(screen, "keydown", { key: "a", code: "KeyA" });
  assert.equal(f.calls.filter(call => call.name === "mobile_ios_mirror_input").length, 0);
  assert.equal(f.calls.filter(call => call.name.endsWith("_describe_ui") || call.name === "mobile_inspect_ui").length, 0);
  f.visibility("hidden");
  assert.equal(store.getSnapshot().disabled, true);
});

test("physical iOS Screenshot and Select wait for video and disable when the phone disconnects", async t => {
  const f = fakeDeviceTools(t, backendDown);
  let release!: () => void;
  f.delay("mobile_ios_mirror_session", new Promise<void>(resolve => { release = resolve; }));
  await f.ios.panel.load();
  const store = f.ios.annotations;
  assert.equal(f.ios.view.screenshot.disabled, true);
  assert.equal(store.getSnapshot().disabled, true);
  release();
  await waitFor(() => f.ios.view.screenshot.disabled === false);
  assert.equal(store.getSnapshot().disabled, false);
  f.setPhysical([]);
  await f.ios.picker.refresh();
  assert.equal(f.ios.view.screenshot.disabled, true);
  assert.equal(store.getSnapshot().disabled, true);
});
