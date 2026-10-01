import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ServeEmu } from "../src/server/serve-emu.ts";

async function fixture(t: TestContext, devices: string, avds: string[] = []) {
  const directory = tmpdir();
  const prefix = join(directory, "mobile-dev-discovery-");
  const sdk = await mkdtemp(prefix);
  const previous = process.env.ANDROID_HOME;
  process.env.ANDROID_HOME = sdk;
  const backend = new ServeEmu();
  t.after(async () => {
    backend.dispose();
    if (previous === undefined) delete process.env.ANDROID_HOME;
    else process.env.ANDROID_HOME = previous;
    await rm(sdk, { recursive: true, force: true });
  });
  const platformTools = join(sdk, "platform-tools");
  const emulatorDirectory = join(sdk, "emulator");
  await mkdir(platformTools);
  await mkdir(emulatorDirectory);
  const devicesPath = join(sdk, "devices.txt");
  const callsPath = join(sdk, "calls.txt");
  await writeFile(devicesPath, devices);
  await writeFile(callsPath, "");
  const adb = join(platformTools, "adb");
  await writeFile(adb, `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
const line = JSON.stringify(args) + "\\n";
fs.appendFileSync(${JSON.stringify(callsPath)}, line);
if (args[0] === "devices") {
  const output = fs.readFileSync(${JSON.stringify(devicesPath)}, "utf8");
  process.stdout.write(output);
}
else if (args.join(" ") === "-s emulator-5554 emu avd name") console.log("RunningAVD\\nOK");
else process.exit(1);
`, { mode: 0o755 });
  const emulator = join(emulatorDirectory, "emulator");
  await writeFile(emulator, `#!${process.execPath}
const args = process.argv.slice(2);
const command = args.join(" ");
if (command !== "-list-avds") process.exit(1);
console.log(${JSON.stringify(avds.join("\n"))});
`, { mode: 0o755 });
  return {
    backend,
    async calls(): Promise<string[][]> {
      const output = await readFile(callsPath, "utf8");
      const trimmed = output.trim();
      const lines = trimmed.split("\n");
      return lines.map(line => JSON.parse(line));
    },
    async setDevices(devices: string) { await writeFile(devicesPath, devices); },
  };
}

test("Android discovery identifies USB, TCP, mDNS and IPv6 phones separately from AVDs", async t => {
  const lines = [
    "List of devices attached",
    "usb-phone device usb:337641472X product:pixel model:Pixel_9 device:tokay transport_id:1",
    "192.168.1.20:5555 device product:pixel model:Pixel_8 transport_id:2",
    "adb-wireless-phone-aBc123._adb-tls-connect._tcp device model:Pixel_Tablet transport_id:3",
    "[fe80::1234%en0]:5555 device model:Pixel_7 transport_id:4",
    "locked-phone unauthorized usb:337641473X transport_id:5",
    "offline-phone offline transport_id:6",
    "emulator-5554 device model:sdk_gphone64_arm64 transport_id:7",
    "same-name-phone device model:StoppedAVD transport_id:8",
    "adb-legacy-phone._adb._tcp device model:Pixel_6 transport_id:9",
  ];
  const output = lines.join("\r\n");
  const f = await fixture(t, output, ["RunningAVD", "StoppedAVD"]);
  const status = await f.backend.list();
  assert.equal(status.connected, true);
  const physical = status.devices.filter(device => device.kind === "physical");
  assert.equal(physical.length, 8);
  const transports = physical.map(device => device.transportType);
  assert.deepEqual(transports, ["wired", "localNetwork", "localNetwork", "localNetwork", "wired", "wired", "wired", "localNetwork"]);
  assert.equal(physical[0].name, "Pixel 9");
  assert.equal(physical[0].model, "Pixel 9");
  assert.equal(physical[4].state, "unauthorized");
  assert.equal(physical[5].state, "offline");
  const emulators = status.devices.filter(device => device.kind === "emulator");
  assert.deepEqual(emulators, [
    { udid: "emulator-5554", name: "RunningAVD", state: "Booted", runtime: "Android", platform: "android", kind: "emulator" },
    { udid: "avd:StoppedAVD", name: "StoppedAVD", state: "Shutdown", runtime: "Android", platform: "android", kind: "emulator" },
  ]);
  const calls = await f.calls();
  assert.deepEqual(calls, [["devices", "-l"], ["-s", "emulator-5554", "emu", "avd", "name"]]);
  await f.backend.boot("usb-phone");
  const unauthorizedBoot = f.backend.boot("locked-phone");
  await assert.rejects(unauthorizedBoot, /Reconnect and authorize/);
  const physicalShutdown = f.backend.shutdown("usb-phone");
  await assert.rejects(physicalShutdown, /Only Android emulators/);
  const laterCalls = await f.calls();
  const physicalActions = laterCalls.filter(args => args[0] === "-s" && args[1] !== "emulator-5554");
  assert.equal(physicalActions.length, 0);
  await f.setDevices("List of devices attached\n");
  const disconnected = await f.backend.list();
  const remainingPhysical = disconnected.devices.filter(device => device.kind === "physical");
  assert.equal(remainingPhysical.length, 0);
});
