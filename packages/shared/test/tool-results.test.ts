import test from "node:test";
import assert from "node:assert/strict";
import { cpuSessionResultSchema, deviceSettingsResultSchema, displayFpsSessionResultSchema, logSessionResultSchema, logSourcesResultSchema, streamSessionMetaSchema, streamSessionResultSchema } from "../src/tool-results.ts";
import { UDID } from "@mobile-dev/test-support/fixtures.ts";

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
