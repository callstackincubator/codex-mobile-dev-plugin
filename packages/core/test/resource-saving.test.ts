import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ResourceSaving, IOS_RESOURCE_SAVING_EXCEPT, ANDROID_RESOURCE_SAVING_SKIP } from "../src/resource-saving.ts";

const ios = { platform: "ios" as const, id: "B5C969F6-58A4-4C31-AB12-FB9E56D681DE", key: "B5C969F6-58A4-4C31-AB12-FB9E56D681DE", state: "Booted" };
const android = { platform: "android" as const, id: "emulator-5554", key: "Pixel_8", state: "Booted" };

async function fixture(t: test.TestContext) {
  const root = tmpdir();
  const prefix = join(root, "resource-saving-test-");
  const directory = await mkdtemp(prefix);
  t.after(() => rm(directory, { recursive: true, force: true }));
  const calls: { file: string; args: string[]; env?: NodeJS.ProcessEnv }[] = [];
  let managedDisabled = 0;
  let fail = false;
  let guest: { disabled_packages: string[]; settings: Record<string, string | null> } | null = null;
  let disabled = ["package:com.example.alreadydisabled"];
  const saving = new ResourceSaving({
    directory, executable: async platform => `/runtime/${platform}`, adb: async () => "/sdk/platform-tools/adb",
    run: async (file, args, options) => {
      calls.push({ file, args, env: options.env });
      if (fail) throw new Error("Optimizer failed with private device details.");
      if (args[0] === "status") return { stdout: JSON.stringify({ managedDisabled }) };
      if (args[3]?.startsWith("if [ -f")) return { stdout: JSON.stringify(guest) };
      if (file === "/sdk/platform-tools/adb") return { stdout: disabled.join("\n") };
      if (file === "/runtime/android" && args[0] === "on") {
        guest = { disabled_packages: ["com.google.android.feedback"], settings: {} };
        disabled.push("package:com.google.android.feedback");
      }
      if (file === "/runtime/android" && args[0] === "off") { guest = null; disabled = ["package:com.example.alreadydisabled"]; }
      return { stdout: "{}" };
    },
  });
  return { saving, directory, calls, setDisabled(value: number) { managedDisabled = value; }, fail() { fail = true; } };
}

test("resource saving defaults on and persists opt-outs by stable device identity without touching a device", async t => {
  const f = await fixture(t);
  const initial = await f.saving.state(ios);
  assert.deepEqual(initial, { enabled: true, running: true, restartRequired: true });
  await f.saving.set(android, false);
  const restarted = new ResourceSaving({ directory: f.directory });
  const otherSerial = { ...android, id: "emulator-5560" };
  const enabled = await restarted.enabled(otherSerial);
  assert.equal(enabled, false);
  const other = await restarted.enabled({ ...android, key: "Pixel_9" });
  assert.equal(other, true);
  assert.equal(f.calls.length, 0);
  const files = await readdir(f.directory);
  const filename = join(f.directory, files[0]);
  await writeFile(filename, "invalid");
  const malformed = restarted.enabled(android);
  await assert.rejects(malformed, /JSON/);
});

test("iOS slimming preserves required features, verifies the profile, and never silently succeeds on failure", async t => {
  const f = await fixture(t);
  await f.saving.apply(ios);
  const args = f.calls.map(call => call.args);
  assert.deepEqual(args, [
    ["on", ios.id, "--no-reboot", "--except", IOS_RESOURCE_SAVING_EXCEPT],
    ["verify", ios.id, "--except", IOS_RESOURCE_SAVING_EXCEPT, "--json"],
  ]);
  const state = await f.saving.state(ios);
  assert.equal(state.restartRequired, false);
  await f.saving.set(ios, false);
  const changed = await f.saving.state(ios);
  assert.equal(changed.restartRequired, true);
  assert.equal(f.calls.length, 2, "saving a toggle never restarts a running device");
  f.saving.forget(ios);
  await f.saving.set(ios, true);
  f.fail();
  const operation = f.saving.apply(ios);
  await assert.rejects(operation, /Optimizer failed/);
  const failed = await f.saving.state(ios);
  assert.equal(failed.restartRequired, true);
});

test("iOS restoration only invokes off when there are disabled services", async t => {
  const f = await fixture(t);
  await f.saving.set(ios, false);
  await f.saving.apply(ios);
  const commands = f.calls.map(call => call.args[0]);
  assert.deepEqual(commands, ["status"]);
  f.setDisabled(3);
  await f.saving.apply(ios);
  const last = f.calls.at(-1);
  assert.deepEqual(last?.args, ["off", ios.id]);
});

test("Android preserves pre-disabled packages and app-facing settings, isolates CLI defaults, and restores only recorded changes", async t => {
  const f = await fixture(t);
  await f.saving.apply(android);
  const on = f.calls.find(call => call.file === "/runtime/android");
  assert.equal(on?.args.includes(`--skip=${ANDROID_RESOURCE_SAVING_SKIP}`), true);
  assert.equal(on?.args.includes("--keep=com.example.alreadydisabled"), true);
  assert.equal(on?.args.includes("--keep=com.android.traceur"), true);
  assert.equal(on?.env?.ANDROID_HOME, "/sdk");
  assert.equal(on?.env?.HOME?.endsWith("avdslim-home"), true);
  assert.equal(on?.env?.ANDROID_USER_HOME?.endsWith(".android"), true);
  assert.equal(on?.env?.ADB_VENDOR_KEYS?.endsWith("adbkey"), true);
  await f.saving.set(android, false);
  await f.saving.apply(android);
  const off = f.calls.filter(call => call.file === "/runtime/android" && call.args[0] === "off");
  assert.equal(off.length, 1);
  await f.saving.apply(android);
  const allOff = f.calls.filter(call => call.file === "/runtime/android" && call.args[0] === "off");
  assert.equal(allOff.length, 1, "an emulator without a record never uses the upstream broad restore path");
});
