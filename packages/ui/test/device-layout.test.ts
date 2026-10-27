import test from "node:test";
import assert from "node:assert/strict";
import { activeDeviceLayout, initialPanelDevice } from "../src/device-layout.ts";
import { panelTargetSchema } from "../../shared/src/panel-target.ts";
import type { SimulatorDevice } from "../../shared/src/protocol.ts";
import type { PanelTarget } from "../../shared/src/panel-target.ts";

const iosSimulator: SimulatorDevice = { udid: "ios", name: "iPhone", state: "Booted", runtime: "iOS", platform: "ios", kind: "simulator" };
const androidEmulator: SimulatorDevice = { udid: "emulator-5554", name: "Pixel", state: "Booted", runtime: "Android", platform: "android", kind: "emulator" };
const iosPhone: SimulatorDevice = {
  udid: "iphone", coreDeviceId: "core-device", name: "iPhone", model: "iPhone", productType: "iPhone18,1", state: "connected", runtime: "iOS",
  platform: "ios", kind: "physical", transportType: "wired", pairingState: "paired",
};
const androidPhone: SimulatorDevice = { udid: "phone", name: "Pixel", model: "Pixel", state: "Booted", runtime: "Android", platform: "android", kind: "physical", transportType: "wired" };

test("one active platform opens by default, preferring iOS when both have active devices", () => {
  for (const ios of [iosSimulator, iosPhone]) {
    assert.equal(activeDeviceLayout(ios), "ios");
    for (const android of [androidEmulator, androidPhone]) {
      assert.equal(activeDeviceLayout(undefined, android), "android");
      assert.equal(activeDeviceLayout(ios, android), "ios");
    }
  }
});

test("stopped, disconnected, offline, and unauthorized devices do not activate a platform", () => {
  const inactiveIos: SimulatorDevice[] = [{ ...iosSimulator, state: "Shutdown" }, { ...iosPhone, state: "disconnected" }];
  const inactiveAndroid: SimulatorDevice[] = [{ ...androidEmulator, state: "Shutdown" }, { ...androidPhone, state: "offline" }, { ...androidPhone, state: "unauthorized" }];
  assert.equal(activeDeviceLayout(), "none");
  for (const ios of inactiveIos) {
    assert.equal(activeDeviceLayout(ios, androidPhone), "android");
    for (const android of inactiveAndroid) {
      assert.equal(activeDeviceLayout(iosPhone, android), "ios");
      assert.equal(activeDeviceLayout(ios, android), "none");
    }
  }
});

test("opening targets validate platform and kind without filling in undecided choices", () => {
  const automatic = panelTargetSchema.parse({});
  assert.deepEqual(automatic, {});
  for (const target of [{ platform: "ios", kind: "emulator" }, { platform: "android", kind: "simulator" }, { deviceId: "../../phone" }]) {
    const parsed = panelTargetSchema.safeParse(target);
    assert.equal(parsed.success, false);
  }
  const physical = panelTargetSchema.parse({ kind: "physical" });
  assert.deepEqual(physical, { kind: "physical" });
  const networkDeviceId = "[fe80::1234%en0]:5555";
  const networkTarget = panelTargetSchema.parse({ platform: "android", kind: "physical", deviceId: networkDeviceId });
  assert.equal(networkTarget.deviceId, networkDeviceId);
});

test("opening constraints override an incompatible previous device and never select another kind or ID", () => {
  const ios = [iosPhone, iosSimulator];
  const android = [androidPhone, androidEmulator];
  const stopped = { ...androidEmulator, state: "Shutdown" };
  const ipad = { ...iosSimulator, udid: "ipad", state: "Shutdown" };
  const cases: Array<{ devices: SimulatorDevice[]; platform: "ios" | "android"; previous?: string; target?: PanelTarget; expected?: SimulatorDevice }> = [
    { devices: ios, platform: "ios", previous: iosSimulator.udid, target: { kind: "physical" }, expected: iosPhone },
    { devices: android, platform: "android", previous: androidPhone.udid, target: { kind: "emulator" }, expected: androidEmulator },
    { devices: ios, platform: "ios", target: { platform: "android" } },
    { devices: android, platform: "android", target: { kind: "simulator" } },
    { devices: ios, platform: "ios", target: { deviceId: "missing" } },
    { devices: [iosSimulator], platform: "ios", target: { kind: "physical" } },
    { devices: [stopped], platform: "android", target: { kind: "emulator" }, expected: stopped },
    { devices: [stopped], platform: "android" },
    { devices: ios, platform: "ios", expected: iosSimulator },
    { devices: ios, platform: "ios", previous: iosPhone.udid, expected: iosPhone },
    { devices: [...ios, ipad], platform: "ios", previous: iosSimulator.udid, target: { deviceId: "ipad" }, expected: ipad },
  ];
  for (const item of cases) {
    const selected = initialPanelDevice(item.devices, item.platform, item.previous, item.target);
    assert.equal(selected, item.expected);
  }
});
