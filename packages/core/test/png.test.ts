import test from "node:test";
import assert from "node:assert/strict";
import { assertPng, isPng, screenshotResult } from "../src/png.ts";
import { PNG } from "../../test-support/fixtures.ts";

test("screenshots must be whole PNGs within the size limit", () => {
  assert.equal(isPng(PNG), true);
  assert.equal(assertPng(PNG, PNG.length, "Baguette"), PNG);
  assert.throws(() => assertPng(PNG, PNG.length - 1, "Baguette"), /^Error: Baguette returned an invalid or oversized PNG screenshot\.$/);
  assert.throws(() => assertPng(Buffer.from("not a PNG"), 1024, "serve-emu"), /serve-emu returned an invalid/);
});

test("screenshot results return the image and say whether the clipboard took it", async () => {
  const copied = await screenshotResult(PNG, { udid: "phone" }, { copy: async () => {}, operation: "test.clipboard" });
  assert.deepEqual(copied, { content: [{ type: "image", mimeType: "image/png", data: PNG.toString("base64") }], structuredContent: { udid: "phone", copied: true } });
  const failed = await screenshotResult(PNG, { deviceId: "emulator-5554" }, { copy: async () => { throw new Error("Clipboard unavailable"); }, operation: "test.clipboard", data: "original" });
  assert.deepEqual(failed, { content: [{ type: "image", mimeType: "image/png", data: "original" }], structuredContent: { deviceId: "emulator-5554", copied: false, clipboardError: "Clipboard unavailable" } });
});
