import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { annotateDeviceCommand, backendCommand, classifyCommandFailure, deviceCommandTags } from "../src/device-command-diagnostics.ts";

test("command failures are classified from codes, statuses and types, never from their text", () => {
  const fetchFailure = new TypeError("fetch failed PRIVATE_URL", { cause: Object.assign(new Error("PRIVATE_ADDRESS"), { code: "ECONNREFUSED" }) });
  const cases: [unknown, ReturnType<typeof classifyCommandFailure>][] = [
    [{ code: 1, stderr: "PRIVATE_OUTPUT" }, { failure: "exit", status: 1 }],
    [{ code: 300 }, { failure: "exit" }],
    [{ signal: "SIGSEGV" }, { failure: "signal", signal: "SIGSEGV" }],
    [{ signal: "PRIVATE_SIGNAL" }, { failure: "signal", signal: "other" }],
    [{ killed: true, signal: "SIGTERM", code: null }, { failure: "deadline" }],
    [{ code: "ETIMEDOUT" }, { failure: "deadline" }],
    [new DOMException("PRIVATE", "TimeoutError"), { failure: "deadline" }],
    [new DOMException("PRIVATE", "AbortError"), { failure: "cancelled" }],
    [{ code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", killed: true }, { failure: "output_limit" }],
    [{ code: "ENOENT" }, { failure: "missing_executable" }],
    [{ code: "EACCES" }, { failure: "system_error" }],
    [z.object({ ok: z.boolean() }).safeParse({}).error, { failure: "invalid_response" }],
    [new SyntaxError("PRIVATE_REPLY"), { failure: "invalid_response" }],
    [fetchFailure, { failure: "connection_failed" }],
    [new TypeError("PRIVATE_BUG"), { failure: "unknown" }],
    [new Error("device offline PRIVATE"), { failure: "unknown" }],
    ["PRIVATE_STRING", { failure: "unknown" }],
  ];
  for (const [error, expected] of cases) assert.deepEqual(classifyCommandFailure(error), expected, JSON.stringify(error));
});

test("the innermost command label wins and tags keep only labels that code chose", () => {
  const error = annotateDeviceCommand(Object.assign(new Error("PRIVATE_OUTPUT"), { code: 2 }), "simctl_launch");
  annotateDeviceCommand(error, "baguette_start");
  assert.deepEqual(deviceCommandTags(error), { device_command: "simctl_launch", device_command_failure: "exit", device_command_status: "2" });
  const killed = annotateDeviceCommand({ signal: "SIGKILL" }, "adb_shell_am");
  assert.deepEqual(deviceCommandTags(killed), { device_command: "adb_shell_am", device_command_failure: "signal", device_command_signal: "SIGKILL" });
  for (const label of ["com.private.app", "emulator-5554", "simctl_B5C969F6", "/Users/private"]) {
    assert.equal(deviceCommandTags(annotateDeviceCommand(new Error(), label)).device_command, "other");
  }
  assert.deepEqual(deviceCommandTags(new SyntaxError("PRIVATE_REPLY")), { device_command_failure: "invalid_response" }, "an unnamed failure still says how it failed");
  assert.equal(annotateDeviceCommand("PRIVATE_STRING", "simctl_launch"), "PRIVATE_STRING");
});

test("backend routes and commands are labeled without device IDs or arguments", () => {
  assert.equal(backendCommand("baguette", "/simulators/B5C969F6-58A4-4C31-AB12-FB9E56D681DE/interface.json"), "baguette_interface");
  assert.equal(backendCommand("baguette", "/simulators/B5C969F6-58A4-4C31-AB12-FB9E56D681DE/status-bar"), "baguette_status_bar");
  assert.equal(backendCommand("baguette", "/simulators.json"), "baguette_simulators");
  assert.equal(backendCommand("serve_emu", "/api/night-mode"), "serve_emu_night_mode");
});
