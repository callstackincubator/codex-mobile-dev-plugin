import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { spawn } from "node:child_process";
import { bootAndroidEmulator, parseAvdName } from "../src/server/android-emulator.ts";

const status = { connected: true, managed: false, baseUrl: "", devices: [] };
function fakeLauncher(fail?: "spawn" | "exit") {
  const child = new EventEmitter() as EventEmitter & { unref: () => void };
  let unrefs = 0;
  const calls: unknown[][] = [];
  child.unref = () => { unrefs++; };
  const launch = ((...args: unknown[]) => {
    calls.push(args);
    queueMicrotask(() => {
      if (fail === "spawn") child.emit("error", new Error("ENOENT"));
      else { child.emit("spawn"); if (fail === "exit") child.emit("exit", 1, null); }
    });
    return child;
  }) as unknown as typeof spawn;
  return { child, launch, calls, get unrefs() { return unrefs; } };
}

test("AVD console parsing ignores OK and rejects error replies", () => {
  assert.equal(parseAvdName("\r\n  Pixel_8  \r\nOK\r\n"), "Pixel_8");
  for (const value of [undefined, "", "OK\n", "KO\n", "KO: unknown command\n", "Pixel_8\nKO: console failed\n"]) assert.equal(parseAvdName(value), undefined);
});

test("emulator boot launches headlessly and leaves the process running after readiness", async () => {
  const fake = fakeLauncher(); const controller = new AbortController();
  const result = await bootAndroidEmulator({ name: "Pixel_8", executable: "/sdk/emulator", signal: controller.signal, ready: async () => status }, fake.launch);
  assert.equal(result, status); assert.equal(fake.unrefs, 1);
  assert.deepEqual(fake.calls[0], ["/sdk/emulator", ["-avd", "Pixel_8", "-no-window", "-no-boot-anim", "-gpu", "host"], { detached: true, stdio: "ignore", shell: false }]);
  controller.abort();
});

test("an emulator spawn error fails before adb polling", async () => {
  const fake = fakeLauncher("spawn"); let polls = 0;
  await assert.rejects(bootAndroidEmulator({ name: "Pixel_8", executable: "missing", signal: new AbortController().signal, ready: async () => { polls++; return status; } }, fake.launch), /Cannot start Android emulator.*ENOENT/);
  assert.equal(polls, 0);
});

test("an early emulator exit interrupts an in-flight adb check", async () => {
  const fake = fakeLauncher(); let release!: () => void;
  const polling = new Promise<void>(resolve => { release = resolve; });
  const result = bootAndroidEmulator({ name: "Pixel_8", executable: "emulator", signal: new AbortController().signal, ready: async () => { release(); return new Promise<undefined>(() => {}); } }, fake.launch);
  await polling; fake.child.emit("exit", 1, null);
  await assert.rejects(result, /exited before booting.*code=1/);
});

test("closing the plugin interrupts boot polling without killing the emulator", async () => {
  const fake = fakeLauncher(); const controller = new AbortController(); let release!: () => void;
  const polling = new Promise<void>(resolve => { release = resolve; });
  const result = bootAndroidEmulator({ name: "Pixel_8", executable: "emulator", signal: controller.signal, ready: async () => { release(); return new Promise<undefined>(() => {}); } }, fake.launch);
  await polling; controller.abort();
  await assert.rejects(result, /plugin server closed/);
  assert.equal(fake.unrefs, 1);
});

test("the boot deadline interrupts an adb check that never resolves", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const fake = fakeLauncher(); let release!: () => void;
  const polling = new Promise<void>(resolve => { release = resolve; });
  const result = bootAndroidEmulator({ name: "Pixel_8", executable: "emulator", signal: new AbortController().signal, ready: async () => { release(); return new Promise<undefined>(() => {}); } }, fake.launch);
  await polling;
  t.mock.timers.tick(120000);
  await assert.rejects(result, /did not finish booting within two minutes/);
});
