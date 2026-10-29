import test from "node:test";
import assert from "node:assert/strict";
import { isDeviceActive, isPhysicalIos, sameDevice } from "../src/devices.ts";
import { avdId, isEmulatorSerial, isStoppedAvd, stoppedAvdName } from "../src/android-ids.ts";
import { cpuTargetSchema } from "../src/cpu.ts";
import { deviceChoiceReferenceSchema } from "../src/device-choice.ts";
import { deviceRefSchema, deviceTargetSchema } from "../src/device-ref.ts";
import { displayFpsTargetSchema } from "../src/display-fps.ts";
import { nativeLogTargetSchema } from "../src/logs.ts";
import { panelTargetSchema } from "../src/panel-target.ts";
import type { SimulatorDevice } from "../src/protocol.ts";
import { UDID } from "../../test-support/fixtures.ts";

const simulator: SimulatorDevice = { udid: UDID, name: "iPhone", state: "Booted", runtime: "iOS 27", platform: "ios", kind: "simulator" };
const phone: SimulatorDevice = { udid: "00008150-001068280AE8C01C", coreDeviceId: UDID, name: "iPhone", model: "iPhone", productType: "iPhone18,1",
  state: "connected", runtime: "iOS 27", platform: "ios", kind: "physical", pairingState: "paired" };
const pixel: SimulatorDevice = { udid: "R5CT1234567", name: "Pixel", state: "Booted", runtime: "Android", platform: "android", kind: "physical", transportType: "wired" };

test("paired iPhones are active when connected, every other device when booted", () => {
  assert.equal(isPhysicalIos(phone), true);
  assert.equal(isPhysicalIos(pixel), false);
  assert.equal(isPhysicalIos(simulator), false);
  assert.equal(isPhysicalIos(undefined), false);
  assert.equal(isDeviceActive(phone), true);
  assert.equal(isDeviceActive({ ...phone, state: "disconnected" }), false);
  assert.equal(isDeviceActive({ ...phone, state: "Booted" }), false);
  assert.equal(isDeviceActive(simulator), true);
  assert.equal(isDeviceActive(pixel), true);
  assert.equal(isDeviceActive({ ...pixel, state: "connected" }), false);
  assert.equal(isDeviceActive(undefined), false);
});

test("the same device in a new state is a different selection", () => {
  assert.equal(sameDevice(simulator, { ...simulator }), true);
  assert.equal(sameDevice(simulator, { ...simulator, name: "Renamed" }), true);
  assert.equal(sameDevice(simulator, { ...simulator, state: "Shutdown" }), false);
  assert.equal(sameDevice(phone, { ...pixel, udid: phone.udid, state: phone.state }), false);
  assert.equal(sameDevice(undefined, undefined), true);
  assert.equal(sameDevice(simulator, undefined), false);
});

test("stopped emulators are listed by AVD name and running ones by serial", () => {
  assert.equal(avdId("Pixel_9"), "avd:Pixel_9");
  assert.equal(isStoppedAvd("avd:Pixel_9"), true);
  assert.equal(isStoppedAvd("emulator-5554"), false);
  assert.equal(stoppedAvdName("avd:Pixel_9"), "Pixel_9");
  assert.equal(stoppedAvdName("emulator-5554"), undefined);
  assert.equal(stoppedAvdName(undefined), undefined);
  assert.equal(isEmulatorSerial("emulator-5554"), true);
  assert.equal(isEmulatorSerial("emulator-"), false);
  assert.equal(isEmulatorSerial("192.168.1.20:5555"), false);
});

test("every device target accepts each kind of device ID that device discovery returns", () => {
  const wireless = "[fe80::1%en0]:5555";
  assert.equal(deviceRefSchema.safeParse({ platform: "android", deviceId: wireless }).success, true);
  assert.equal(deviceRefSchema.safeParse({ platform: "android", deviceId: "emulator-5554;id" }).success, false);
  assert.equal(deviceRefSchema.safeParse({ platform: "android", deviceId: "" }).success, false);
  assert.equal(deviceRefSchema.safeParse({ platform: "android", deviceId: "a".repeat(257) }).success, false);
  assert.equal(displayFpsTargetSchema.safeParse({ platform: "android", deviceId: wireless }).success, true);
  assert.equal(cpuTargetSchema.safeParse({ platform: "android", deviceId: wireless, bundleId: "com.example.app" }).success, true);
  assert.equal(nativeLogTargetSchema.safeParse({ platform: "android", deviceId: wireless }).success, true);
  assert.equal(panelTargetSchema.safeParse({ platform: "android", deviceId: wireless }).success, true);
  assert.equal(deviceChoiceReferenceSchema.safeParse({ platform: "android", kind: "physical", deviceId: wireless }).success, true);
  assert.equal(deviceTargetSchema.safeParse({ platform: "android", id: wireless }).success, true);
});

test("iOS simulator targets require a simulator UUID and physical ones a hardware UDID", () => {
  assert.match(cpuTargetSchema.safeParse({ platform: "ios", deviceId: "phone", bundleId: "com.example.app" }).error?.message ?? "", /iOS simulator UUID/);
  assert.equal(cpuTargetSchema.safeParse({ platform: "ios", kind: "physical", deviceId: phone.udid, bundleId: "com.example.app" }).success, true);
  assert.match(deviceChoiceReferenceSchema.safeParse({ platform: "ios", kind: "simulator", deviceId: "phone" }).error?.message ?? "", /simulator UUID/);
  assert.equal(deviceChoiceReferenceSchema.safeParse({ platform: "ios", kind: "physical", deviceId: phone.udid }).success, true);
  assert.equal(deviceChoiceReferenceSchema.safeParse({ platform: "ios", kind: "simulator", deviceId: UDID }).success, true);
  assert.equal(deviceTargetSchema.safeParse({ platform: "ios", id: "emulator-5554" }).success, false);
  assert.equal(deviceTargetSchema.safeParse({ platform: "ios", id: UDID }).success, true);
});
