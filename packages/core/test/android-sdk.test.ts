import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { androidSdkRoots, androidToolPath, sdkToolPath } from "../src/android-sdk.ts";
import { systemCommands } from "../src/app-control/commands.ts";

test("Windows resolves SDK executables outside PATH and passes spaced directories to child runtimes", { skip: process.platform !== "win32" }, async t => {
  const profile = await mkdtemp(join(tmpdir(), "mobile sdk "));
  const root = join(profile, "Android", "Sdk");
  const previous = { ANDROID_HOME: process.env.ANDROID_HOME, ANDROID_SDK_ROOT: process.env.ANDROID_SDK_ROOT, LOCALAPPDATA: process.env.LOCALAPPDATA };
  t.after(async () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(profile, { recursive: true, force: true });
  });
  delete process.env.ANDROID_HOME;
  delete process.env.ANDROID_SDK_ROOT;
  process.env.LOCALAPPDATA = profile;
  for (const [directory, name] of [["platform-tools", "adb"], ["emulator", "emulator"], ["build-tools/35", "aapt2"]]) {
    await mkdir(join(root, directory), { recursive: true });
    await writeFile(join(root, directory, name + ".exe"), "");
  }
  const adb = await sdkToolPath("adb");
  const emulator = await sdkToolPath("emulator");
  assert.equal(adb, join(root, "platform-tools", "adb.exe"));
  assert.equal(emulator, join(root, "emulator", "emulator.exe"));
  assert.equal(await systemCommands.aapt2(), join(root, "build-tools/35/aapt2.exe"));
  const userPath = "C:\\User Tools;C:\\Windows\\System32";
  assert.equal(androidToolPath([adb, emulator], userPath), [join(root, "platform-tools"), join(root, "emulator"), userPath].join(delimiter));
  assert.equal(androidToolPath(["adb.exe"], userPath), userPath);
  process.env.ANDROID_HOME = join(profile, "custom");
  assert.equal(androidSdkRoots()[0], process.env.ANDROID_HOME);
});
