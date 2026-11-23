import test from "node:test";
import assert from "node:assert/strict";
import { DeviceWorkspace } from "../src/device-workspace.ts";
import type { HostBridge } from "../src/host-bridge.ts";
import type { SimulatorDevice } from "../../shared/src/protocol.ts";

const phone: SimulatorDevice = { udid: "iphone", name: "iPhone", state: "Booted", platform: "ios", runtime: "iOS" };
const pixel: SimulatorDevice = { udid: "pixel", name: "Pixel", state: "Booted", platform: "android", runtime: "Android", kind: "emulator" };

function workspace() {
  const app = { async callServerTool() { return { structuredContent: { devices: [], physicalDevices: [] } }; } } as unknown as HostBridge;
  const tools = { context: { selectSimulators() {} }, deviceApps: { selectDevice() {} } } as ConstructorParameters<typeof DeviceWorkspace>[1];
  return new DeviceWorkspace(app, tools);
}

function discovered(device: SimulatorDevice) {
  return { connected: true, managed: false, baseUrl: "", devices: [device] };
}

test("late discovery opens the first mirror once and respects manual removal", async t => {
  const devices = workspace();
  t.after(() => devices.dispose());
  await devices.open({});
  await devices.setAvailable(true);
  assert.equal(devices.getSnapshot().panes.length, 0);
  devices.inventory.ios.apply(discovered(phone));
  devices.inventory.android.apply(discovered(pixel));
  assert.deepEqual(devices.getSnapshot().panes.map(pane => pane.device?.udid), [phone.udid]);
  devices.toggle("ios", phone);
  devices.inventory.ios.apply(discovered(phone));
  assert.equal(devices.getSnapshot().panes.length, 0);
});

test("an opening target waits for its platform and a test lane selects its exact device", async t => {
  const devices = workspace();
  t.after(() => devices.dispose());
  await devices.open({ platform: "android" });
  await devices.setAvailable(true);
  devices.inventory.ios.apply(discovered(phone));
  assert.equal(devices.getSnapshot().panes.length, 0);
  devices.inventory.android.apply(discovered(pixel));
  const other = { ...pixel, udid: "second" };
  devices.inventory.android.apply({ ...discovered(pixel), devices: [pixel, other] });
  assert.equal(devices.showDevice("android", other.udid), true);
  assert.equal(devices.showDevice("android", pixel.udid), true);
  const { active, panes } = devices.getSnapshot();
  assert.equal(panes.length, 2);
  assert.equal(panes.find(pane => pane.key === active)?.device?.udid, pixel.udid);
  assert.equal(devices.showDevice("android", "missing"), false);
});
