import test from "node:test";
import assert from "node:assert/strict";
import { LogBuffer } from "../src/log-buffer.ts";
import { CpuBuffer } from "../src/cpu/buffer.ts";
import { parseSimulatorList } from "../src/simctl.ts";
import { logBatchSchema } from "@mobile-dev/shared/logs.ts";
import { cpuBatchSchema } from "@mobile-dev/shared/cpu.ts";
import { displayFpsBatchSchema } from "@mobile-dev/shared/display-fps.ts";
import { androidVideoBatchSchema } from "@mobile-dev/shared/android-video.ts";
import { normalizeDevices } from "@mobile-dev/shared/protocol.ts";
import { physicalIosDevicesResultSchema, simulatorStatusResultSchema } from "@mobile-dev/shared/tool-results.ts";
import { OTHER_UDID, UDID } from "@mobile-dev/test-support/fixtures.ts";

const phone = { udid: "00008150-001068280AE8C01C", coreDeviceId: OTHER_UDID, name: "iPhone", model: "iPhone 17 Pro", productType: "iPhone18,1",
  state: "connected", runtime: "iOS 27.0", platform: "ios", kind: "physical", transportType: "wired", pairingState: "paired" };

test("device listings from every backend read as one status result", () => {
  const simctl = JSON.stringify({ devices: { "com.apple.CoreSimulator.SimRuntime.iOS-27-0": [{ udid: UDID, name: "iPhone 18 Pro", state: "Booted", isAvailable: true }] } });
  const ios = { connected: true, managed: false, baseUrl: "", devices: parseSimulatorList(simctl), panelTarget: { platform: "ios" } };
  assert.deepEqual(simulatorStatusResultSchema.parse(ios), ios);
  const baguette = { connected: true, managed: true, baseUrl: "http://127.0.0.1:8421", devices: normalizeDevices({ running: [{ udid: UDID, name: "iPhone" }], available: [] }) };
  assert.deepEqual(simulatorStatusResultSchema.parse(baguette), baguette);
  const android = { connected: true, managed: false, baseUrl: "", devices: [
    { udid: "emulator-5554", name: "Pixel_9", state: "Booted", runtime: "Android", platform: "android", kind: "emulator" },
    { udid: "avd:Pixel_8", name: "Pixel_8", state: "Shutdown", runtime: "Android", platform: "android", kind: "emulator" },
    { udid: "192.168.1.20:5555", name: "Pixel 9", model: "Pixel 9", state: "Booted", runtime: "Android", platform: "android", kind: "physical", transportType: "localNetwork" },
  ] };
  assert.deepEqual(simulatorStatusResultSchema.parse(android), android);
  const offline = { connected: false, managed: false, baseUrl: "", devices: [], error: "Cannot list Android devices." };
  assert.deepEqual(simulatorStatusResultSchema.parse(offline), offline);
  assert.equal(simulatorStatusResultSchema.safeParse({ ...android, devices: [{ ...android.devices[0], kind: "simulator" }] }).success, false);
  assert.deepEqual(physicalIosDevicesResultSchema.parse({ physicalDevices: [phone] }), { physicalDevices: [phone] });
});

test("the polled batches core emits parse with their shared schemas", async () => {
  const logs = new LogBuffer();
  logs.push({ timestamp: "2026-10-29T10:00:00.000Z", level: "error", source: "native", origin: "ios", deviceId: UDID, message: "Failed", process: "Example", pid: 42 });
  logs.status({ source: "native", state: "live" });
  const logBatch = JSON.parse(JSON.stringify(await logs.read(0, 0)));
  assert.deepEqual(logBatchSchema.parse(logBatch), logBatch);
  const cpu = new CpuBuffer("rss");
  cpu.push({ time: 1, interval: 1, cpuPercent: 12.5, memoryBytes: 1024, threads: [{ id: "1", name: "main", cpuPercent: null }] });
  const cpuBatch = JSON.parse(JSON.stringify(await cpu.read(0, 0)));
  assert.deepEqual(cpuBatchSchema.parse(cpuBatch), cpuBatch);
  const fpsBatch = { cursor: 3, phase: "recording", samples: [
    { time: 1, interval: 1, fps: 59.9, frameTimeline: { clock: "boottime", intervalEndNs: "2000", frames: [{ token: "1", startTimeNs: "1000", endTimeNs: "1500", presentType: 1 }] } },
    { time: 2, interval: 1, fps: null },
  ] };
  assert.deepEqual(displayFpsBatchSchema.parse(fpsBatch), fpsBatch);
  const video = { generation: 2, sequence: 7, packets: [{ sequence: 7, data: "AAAAAWdk" }] };
  assert.deepEqual(androidVideoBatchSchema.parse(video), video);
  assert.equal(androidVideoBatchSchema.safeParse({ ...video, sequence: -1 }).success, false);
});
