import test from "node:test";
import assert from "node:assert/strict";
import { classifyProcessFailure, diagnosticContexts, diagnosticReportTags, diagnosticTags, errorDiagnostics } from "../src/error-diagnostics.ts";
import { setAndroidStartupDiagnostic } from "../src/android-startup-diagnostics.ts";
import { setDiscoveryCommandDiagnostic } from "../src/device-apps-command-diagnostics.ts";
import { deviceAppsDiagnostic, setDeviceAppsDiagnostic } from "../src/device-apps-diagnostics.ts";
import { annotateDeviceCommand, deviceCommandTags } from "../src/device-command-diagnostics.ts";
import { errorCategory, setErrorCategory } from "../src/error-reporting.ts";

test("process failures are read from error fields, with a timed run deciding deadlines", () => {
  assert.deepEqual(classifyProcessFailure({ killed: true, signal: "SIGTERM", code: null }), { termination: "deadline", signal: "SIGTERM" });
  assert.deepEqual(classifyProcessFailure({ killed: true, signal: "SIGTERM" }, { elapsed: 10, timeout: 1000 }), { termination: "signal", signal: "SIGTERM" });
  assert.deepEqual(classifyProcessFailure({ code: 2 }), { termination: "exit", status: 2 });
  assert.deepEqual(classifyProcessFailure({ code: -32001 }), { termination: "exit", status: -32001 });
  assert.deepEqual(classifyProcessFailure({ signal: "SIGUSR1" }), { termination: "signal", signal: "other" });
  assert.deepEqual(classifyProcessFailure({ code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" }), { termination: "output_limit" });
  assert.deepEqual(classifyProcessFailure({ code: "ENOENT" }), { termination: "missing_executable" });
  assert.deepEqual(classifyProcessFailure({ code: "EACCES" }), { termination: "system_error" });
  assert.deepEqual(classifyProcessFailure({ name: "ZodError" }), { termination: "invalid_response" });
  assert.deepEqual(classifyProcessFailure(new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } })), { termination: "connection_failed" });
  const timedOut = AbortSignal.abort(new DOMException("deadline", "TimeoutError"));
  assert.deepEqual(classifyProcessFailure({ name: "AbortError" }, { elapsed: 0, timeout: 1000, signal: timedOut }), { termination: "deadline" });
  assert.deepEqual(classifyProcessFailure({ name: "AbortError" }), { termination: "cancelled" });
  assert.deepEqual(classifyProcessFailure("failed"), { termination: "unknown" });
});

test("one error carries every diagnostic its layers record, and capture sites read them together", () => {
  const error = new Error("PRIVATE_SERIAL");
  assert.deepEqual(errorDiagnostics(error), {});
  annotateDeviceCommand(error, "adb_shell");
  setErrorCategory(error, "timeout");
  setDiscoveryCommandDiagnostic(error, { command: "android_packages", cause: "deadline_exceeded", termination: "deadline", elapsed_ms: 5001, deadline_ms: 5000, signal: "SIGTERM" });
  setDeviceAppsDiagnostic(error, deviceAppsDiagnostic(error, "running_apps", "android"));
  setAndroidStartupDiagnostic(error, { stage: "push-server", outcome: "timeout" }, {
    deviceKind: "physical", transport: "wired", stateBefore: "online", activeBackends: 0, stoppingBackends: 1, startingBackends: 0,
  });
  assert.equal(errorCategory(error), "timeout");
  assert.deepEqual(deviceCommandTags(error), { device_command_failure: "unknown", device_command: "adb_shell" });
  assert.deepEqual(diagnosticTags(error), {
    discovery_command: "android_packages", discovery_cause: "deadline_exceeded", discovery_termination: "deadline", discovery_signal: "SIGTERM",
    discovery_stage: "running_apps", discovery_failure: "timeout", device_platform: "android", device_kind: "unknown",
  });
  assert.deepEqual(diagnosticReportTags(error), {
    android_startup_stage: "push-server", android_startup_outcome: "timeout", android_device_state_before: "online",
    device_platform: "android", device_kind: "physical", android_transport: "wired", android_cleanup_overlap: "yes",
  });
  assert.deepEqual(diagnosticContexts(error), { device_apps_command: { elapsed_ms: 5001, deadline_ms: 5000, exit_status: undefined } });
  assert.deepEqual(diagnosticTags(new Error("plain")), {});
  assert.deepEqual(diagnosticReportTags("plain"), {});
  assert.equal(diagnosticContexts(new Error("plain")), undefined);
});
