import test from "node:test";
import assert from "node:assert/strict";
import { WorkspaceDevices } from "../src/workspace-devices.ts";
import type { DeviceLayout } from "../src/device-layout.ts";
import { androidPhone, fakeDeviceTools, iphone, physicalPhone, waitFor } from "./simulator-fixture.ts";

const avd = { udid: "emulator-5554", name: "Pixel AVD", state: "Booted", runtime: "Android", platform: "android", kind: "emulator" } as const;

for (const inputFirst of [false, true]) test(`Android opening intent is applied before streams start, input first: ${inputFirst}`, async t => {
  const f = fakeDeviceTools(t, { android: [androidPhone, avd] });
  const layouts: DeviceLayout[] = [];
  const workspace = new WorkspaceDevices(f.panels, layout => { layouts.push(layout); });
  t.after(() => workspace.dispose());
  const target = { platform: "android", kind: "emulator" } as const;
  if (inputFirst) await workspace.open(target);
  else await workspace.setAvailable(true);
  assert.equal(f.calls.length, 0, "Discovery waits for both the host and the opening intent.");
  if (inputFirst) await workspace.setAvailable(true);
  else await workspace.open(target);
  assert.equal(f.ios.panel.selected, undefined);
  assert.equal(f.android.panel.selected?.udid, "emulator-5554");
  const streams = f.streams();
  assert.equal(streams.length, 1);
  assert.equal(streams[0].name, "mobile_android_stream_session");
  assert.deepEqual(streams[0].arguments, { deviceId: "emulator-5554" });
  assert.deepEqual(layouts, ["android", "android"]);
});

for (const platform of ["ios", "android"] as const) test(`${platform} physical opening intent selects the phone before any simulator`, async t => {
  const f = fakeDeviceTools(t, { physical: [physicalPhone], android: [avd, androidPhone] });
  const layouts: DeviceLayout[] = [];
  const workspace = new WorkspaceDevices(f.panels, layout => { layouts.push(layout); });
  t.after(() => workspace.dispose());
  await workspace.setAvailable(true);
  await workspace.open({ platform, kind: "physical" });
  assert.equal(f[platform].panel.selected?.kind, "physical");
  const streams = f.streams();
  assert.equal(streams.length, 1);
  assert.equal(streams[0].name, platform === "ios" ? "mobile_ios_mirror_session" : "mobile_android_stream_session");
  assert.equal(layouts.at(-1), platform);
});

test("missing exact target remains unselected through refreshes, then connects when it arrives", async t => {
  const f = fakeDeviceTools(t);
  f.ios.panel.setOpeningTarget({ platform: "ios", kind: "physical", deviceId: physicalPhone.udid });
  await f.ios.panel.load();
  assert.equal(f.ios.panel.selected, undefined);
  assert.equal(f.ios.message?.title, "Requested device unavailable.");
  await f.ios.picker.refresh();
  assert.equal(f.streams().length, 0);
  f.setPhysical([physicalPhone]);
  await f.ios.picker.refresh();
  await waitFor(() => f.calls.some(call => call.name === "mobile_ios_mirror_session"));
  assert.equal(f.ios.panel.selected?.udid, physicalPhone.udid);
  f.setPhysical([]);
  await f.ios.picker.refresh();
  assert.equal(f.ios.panel.selected, undefined, "Disconnecting the requested phone does not select a simulator.");
  f.ios.picker.select("iphone-1");
  await waitFor(() => f.calls.some(call => call.name === "mobile_stream_session"));
  await f.ios.picker.refresh();
  assert.equal(f.ios.panel.selected?.udid, "iphone-1", "The user's later device choice replaces the opening constraint.");
});

test("automatic opening retains iOS precedence and later manual layout survives duplicate results", async t => {
  const f = fakeDeviceTools(t);
  const layouts: DeviceLayout[] = [];
  const workspace = new WorkspaceDevices(f.panels, layout => { layouts.push(layout); });
  t.after(() => workspace.dispose());
  await workspace.open({});
  await workspace.setAvailable(true);
  assert.equal(layouts.at(-1), "ios");
  workspace.selectLayout();
  layouts.push("android");
  const count = f.calls.length;
  await workspace.open({ platform: "ios" });
  assert.equal(f.calls.length, count);
  assert.equal(layouts.at(-1), "android");
});

test("targeted stopped AVD opens without booting and tracks its running serial after boot", async t => {
  const f = fakeDeviceTools(t, { android: [{ ...avd, udid: "avd:Pixel", name: "Pixel", state: "Shutdown" }] });
  f.android.panel.setOpeningTarget({ platform: "android", kind: "emulator", deviceId: "avd:Pixel" });
  await f.android.panel.load();
  assert.equal(f.android.panel.selected?.state, "Shutdown");
  assert.equal(f.android.view.start.disabled, false);
  assert.equal(f.calls.filter(call => call.name.startsWith("mobile_boot")).length, 0);
  f.setDevices("android", []);
  await f.android.picker.refresh();
  assert.equal(f.android.panel.selected, undefined);
  f.setDevices("android", [{ ...avd, name: "Pixel" }]);
  await f.android.picker.refresh();
  assert.equal(f.android.panel.selected?.udid, "emulator-5554");
  await f.android.picker.refresh();
  assert.equal(f.android.panel.selected?.udid, "emulator-5554");
});

