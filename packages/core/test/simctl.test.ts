import test from "node:test";
import assert from "node:assert/strict";
import { parseSimulatorList, Simctl, simulatorRuntimeName } from "../src/simctl.ts";
import { SimulatorUnavailableError } from "../src/simulator-unavailable.ts";
import { OTHER_UDID, UDID } from "../../test-support/fixtures.ts";

const listing = JSON.stringify({ devices: {
  "com.apple.CoreSimulator.SimRuntime.iOS-26-0": [
    { udid: OTHER_UDID, name: "iPhone 17", state: "Shutdown", isAvailable: true },
    { udid: "C0FFEE00-0000-4000-8000-000000000000", name: "Broken", state: "Shutdown", isAvailable: false },
  ],
  "com.apple.CoreSimulator.SimRuntime.iOS-27-0-1": [{ udid: UDID, name: "iPhone 18 Pro", state: "Booted", isAvailable: true }],
} });

test("simctl's listing reads as Baguette's: available simulators, booted first, with readable runtimes", () => {
  assert.equal(simulatorRuntimeName("com.apple.CoreSimulator.SimRuntime.watchOS-11-2"), "watchOS 11.2");
  assert.equal(simulatorRuntimeName("custom"), "custom");
  assert.deepEqual(parseSimulatorList(listing), [
    { udid: UDID, name: "iPhone 18 Pro", state: "Booted", runtime: "iOS 27.0.1" },
    { udid: OTHER_UDID, name: "iPhone 17", state: "Shutdown", runtime: "iOS 26.0" },
  ]);
});

test("simctl finds a simulator by UDID and requires a booted one where asked", async () => {
  const calls: string[][] = [];
  const simulators = new Simctl(async args => { calls.push(args); return listing; });
  assert.equal((await simulators.device(UDID, true)).name, "iPhone 18 Pro");
  assert.deepEqual(calls[0], ["simctl", "list", "devices", "--json"]);
  await assert.rejects(simulators.device(OTHER_UDID, true), (error: Error) => error instanceof SimulatorUnavailableError && /Boot it first/.test(error.message));
  await assert.rejects(simulators.device("D1D1D1D1-0000-4000-8000-000000000000"), SimulatorUnavailableError);
  await assert.rejects(simulators.device("not a udid"));
});

test("a missing Xcode reports why simulators cannot be listed", async () => {
  const simulators = new Simctl(async () => { throw new Error("xcrun: error: unable to find utility \"simctl\""); });
  const status = await simulators.list();
  assert.equal(status.connected, false);
  assert.match(status.error ?? "", /Install Xcode/);
  await assert.rejects(simulators.device(UDID), /Install Xcode/);
});
