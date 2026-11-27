import test from "node:test";
import assert from "node:assert/strict";
import { isHardwareUdid, settlePhysicalIos } from "../src/physical-ios-settle.ts";

const processes = (...executables: string[]) => ({ stdout: JSON.stringify({ result: { runningProcesses: executables.map((executable, index) => ({ processIdentifier: index + 1, executable })) } }) });

test("hardware UDIDs are told apart from simulator UUIDs", () => {
  assert.equal(isHardwareUdid("00008150-000A5C3421B8C01C"), true);
  assert.equal(isHardwareUdid("ED794517-E3AE-49DB-A8E9-E47F49119A96"), false);
  assert.equal(isHardwareUdid("emulator-5554"), false);
});

test("settling waits until the recorder's runner has left the phone, then one grace period", async () => {
  let clock = 0;
  const answers = [
    processes("file:///private/var/containers/Bundle/Application/X/AgentDeviceRunnerUITests-Runner.app/AgentDeviceRunnerUITests-Runner", "file:///var/App.app/App"),
    processes("file:///private/var/containers/Bundle/Application/X/AgentDeviceRunnerUITests-Runner.app/AgentDeviceRunnerUITests-Runner"),
    processes("file:///var/App.app/App"),
  ];
  const sleeps: number[] = [];
  await settlePhysicalIos("00008150-000A5C3421B8C01C", async (file, args) => {
    assert.equal(file, "/usr/bin/xcrun");
    assert.deepEqual(args.slice(0, 4), ["devicectl", "device", "info", "processes"]);
    return answers.shift()!;
  }, async ms => { sleeps.push(ms); clock += ms; }, () => clock);
  assert.equal(answers.length, 0);
  assert.deepEqual(sleeps, [500, 500, 750]);
});

test("a runner that never leaves does not hold the run past the bound", async () => {
  let clock = 0, polls = 0;
  await settlePhysicalIos("00008150-000A5C3421B8C01C", async () => { polls += 1; return processes("file:///x/AgentDeviceRunnerUITests-Runner.app/AgentDeviceRunnerUITests-Runner"); },
    async ms => { clock += ms; }, () => clock);
  assert.ok(clock >= 10_000 && clock <= 11_000, `waited ${clock}ms`);
  assert.ok(polls > 1);
});

test("a phone that cannot list processes is not waited on", async () => {
  let polls = 0;
  await settlePhysicalIos("00008150-000A5C3421B8C01C", async () => { polls += 1; throw new Error("unreachable"); }, async () => assert.fail("no sleeping"), () => 0);
  assert.equal(polls, 1);
});