test("a platform chosen during discovery is not overwritten when startup finishes", async t => {
  const f = fakeDeviceTools(t);
  let finishDiscovery: () => void = () => {};
  const discovery = new Promise<void>(resolve => { finishDiscovery = resolve; });
  f.delay("mobile_list_android_devices", discovery);
  f.delay("mobile_list_ios_devices", discovery);
  const layouts: DeviceLayout[] = [];
  const workspace = new WorkspaceDevices(f.panels, layout => { layouts.push(layout); });
  t.after(() => workspace.dispose());
  await workspace.setAvailable(true);
  const opening = workspace.open({ platform: "android" });
  workspace.selectLayout();
  layouts.push("ios");
  finishDiscovery();
  await opening;
  assert.equal(layouts.at(-1), "ios");
});

test("an exact Android target keeps the same AVD selected through Stop and Start", async t => {
  const f = fakeDeviceTools(t);
  f.android.panel.setOpeningTarget({ platform: "android", kind: "emulator", deviceId: "emulator-5554" });
  await f.android.panel.load();
  await f.android.picker.stopDevice("emulator-5554");
  assert.equal(f.android.panel.selected?.udid, "avd:Pixel");
  assert.equal(f.android.view.start.disabled, false);
  f.android.panel.startDevice();
  await waitFor(() => f.android.panel.selected?.state === "Booted" && f.android.view.start.disabled);
  await f.android.picker.refresh();
  assert.equal(f.android.panel.selected?.udid, "emulator-5554");
});

test("disposing the workspace before host readiness does not start device work", async t => {
  const f = fakeDeviceTools(t);
  const workspace = new WorkspaceDevices(f.panels, () => {});
  await workspace.open({ platform: "android" });
  workspace.dispose();
  await workspace.setAvailable(true);
  assert.equal(f.calls.length, 0);
});

test("physical discovery failure stays visible while simulator discovery remains usable", async t => {
  const f = fakeDeviceTools(t, { failures: { mobile_list_ios_devices: "Physical discovery requires Xcode 27" } });
  await f.ios.panel.load();
  assert.equal(f.ios.panel.selected?.udid, "iphone-1");
  assert.equal(f.ios.picker.getSnapshot().disabled, false);
  await waitFor(() => f.ios.canvas.draws > 0);
  assert.match(f.ios.view.notice.message, /Physical discovery requires Xcode 27/);
  f.fail("mobile_list_ios_devices");
  await f.ios.picker.refresh();
  assert.equal(f.ios.view.notice.message, "");
});

test("physical devices remain selectable when the simulator backend is unavailable", async t => {
  const f = fakeDeviceTools(t, { physical: [physicalPhone], failures: { mobile_list_simulators: "Baguette unavailable" } });
  await f.ios.panel.load();
  const state = f.ios.picker.getSnapshot();
  assert.equal(state.disabled, false);
  assert.equal(state.value, physicalPhone.udid);
  assert.deepEqual(state.items.map(item => item.group), ["Connected devices"]);
  assert.equal(f.ios.panel.selected?.kind, "physical");
  assert.equal(f.streams("mobile_stream_session").length, 0);
});

test("discovery polls only visible panels, shares an in-flight refresh, and stops on disposal", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fakeDeviceTools(t, { physical: [physicalPhone], failures: { mobile_list_simulators: "Baguette unavailable" } });
  await f.ios.panel.load();
  const reads = () => f.calls.filter(call => call.name === "mobile_list_ios_devices").length;
  f.ios.panel.setVisible(false);
  t.mock.timers.tick(3000);
  assert.equal(reads(), 1);
  f.ios.panel.setVisible(true);
  let release!: () => void;
  f.delay("mobile_list_ios_devices", new Promise<void>(resolve => { release = resolve; }));
  f.setPhysical([]);
  t.mock.timers.tick(3000);
  const refreshing = f.ios.picker.refresh();
  assert.equal(reads(), 2);
  release();
  await refreshing;
  assert.equal(f.ios.picker.getSnapshot().items.length, 0);
  await f.ios.panel.dispose();
  t.mock.timers.tick(10000);
  assert.equal(reads(), 2);
});

test("status arriving during startup still connects the selected device", async t => {
  const f = fakeDeviceTools(t);
  const starting = f.ios.panel.resume();
  const status = { connected: true, managed: true, baseUrl: "http://localhost/", devices: [iphone] };
  f.ios.panel.acceptStatus(status);
  await starting;
  await waitFor(() => f.ios.canvas.draws > 0);
  assert.equal(f.ios.message, undefined);
  assert.equal(f.streams("mobile_stream_session").length, 1);
  f.ios.panel.acceptStatus(status);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(f.streams("mobile_stream_session").length, 1);
  assert.equal(f.closed.length, 0);
});

