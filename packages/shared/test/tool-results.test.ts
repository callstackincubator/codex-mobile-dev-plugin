import test from "node:test";
import assert from "node:assert/strict";
import { LogBuffer } from "../../core/src/log-buffer.ts";
import { CpuBuffer } from "../../core/src/cpu/buffer.ts";
import { parseSimulatorList } from "../../core/src/simctl.ts";
import { logBatchSchema } from "../src/logs.ts";
import { cpuBatchSchema } from "../src/cpu.ts";
import { displayFpsBatchSchema } from "../src/display-fps.ts";
import { androidVideoBatchSchema } from "../src/android-video.ts";
import { normalizeDevices } from "../src/protocol.ts";
import {
  cpuSessionResultSchema, deviceSettingsResultSchema, displayFpsSessionResultSchema, logSessionResultSchema, logSourcesResultSchema,
  physicalIosDevicesResultSchema, simulatorStatusResultSchema, streamSessionMetaSchema, streamSessionResultSchema,
} from "../src/tool-results.ts";
import { OTHER_UDID, UDID } from "../../test-support/fixtures.ts";

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

test("stream sessions carry the screen size, input status and frame address the panel reads", () => {
  const simulator = { udid: UDID, fps: 60, inputStatus: { state: "blocked" }, inputRepairMessage: "Input is blocked again.",
    definition: { identity: { udid: UDID, name: "iPhone", model: "iPhone 17" }, screen: { rect: { width: 402, height: 874, x: 0, y: 0 }, clipRadius: 55 } } };
  assert.deepEqual(streamSessionResultSchema.parse(simulator), simulator);
  const android = { deviceId: "emulator-5554", definition: { identity: { udid: "emulator-5554", name: "Pixel", model: "Android" }, screen: { rect: { width: 1080, height: 2400 } } } };
  assert.deepEqual(streamSessionResultSchema.parse(android), android);
  assert.deepEqual(streamSessionResultSchema.parse({ name: "iPhone" }), { name: "iPhone" });
  assert.equal(streamSessionResultSchema.safeParse({ inputStatus: { state: "stuck" } }).success, false);
  const meta = { sessionId: "a".repeat(64), frameUri: `mobile-frame://${"a".repeat(64)}/latest?after=0`, bezel: { image: "data:image/png;base64,AA==" } };
  assert.deepEqual(streamSessionMetaSchema.parse(meta), meta);
});

test("settings, log sources and monitor sessions match what their tools return", () => {
  const settings = { appearance: "dark", contentSize: "large", locationSupported: true, location: { latitude: 52.5, longitude: 13.4 }, network: "custom", errors: ["Status bar: failed"] };
  assert.deepEqual(deviceSettingsResultSchema.parse({ settings }), { settings });
  assert.deepEqual(deviceSettingsResultSchema.parse({ settings: { appearance: "light" } }), { settings: { appearance: "light" } });
  const sources = { android: [{ id: "emulator-5554", name: "Pixel" }], metro: [{ id: "page-1", title: "App", appId: "com.example" }], errors: [] };
  assert.deepEqual(logSourcesResultSchema.parse(sources), sources);
  const id = "b".repeat(64);
  assert.deepEqual(logSessionResultSchema.parse({ sessionId: id, logsUri: `logs://mobile-dev/${id}/batch?after=0` }).sessionId, id);
  const cpu = { target: { platform: "android", deviceId: "emulator-5554", bundleId: "com.example.app" }, sessionId: id, cpuUri: `cpu://mobile-dev/${id}/batch?after=0` };
  assert.deepEqual(cpuSessionResultSchema.parse(cpu), cpu);
  const fps = { sessionId: id, timeOrigin: 1234.5, fpsUri: `display-fps://mobile-dev/${id}/batch?after=0` };
  assert.deepEqual(displayFpsSessionResultSchema.parse(fps), fps);
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
