import test from "node:test";
import assert from "node:assert/strict";
import { annotateDeviceAppsError, deviceAppsDiagnostic, deviceAppsDiagnosticSchema, getDeviceAppsDiagnostic, withDeviceAppsDiagnostic } from "../src/device-apps-diagnostics.ts";

test("discovery classification preserves original errors and never derives telemetry from their text", async () => {
  const missing = new Error("PRIVATE_COMMAND PRIVATE_PATH PRIVATE_DEVICE");
  Object.assign(missing, { code: "ENOENT", spawnargs: ["PRIVATE_ARGUMENT"], stderr: "PRIVATE_OUTPUT" });
  const annotated = annotateDeviceAppsError(missing, "foreground", "ios", "physical");
  assert.equal(annotated, missing);
  const outer = annotateDeviceAppsError(annotated, "discovery", "ios", "physical");
  assert.equal(outer, missing);
  const diagnostic = getDeviceAppsDiagnostic(outer);
  assert.deepEqual(diagnostic, { stage: "foreground", failure: "missing_executable", platform: "ios", kind: "physical" });
  const encoded = JSON.stringify(diagnostic);
  const includesPrivate = encoded.includes("PRIVATE");
  assert.equal(includesPrivate, false);
  const cases = [
    { error: { code: "ETIMEDOUT" }, expected: "timeout" },
    { error: { code: -32001 }, expected: "timeout" },
    { error: { killed: true, signal: "SIGTERM" }, expected: "timeout" },
    { error: { code: 1 }, expected: "command_failed" },
    { error: { signal: "SIGABRT" }, expected: "command_failed" },
    { error: { name: "ZodError" }, expected: "invalid_response" },
    { error: new SyntaxError("PRIVATE_OUTPUT"), expected: "invalid_response" },
    { error: { name: "AbortError", code: "ETIMEDOUT" }, expected: "cancelled" },
    { error: new Error("ENOENT timeout PRIVATE_OUTPUT"), expected: "unknown" },
  ];
  for (const entry of cases) {
    const diagnostic = deviceAppsDiagnostic(entry.error, "running_apps", "android");
    assert.equal(diagnostic.failure, entry.expected);
    assert.equal(diagnostic.kind, "unknown");
  }
  const aborted = new Error("cancelled");
  aborted.name = "AbortError";
  const pending = withDeviceAppsDiagnostic(async () => { throw aborted; }, "running_apps", "ios");
  await assert.rejects(pending, error => error === aborted);
});

test("diagnostic metadata rejects unknown values and extra fields rather than forwarding payloads", () => {
  const diagnostic = { stage: "foreground", failure: "timeout", platform: "ios", kind: "physical" };
  for (const invalid of [{ ...diagnostic, stage: "PRIVATE_PATH" }, { ...diagnostic, failure: "PRIVATE_OUTPUT" },
    { ...diagnostic, platform: "PRIVATE_DEVICE" }, { ...diagnostic, kind: "PRIVATE_DEVICE" }, { ...diagnostic, command: "PRIVATE_COMMAND" }]) {
    const parsed = deviceAppsDiagnosticSchema.safeParse(invalid);
    assert.equal(parsed.success, false);
  }
});
