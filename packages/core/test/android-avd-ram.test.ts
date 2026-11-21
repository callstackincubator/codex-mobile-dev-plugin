import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { windowsAvdRamMiB } from "../src/android-avd-ram.ts";

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "mobile-dev avd "));
  const registry = join(root, "avd");
  const device = join(root, "relocated phone.avd");
  const original = process.env.ANDROID_AVD_HOME;
  process.env.ANDROID_AVD_HOME = registry;
  t.after(async () => {
    if (original === undefined) delete process.env.ANDROID_AVD_HOME;
    else process.env.ANDROID_AVD_HOME = original;
    await rm(root, { force: true, recursive: true });
  });
  await Promise.all([mkdir(registry), mkdir(device)]);
  const descriptor = join(registry, "my_phone.ini");
  await writeFile(descriptor, `path=${device}\r\n`);
  const config = {
    "image.sysdir.1": "system-images\\android-36\\google_apis\\x86_64\\",
    "hw.device.name": "pixel_8",
    "hw.ramSize": "6144",
    "hw.lcd.width": "1080",
    "hw.lcd.height": "2400",
  };
  const writeConfig = async (overrides: Record<string, string>) => {
    const text = Object.entries({ ...config, ...overrides }).map(([k, v]) => `${k} = ${v}`).join("\r\n");
    await writeFile(join(device, "config.ini"), text);
  };
  return { root, descriptor, device, writeConfig };
}

test("Windows RAM profile reads relocated phone AVDs and respects the API and large-screen floors", async t => {
  const { writeConfig } = await fixture(t);
  for (const [image, expected] of [
    ["system-images/android-35/default/x86_64/", 2560],
    ["system-images/android-36/google_apis/x86_64/", 2560],
    ["system-images/android-37.0/google_apis_playstore/x86_64/", 4096],
    ["system-images/android-37.1/google_apis/x86_64/", 4096],
  ] as const) {
    await writeConfig({ "image.sysdir.1": image, "hw.ramSize": "6G" });
    assert.equal(await windowsAvdRamMiB("my_phone"), expected);
  }
  await writeConfig({ "hw.lcd.width": "1250" });
  assert.equal(await windowsAvdRamMiB("my_phone"), 4096);
});

test("an unknown image or device, conflicting metadata, or insufficient configured RAM uses the stock launch", async t => {
  const { writeConfig, descriptor, device } = await fixture(t);
  for (const overrides of [
    { "image.sysdir.1": "system-images/android-38/google_apis/x86_64/" },
    { "image.sysdir.1": "system-images/android-36/android-wear/x86_64/" },
    { "image.sysdir.1": "/custom/sdk-image/" },
    { "tag.id": "android-automotive" }, { "abi.type": "arm64-v8a" },
    { "hw.device.name": "pixel_9_pro_fold" }, { "hw.device.name": "my_device" },
    { "hw.lcd.width": "" }, { "hw.ramSize": "2G" }, { "hw.ramSize": "2560M" }, { "hw.ramSize": "many" },
  ] as Record<string, string>[]) {
    await writeConfig(overrides);
    assert.equal(await windowsAvdRamMiB("my_phone"), undefined, JSON.stringify(overrides));
  }
  await writeConfig({});
  await writeFile(descriptor, `path=${device}\ntarget=android-37\n`);
  assert.equal(await windowsAvdRamMiB("my_phone"), undefined);
  assert.equal(await windowsAvdRamMiB("../my_phone"), undefined);
  assert.equal(await windowsAvdRamMiB("absent"), undefined);
});

test("relative descriptors resolve against the AVD registry parent and conflicting live paths are skipped", async t => {
  const { root, descriptor, device, writeConfig } = await fixture(t);
  await writeConfig({});
  await writeFile(descriptor, `path=${join(root, "missing.avd")}\npath.rel=relocated phone.avd\n`);
  assert.equal(await windowsAvdRamMiB("my_phone"), 2560);
  const other = join(root, "other.avd");
  await mkdir(other);
  await writeFile(descriptor, `path=${device}\npath.rel=other.avd\n`);
  assert.equal(await windowsAvdRamMiB("my_phone"), undefined);
});
