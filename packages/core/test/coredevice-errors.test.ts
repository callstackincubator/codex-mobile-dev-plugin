import test from "node:test";
import assert from "node:assert/strict";
import { ExpectedOperationError } from "@mobile-dev/shared/error-reporting.ts";
import { errorHint, errorMessage } from "@mobile-dev/shared/protocol.ts";
import { coreDeviceLaunchCode, rewriteCoreDeviceHint } from "../src/coredevice-errors.ts";
import { withAgentDeviceHint } from "../src/ios-signing.ts";
import { physicalIosError } from "../src/testing-prepare.ts";

const GENERIC = "Ensure the iOS device is unlocked, trusted, and available in Xcode > Devices, then retry.";
const system = `Failed to launch iOS app: The application failed to launch. (com.apple.dt.CoreDeviceError error 10002 (0x2712)) Hint: ${GENERIC}`;
const raced = `open com.example.app failed: Failed to launch iOS app: The process identifier of the launched application could not be determined. It may have already terminated. (com.apple.dt.CoreDeviceError error 10004 (0x2714)) Hint: ${GENERIC}`;

test("only 10002 and 10004 are recognised", () => {
  assert.equal(coreDeviceLaunchCode(system), "10002");
  assert.equal(coreDeviceLaunchCode(raced), "10004");
  assert.equal(coreDeviceLaunchCode("CoreDeviceError error 1234"), undefined);
});

test("the unlock-and-trust hint is dropped for the codes it does not explain, and kept for others", () => {
  const apple = rewriteCoreDeviceHint(system, "com.apple.Preferences");
  assert.doesNotMatch(apple, /unlocked, trusted/);
  assert.match(apple, /Apple app/);
  assert.match(rewriteCoreDeviceHint(system, "com.example.app"), /developer profile is trusted/);
  const race = rewriteCoreDeviceHint(raced, "com.example.app");
  assert.doesNotMatch(race, /unlocked, trusted/);
  assert.match(race, /wait a moment and try again/);
  const other = `Failed to list iOS apps (CoreDeviceError error 1234) Hint: ${GENERIC}`;
  assert.equal(rewriteCoreDeviceHint(other), other, "a failure this does not explain keeps its hint");
  assert.equal(rewriteCoreDeviceHint("Developer Mode is disabled. CoreDeviceError error 10002"), "Developer Mode is disabled. CoreDeviceError error 10002");
});

test("agent-device launch failures reach the panel with an accurate hint, and 10004 stays a reported error", () => {
  const failure = (stderr: string, appBundleId: string) => Object.assign(new Error("Failed to launch iOS app"), { details: { stderr, appBundleId, hint: GENERIC } });
  const apple = withAgentDeviceHint(failure("The application failed to launch. (com.apple.dt.CoreDeviceError error 10002 (0x2712))", "com.apple.mobilesafari"), errorHint, errorMessage) as Error;
  assert.ok(apple instanceof ExpectedOperationError);
  assert.doesNotMatch(apple.message, /unlocked, trusted/);
  const race = withAgentDeviceHint(failure("could not be determined (com.apple.dt.CoreDeviceError error 10004 (0x2714))", "com.example.app"), errorHint, errorMessage) as Error;
  assert.ok(!(race instanceof ExpectedOperationError), "a launch racing the app's shutdown is still worth knowing about");
  assert.match(race.message, /wait a moment and try again/);
  const locked = Object.assign(new Error("Failed to launch iOS app"), { details: { reason: "device_locked", stderr: "CoreDeviceError error 10002", hint: GENERIC } });
  assert.match((withAgentDeviceHint(locked, errorHint, errorMessage) as Error).message, /unlocked, trusted/, "a classified lock keeps its own hint");
});

test("our own devicectl launch explains 10002 and 10004 without blaming unlock or trust", () => {
  const launch = (stderr: string, appId: string) => physicalIosError(Object.assign(new Error("Command failed"), { stderr }), "Opening the app", appId);
  const refused = launch("ERROR: The application failed to launch. (com.apple.dt.CoreDeviceError error 10002 (0x2712))", "com.apple.Preferences");
  assert.ok(refused instanceof ExpectedOperationError);
  assert.match(refused.message, /Apple app/);
  assert.doesNotMatch(refused.message, /unlocked, trusted/);
  const race = launch("ERROR: could not be determined. (com.apple.dt.CoreDeviceError error 10004 (0x2714))", "com.example.app");
  assert.ok(!(race instanceof ExpectedOperationError));
  assert.match(race.message, /try again/);
  assert.match(launch("The device is locked. (CoreDeviceError error 10002)", "com.example.app").message, /locked\. Unlock it/, "a real lock is still named");
});
