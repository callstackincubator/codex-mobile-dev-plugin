import assert from "node:assert/strict";
import test from "node:test";
import { expectedOutcome } from "../../shared/src/error-reporting.ts";
import type { PhysicalIosDevice } from "../../shared/src/ios-devices.ts";
import { parseAdbDevices } from "../src/android-sdk.ts";
import { deviceCapabilities, DeviceResolver } from "../src/devices.ts";
import { fakeSimctl, UDID } from "../../test-support/fixtures.ts";

const IPHONE = "00008110-001A2B3C4D5E6F70";
const iphone: PhysicalIosDevice = {
  udid: IPHONE, coreDeviceId: "6A9F4E7C-1B2D-4E3F-8A9B-0C1D2E3F4A5B", name: "Phone", model: "iPhone 17", productType: "iPhone18,1",
  state: "connected", runtime: "iOS 27.0", platform: "ios", kind: "physical", transportType: "wired", pairingState: "paired",
};

test("one adb parser reads every state, the model and only valid serials", () => {
  const output = "List of devices attached\r\nemulator-5554\tdevice product:sdk model:sdk_gphone64_arm64 device:emu64a transport_id:1\r\n"
    + "R5CT\tunauthorized usb:1-1 transport_id:2\n192.168.1.4:5555 offline\nbad/serial device\n\n";
  assert.deepEqual(parseAdbDevices(output), [
    { serial: "emulator-5554", state: "device", model: "sdk gphone64 arm64" },
    { serial: "R5CT", state: "unauthorized" },
    { serial: "192.168.1.4:5555", state: "offline" },
  ]);
});

test("capabilities decide memory, Display FPS and the FPS drain per kind of device", () => {
  assert.deepEqual(deviceCapabilities({ platform: "android" }), { memoryMetric: "rss", displayFps: true, fpsDrainMs: 5000 });
  assert.deepEqual(deviceCapabilities({ platform: "ios", kind: "physical" }), { memoryMetric: "physical-footprint", displayFps: true, fpsDrainMs: 1500 });
  assert.deepEqual(deviceCapabilities({ platform: "ios" }), { memoryMetric: "physical-footprint", displayFps: false, fpsDrainMs: 1500 });
});

test("each purpose keeps its own requirements and messages", async () => {
  let phone: PhysicalIosDevice | undefined = iphone;
  const devices = new DeviceResolver({ simulators: fakeSimctl(), ios: async () => phone ? [phone] : [], android: async () => [{ id: "emulator-5554", name: "Pixel" }] });
  const rejects = (promise: Promise<unknown>, message: string, outcome = "device_unavailable") => assert.rejects(promise, error => {
    assert.equal((error as Error).message, message);
    assert.equal(expectedOutcome(error), outcome);
    return true;
  });
  assert.equal((await devices.resolve({ platform: "android", deviceId: "emulator-5554" }, "fps")).name, "Pixel");
  const absent = { platform: "android" as const, deviceId: "R5CT" };
  await rejects(devices.resolve(absent, "cpu"), "The Android device is offline or unauthorized. Connect and authorize it through ADB.");
  await rejects(devices.resolve(absent, "fps"), "Connect and authorize the Android device through ADB.");
  await rejects(devices.resolve(absent, "logs"), "The selected Android device is absent or unauthorized. Refresh log sources.");

  const simulator = await devices.resolve({ platform: "ios", deviceId: UDID }, "cpu");
  assert.equal(simulator.platform === "ios" && simulator.kind, "simulator");
  assert.equal(simulator.name, "iPhone 17");
  await rejects(devices.resolve({ platform: "ios", deviceId: UDID }, "fps"), "Display FPS is available on physical iOS devices, not simulators.", "invalid_input");

  const target = { platform: "ios" as const, kind: "physical" as const, deviceId: IPHONE };
  for (const purpose of ["cpu", "logs"] as const) assert.equal((await devices.resolve(target, purpose)).name, "Phone");
  assert.equal((await devices.resolve({ platform: "ios", deviceId: IPHONE }, "fps")).name, "Phone");
  phone = { ...iphone, transportType: "bluetooth" };
  await rejects(devices.resolve(target, "logs"), "The selected iPhone has no supported USB or Wi-Fi connection.");
  assert.equal((await devices.resolve(target, "cpu")).name, "Phone");
  phone = { ...iphone, pairingState: "unpaired" };
  await rejects(devices.resolve(target, "logs"), "The selected iPhone is not paired. Unlock it and trust this Mac.");
  await rejects(devices.resolve(target, "cpu"), "Connect the paired iPhone and enable Developer Mode to monitor CPU and memory.");
  // Display FPS asks only for a connected iPhone.
  assert.equal((await devices.resolve({ platform: "ios", deviceId: IPHONE }, "fps")).name, "Phone");
  phone = { ...iphone, state: "disconnected" };
  await rejects(devices.resolve({ platform: "ios", deviceId: IPHONE }, "fps"), "Connect the paired iPhone to monitor Display FPS.");
  phone = undefined;
  await rejects(devices.resolve(target, "logs"), "The selected physical iOS device is no longer connected. Refresh the device list.");
  await rejects(devices.resolve(target, "cpu"), "Connect the paired iPhone and enable Developer Mode to monitor CPU and memory.");
});