for (const platform of ["ios", "android"] as const) test(`stopping the selected ${platform} device leaves the other stream open and allows restarting it`, async t => {
  const f = fakeDeviceTools(t);
  await Promise.all([f.ios.panel.load(), f.android.panel.load()]);
  await waitFor(() => f.ios.canvas.draws > 0 && f.android.canvas.draws > 0);
  const target = f[platform];
  await target.picker.stopDevice(target.picker.value);
  const shutdown = f.calls.find(call => call.name === (platform === "ios" ? "mobile_shutdown_simulator" : "mobile_shutdown_android_emulator"));
  assert.deepEqual(shutdown?.arguments, platform === "ios" ? { udid: "iphone-1" } : { deviceId: "emulator-5554" });
  assert.equal(f.closed.length, 1);
  assert.ok(f.closed[0].startsWith(platform));
  assert.equal(target.panel.selected?.state, "Shutdown");
  assert.equal(target.panel.selected?.udid, platform === "ios" ? "iphone-1" : "avd:Pixel");
  assert.equal(target.picker.getSnapshot().items[0].canStop, false);
  await target.picker.stopDevice(platform === "ios" ? "iphone-1" : "emulator-5554");
  assert.equal(f.calls.filter(call => call.name.startsWith("mobile_shutdown")).length, 1);
  assert.equal(target.panel.visible, true);
  assert.equal(target.view.display.kind, "stopped", "The last frame stays under the Device stopped overlay.");
  assert.equal(target.view.start.disabled, false);
  target.panel.startDevice();
  await waitFor(() => target.view.display.kind !== "stopped" && f.streams().length === 3);
  assert.equal(f.closed.length, 1);
});

test("refreshing the picker removes stop controls for devices stopped outside the panel", async t => {
  const f = fakeDeviceTools(t);
  await f.ios.panel.load();
  await waitFor(() => f.ios.canvas.draws > 0);
  f.stopDevices();
  await f.ios.picker.refresh();
  assert.equal(f.ios.picker.getSnapshot().items[0].running, false);
  assert.equal(f.ios.picker.getSnapshot().items[0].canStop, false);
  await f.ios.picker.stopDevice("iphone-1");
  assert.equal(f.calls.some(call => call.name.startsWith("mobile_shutdown")), false);
  assert.equal(f.ios.panel.visible, true);
});

for (const platform of ["ios", "android"] as const) test(`selecting a stopped ${platform} device boots and streams it without Start`, async t => {
  const f = fakeDeviceTools(t);
  f.stopDevices();
  const panel = f[platform];
  await panel.panel.load();
  assert.equal(panel.picker.value, "");
  assert.equal(f.calls.some(call => call.name.startsWith("mobile_boot")), false);
  panel.picker.select(platform === "ios" ? "iphone-1" : "emulator-5554");
  await waitFor(() => panel.canvas.draws > 0);
  assert.equal(f.calls.filter(call => call.name === (platform === "ios" ? "mobile_boot_simulator" : "mobile_boot_android_emulator")).length, 1);
  assert.equal(panel.view.buttons[0].disabled, false);
});

test("device settings target each selected simulator and leave both streams open", async t => {
  const f = fakeDeviceTools(t);
  await Promise.all([f.ios.panel.load(), f.android.panel.load()]);
  await waitFor(() => f.ios.canvas.draws > 0 && f.android.canvas.draws > 0);
  await f.ios.settings.load();
  await f.android.settings.change({ setting: "appearance", value: "dark" });
  const iosSettings = f.calls.find(call => {
    const target = call.arguments.target;
    return call.name === "mobile_device_settings" && typeof target === "object" && target !== null && "platform" in target && target.platform === "ios";
  });
  assert.deepEqual(iosSettings?.arguments, { target: { platform: "ios", id: "iphone-1" } });
  assert.deepEqual(f.calls.find(call => call.name === "mobile_update_device_setting")?.arguments, { target: { platform: "android", id: "emulator-5554" }, change: { setting: "appearance", value: "dark" } });
  f.ios.settings.toggleFrame(false);
  assert.equal(f.ios.view.layout.screen.borderRadius, "0");
  f.ios.settings.toggleFrame(true);
  assert.equal(f.closed.length, 0);
  assert.equal(f.streams().length, 2);
});

test("teardown closes both streams and closes sessions that finish opening late", async t => {
  const f = fakeDeviceTools(t);
  let release!: () => void;
  const opening = new Promise<void>(resolve => { release = resolve; });
  f.delay("mobile_stream_session", opening);
  f.delay("mobile_android_stream_session", opening);
  await Promise.all([f.ios.panel.load(), f.android.panel.load()]);
  await waitFor(() => f.streams().length === 2);
  await Promise.all([f.ios.panel.dispose(), f.android.panel.dispose()]);
  release();
  await waitFor(() => f.closed.length === 2);
  assert.ok(f.closed.some(id => id.startsWith("ios-")));
  assert.ok(f.closed.some(id => id.startsWith("android-")));
  assert.equal(f.ios.canvas.draws, 0);
  assert.equal(f.android.canvas.draws, 0);
});
