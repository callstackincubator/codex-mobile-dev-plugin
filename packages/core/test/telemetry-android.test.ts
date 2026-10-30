import test from "node:test";
import assert from "node:assert/strict";
import { scrubErrorEvent, scrubMetric } from "@mobile-dev/shared/telemetry.ts";
import { setAndroidStartupDiagnostic } from "@mobile-dev/shared/android-startup-diagnostics.ts";
import { captureServerError, recordAndroidBackendStartup, recordAndroidBackendStop, recordAndroidBootWait, recordAndroidStartupContext, recordAndroidStartupDeviceState, recordAndroidStartupStages } from "../src/telemetry.ts";
import { assertFragment, captureSentry } from "@mobile-dev/test-support/sentry.ts";

test("Android backend startup metrics retain product attribution and honor opt-out", async t => {
  const sentry = captureSentry(t, { beforeSendMetric: scrubMetric });
  recordAndroidBackendStartup(150, "ready");
  recordAndroidBackendStartup(300, "failed");
  recordAndroidBootWait(4200, "booted");
  recordAndroidBootWait(120000, "timeout");
  const sent = await sentry.text();
  for (const fragment of ["android.backend.startup.samples", "android.backend.startup.duration", "android.backend.boot_wait.samples", "android.backend.boot_wait.duration", "millisecond", '"surface":{"value":"simulator"', '"device_platform":{"value":"android"', '"outcome":{"value":"ready"', '"outcome":{"value":"failed"', '"outcome":{"value":"booted"', '"outcome":{"value":"timeout"']) {
    assertFragment(sent, fragment);
  }
  sentry.setTelemetry("off");
  recordAndroidBackendStartup(999, "failed");
  recordAndroidBootWait(999, "timeout");
  const afterOptOut = await sentry.text();
  assert.equal(afterOptOut, sent);
});

test("Android startup diagnostics retain stage, device state and anonymous error attribution without private content", async t => {
  const sentry = captureSentry(t, {
    environment: "release", release: "mobile-dev@test", beforeSend: scrubErrorEvent, beforeSendMetric: scrubMetric,
    initialScope: { user: { id: "anon_0123456789abcdef0123456789abcdef" }, tags: { telemetry_session: "run_0123456789abcdef0123456789abcdef", device_platform: "ios", device_kind: "simulator" } },
  });
  const context = { deviceKind: "physical", transport: "localNetwork", stateBefore: "online", activeBackends: 2, stoppingBackends: 1, startingBackends: 1 } as const;
  const failure = { stage: "socket-poll", outcome: "timeout" } as const;
  recordAndroidStartupContext(context);
  recordAndroidStartupStages({
    type: "mobile-dev/android-startup-complete", outcome: "failed", failedStage: failure.stage, failure: failure.outcome,
    stages: [{ stage: "socket-poll", samples: 2, totalMs: 2200, maxMs: 2000, timedSamples: 2, spawnedSamples: 2, queueMs: 20, executionMs: 2180, outcomes: { ok: 1, timeout: 1 } }],
  }, context);
  recordAndroidStartupDeviceState("offline", 5, context, failure);
  recordAndroidBackendStop(80, context);
  const error = new Error("Android backend startup failed");
  setAndroidStartupDiagnostic(error, failure, context);
  captureServerError(error, "android.tool");
  const sent = await sentry.text();
  for (const name of ["stage.mean", "stage.max", "stage.outcomes", "queue.mean", "execution.mean", "execution.spawned", "device_state.samples", "active_backends", "stopping_backends", "in_flight"]) assertFragment(sent, `android.backend.startup.${name}`);
  assertFragment(sent, "android.backend.process_shutdown.duration");
  assertFragment(sent, "android_startup_stage");
  assertFragment(sent, "socket-poll");
  assertFragment(sent, "android_device_state_after");
  assertFragment(sent, "offline");
  assertFragment(sent, '"device_platform":"android"');
  assertFragment(sent, '"device_kind":"physical"');
  assertFragment(sent, "anon_0123456789abcdef0123456789abcdef");
  assertFragment(sent, "mobile-dev@test");
  sentry.setTelemetry("off");
  recordAndroidStartupContext(context);
  recordAndroidStartupDeviceState("offline", 5, context, failure);
  recordAndroidBackendStop(80, context);
  recordAndroidStartupStages({ type: "mobile-dev/android-startup-complete", outcome: "ready", stages: [] }, context);
  const afterOptOut = await sentry.text();
  assert.equal(afterOptOut, sent);
});
