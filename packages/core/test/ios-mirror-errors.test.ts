import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { ExpectedOperationError, expectedOutcome } from "@mobile-dev/shared/error-reporting.ts";
import { nativeCaptureError } from "../src/ios-native-capture.ts";
import { IosMirrorHub } from "../src/ios-mirror-hub.ts";
import { createIosMirrorServer } from "../src/ios-mirror-server.ts";
import { connectIosCapture } from "../src/ios-mirror-client.ts";

const callInProgress = "A phone or VoIP call is currently in progress on the device.";

test("addon error codes become stable codes, and expected device states skip reporting", () => {
  const busy = nativeCaptureError(new Error(`[core_device_9022] ${callInProgress}`));
  assert.ok(busy instanceof ExpectedOperationError);
  assert.equal(busy.message, callInProgress);
  assert.equal((busy as Error & { code: string }).code, "core_device_9022");
  assert.equal(expectedOutcome(busy), "device_unavailable");
  const missing = nativeCaptureError(new Error("[display_service_unavailable] The iPhone does not expose its display service. Enable Developer Mode."));
  assert.equal(expectedOutcome(missing), "unsupported_platform");
  const failed = nativeCaptureError(new Error("[stream_failed] adapter closed"));
  assert.ok(failed instanceof Error);
  assert.equal(failed instanceof ExpectedOperationError, false);
  assert.equal(failed.message, "adapter closed");
  assert.equal((failed as Error & { code: string }).code, "stream_failed");
  const other = nativeCaptureError(new Error("CoreDevice refused [maybe] later"));
  assert.equal((other as Error).message, "CoreDevice refused [maybe] later");
  assert.equal("code" in (other as Error), false);
});

test("the shared capture service keeps a device state expected for the panel process", async t => {
  const hub = new IosMirrorHub(async () => { throw nativeCaptureError(new Error(`[core_device_9022] ${callInProgress}`)); });
  const service = createIosMirrorServer(hub, () => {}, () => {});
  const path = `/tmp/mobile-dev-mirror-test-${randomUUID()}.sock`;
  service.server.listen(path);
  await once(service.server, "listening");
  t.after(() => service.close());
  const opening = connectIosCapture(path, "00008150-000A00000000001E");
  await assert.rejects(opening, error => {
    assert.ok(error instanceof ExpectedOperationError);
    assert.equal(error.outcome, "device_unavailable");
    assert.equal(error.message, callInProgress);
    return true;
  });
});
