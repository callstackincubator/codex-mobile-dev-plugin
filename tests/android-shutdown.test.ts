import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ServeEmu } from "../src/server/serve-emu.ts";

test("shutdown waits for adb removal, preserves the AVD name, and tolerates a repeat stop", async t => {
  const sdk = await mkdtemp(join(tmpdir(), "mobile-dev-shutdown-"));
  const previous = process.env.ANDROID_HOME;
  process.env.ANDROID_HOME = sdk;
  const backend = new ServeEmu();
  t.after(async () => { backend.dispose(); if (previous === undefined) delete process.env.ANDROID_HOME; else process.env.ANDROID_HOME = previous; await rm(sdk, { recursive: true, force: true }); });
  await mkdir(join(sdk, "platform-tools"));
  await mkdir(join(sdk, "emulator"));
  const statePath = join(sdk, "state.json");
  await writeFile(statePath, JSON.stringify({ phase: "running", polls: 0, kills: 0 }));
  await writeFile(join(sdk, "platform-tools/adb"), `#!${process.execPath}
const fs = require("node:fs");
const path = ${JSON.stringify(statePath)};
const state = JSON.parse(fs.readFileSync(path, "utf8"));
const args = process.argv.slice(2);
if (args[0] === "devices") {
  if (state.phase === "stopping") { state.polls++; if (state.polls > 1) state.phase = "stopped"; }
  console.log("List of devices attached");
  if (state.phase !== "stopped") console.log("emulator-5554 device model:sdk_gphone64_arm64");
} else if (args.at(-1) === "name") console.log(state.phase === "running" ? "Medium_Phone\\nOK" : "KO: shutting down");
else if (args.at(-1) === "kill") { state.phase = "stopping"; state.kills++; }
else process.exit(1);
fs.writeFileSync(path, JSON.stringify(state));
`, { mode: 0o755 });
  await writeFile(join(sdk, "emulator/emulator"), `#!${process.execPath}\nconsole.log("Medium_Phone");\n`, { mode: 0o755 });
  const running = await backend.list();
  assert.equal(running.devices.length, 1);
  assert.equal(running.devices[0].name, "Medium_Phone");
  const stopped = await backend.shutdown("emulator-5554");
  assert.deepEqual(stopped.devices, [{ udid: "avd:Medium_Phone", name: "Medium_Phone", state: "Shutdown", runtime: "Android", platform: "android" }]);
  assert.deepEqual((await backend.shutdown("emulator-5554")).devices, stopped.devices);
  const state = JSON.parse(await readFile(statePath, "utf8"));
  assert.equal(state.kills, 1);
  assert.equal(state.polls, 2);
  await assert.rejects(backend.shutdown("physical-device"), /Only Android emulators/);
});
