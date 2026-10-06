import test from "node:test";
import assert from "node:assert/strict";
import { activeDeviceLayout } from "../src/ui/device-layout.ts";
import type { SimulatorDevice } from "../src/shared/protocol.ts";

const iosSimulator: SimulatorDevice = { udid: "ios", name: "iPhone", state: "Booted", runtime: "iOS", platform: "ios", kind: "simulator" };
const androidEmulator: SimulatorDevice = { udid: "emulator-5554", name: "Pixel", state: "Booted", runtime: "Android", platform: "android", kind: "emulator" };
const iosPhone: SimulatorDevice = {
  udid: "iphone", coreDeviceId: "core-device", name: "iPhone", model: "iPhone", productType: "iPhone18,1", state: "connected", runtime: "iOS",
  platform: "ios", kind: "physical", transportType: "wired", pairingState: "paired",
};
const androidPhone: SimulatorDevice = { udid: "phone", name: "Pixel", model: "Pixel", state: "Booted", runtime: "Android", platform: "android", kind: "physical", transportType: "wired" };

test("only active platforms are visible for simulators, emulators, and physical phones", () => {
  for (const ios of [iosSimulator, iosPhone]) {
    assert.equal(activeDeviceLayout(ios), "ios");
    for (const android of [androidEmulator, androidPhone]) {
      assert.equal(activeDeviceLayout(undefined, android), "android");
      assert.equal(activeDeviceLayout(ios, android), "both");
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
