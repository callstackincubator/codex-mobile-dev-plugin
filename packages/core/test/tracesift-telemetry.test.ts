import assert from "node:assert/strict";
import test from "node:test";
import { scrubMetric } from "@mobile-dev/shared/telemetry.ts";
import { recordTraceSiftOperation, recordTraceSiftPayload } from "../src/telemetry.ts";
import { captureSentry } from "@mobile-dev/test-support/sentry.ts";

test("TraceSift operation metrics retain only bounded product attribution", async t => {
  const sentry = captureSentry(t, { telemetry: "on", beforeSendMetric: scrubMetric });
  recordTraceSiftOperation("ready", "success", 20);
  recordTraceSiftOperation("analyze", "success", 400);
  recordTraceSiftOperation("remember", "success", 2);
  recordTraceSiftOperation("restore", "success", 4);
  recordTraceSiftOperation("handoff", "failed", 10);
  recordTraceSiftPayload("task", 4_000_000);
  recordTraceSiftPayload("react", 1_500_000);
  const sent = await sentry.text();
  for (const fragment of ["tracesift.operation.samples", "tracesift.operation.duration", "millisecond", "tracesift.explore.payload_bytes", '"byte"', '"surface":{"value":"tracesift"', '"operation":{"value":"ready"', '"operation":{"value":"analyze"', '"operation":{"value":"remember"', '"operation":{"value":"restore"', '"operation":{"value":"handoff"', '"outcome":{"value":"success"', '"outcome":{"value":"failed"', '"kind":{"value":"task"', '"kind":{"value":"react"']) assert.ok(sent.includes(fragment), `Missing telemetry: ${fragment}`);
  for (const fragment of ["PRIVATE_PROFILE_PATH", "PRIVATE_CARD_ID", "PRIVATE_HANDOFF", "analysisId", "cardId", "token", "baseUrl", "pid", "user.id", "telemetry_session"]) assert.equal(sent.includes(fragment), false, `Private TraceSift data reached telemetry: ${fragment}`);
  sentry.setTelemetry("off");
  recordTraceSiftOperation("analyze", "failed", 999);
  recordTraceSiftPayload("task", 8_000_000);
  recordTraceSiftPayload("react", 3_000_000);
  assert.equal(await sentry.text(), sent);
});
