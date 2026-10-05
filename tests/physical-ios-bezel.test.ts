import test from "node:test";
import assert from "node:assert/strict";
import { access, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createPhysicalIosBezelReader } from "../src/server/physical-ios-bezel.ts";
import type { PhysicalIosDevice } from "../src/shared/ios-devices.ts";

const phone: PhysicalIosDevice = {
  udid: "00008150-0000111122223333", coreDeviceId: "11111111-1111-4111-8111-111111111111",
  name: "Personal phone", model: "Marketing name", productType: "iPhone18,1", state: "connected", runtime: "iOS 27.0",
  platform: "ios", kind: "physical", transportType: "localNetwork", pairingState: "paired",
};
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const maskId = "4E5532ED-1470-47D1-BDF4-7AA90C26957A";
const profilePath = "/Library/Developer/CoreSimulator/Profiles/DeviceTypes/iPhone 17 Pro.simdevicetype/Contents/Resources/profile.plist";
const layout = { screen: { x: 27, y: 18, width: 400, height: 872 }, composite: { width: 454, height: 908 }, innerCornerRadius: 62, buttonMargins: { left: 9, right: 9 } };

function jsonOutput(value: unknown) {
  const json = JSON.stringify(value);
  const stdout = Buffer.from(json);
  return { stdout };
}

function fixture() {
  const calls: { file: string; args: string[] }[] = [];
  const maskDirectories: string[] = [];
  let failMask = false;
  let image = png;
  let screen = layout.screen;
  let hasMask = true;
  let selectedName = "";
  const read = createPhysicalIosBezelReader(async (file, args, options) => {
    calls.push({ file, args });
    assert.equal(options.encoding, "buffer");
    assert.equal(options.timeout, 15000);
    assert.equal(options.maxBuffer, 8 * 1024 * 1024);
    if (file === "/usr/bin/xcrun") {
      assert.deepEqual(args, ["simctl", "list", "devicetypes", "--json"]);
      return jsonOutput({ devicetypes: [
        { name: "iPhone 18 Pro Max", modelIdentifier: "iPhone19,3", bundlePath: "/Library/Developer/CoreSimulator/Profiles/DeviceTypes/iPhone 18 Pro Max.simdevicetype" },
        { name: "iPhone 17 Pro", modelIdentifier: "iPhone18,1", bundlePath: "/Library/Developer/CoreSimulator/Profiles/DeviceTypes/iPhone 17 Pro.simdevicetype" },
      ] });
    }
    if (file === "/usr/bin/plutil") {
      const path = args.at(-1);
      assert.ok(path);
      assert.deepEqual(args.slice(0, 4), ["-convert", "json", "-o", "-"]);
      const variant = path.includes("iPhone 18 Pro Max");
      if (variant) assert.equal(path, "/Library/Developer/CoreSimulator/Profiles/DeviceTypes/iPhone 18 Pro Max.simdevicetype/Contents/Resources/profile.plist");
      else assert.equal(path, profilePath);
      selectedName = variant ? "iPhone 18 Pro Max" : "iPhone 17 Pro";
      const representedModelIdentifiers = variant ? ["iPhone19,3", "iPhone19,7"] : ["iPhone18,1"];
      const profile = hasMask ? { framebufferMask: maskId, representedModelIdentifiers } : { representedModelIdentifiers };
      return jsonOutput(profile);
    }
    if (file === "/usr/bin/sips") {
      const output = args.at(-1);
      assert.ok(output);
      const directory = dirname(output);
      maskDirectories.push(directory);
      assert.deepEqual(args.slice(0, 5), ["-s", "format", "png", `/Library/Developer/DeviceKit/FramebufferMasks/${maskId}.pdf`, "--out"]);
      if (failMask) throw new Error("Mask rasterization failed");
      await writeFile(output, png);
      return { stdout: Buffer.alloc(0) };
    }
    assert.match(file, /\/vendor\/baguette\/Baguette$/);
    assert.equal(options.env?.DYLD_LIBRARY_PATH, "/selected/toolchain/libraries");
    assert.equal(args[0], "chrome");
    assert.deepEqual(args.slice(2), ["--device-name", selectedName]);
    if (args[1] === "layout") return jsonOutput({ ...layout, screen });
    assert.equal(args[1], "composite");
    return { stdout: image };
  }, async (executable, signal) => {
    assert.match(executable, /\/vendor\/baguette\/Baguette$/);
    assert.equal(signal.aborted, false);
    return { DYLD_LIBRARY_PATH: "/selected/toolchain/libraries" };
  });
  return {
    read, calls, maskDirectories,
    failMask(value: boolean) { failMask = value; },
    setImage(value: Buffer) { image = value; },
    setScreen(value: typeof screen) { screen = value; },
    omitMask() { hasMask = false; },
  };
}

test("physical frames use hardware identity, preserve CLI button margins, and cache concurrent opens", async () => {
  const f = fixture();
  const first = f.read(phone);
  const second = f.read({ ...phone, name: "Other phone", udid: "00008150-0000444455556666", transportType: "wired" });
  assert.equal(first, second);
  const bezel = await first;
  assert.deepEqual(bezel.rect, layout.screen);
  assert.deepEqual(bezel.viewport, layout.composite);
  assert.equal(bezel.clipRadius, 62);
  const encoded = png.toString("base64");
  assert.equal(bezel.image, `data:image/png;base64,${encoded}`);
  assert.equal(bezel.mask, `data:image/png;base64,${encoded}`);
  const cached = await f.read(phone);
  assert.equal(cached, bezel);
  assert.equal(f.calls.length, 5);
  const removed = access(f.maskDirectories[0]);
  await assert.rejects(removed, { code: "ENOENT" });
});

test("an uninstalled hardware model is reported without borrowing another model's frame", async () => {
  const f = fixture();
  const missing = f.read({ ...phone, productType: "iPhone99,1" });
  await assert.rejects(missing, /no Apple device frame.*iPhone99,1/);
  assert.equal(f.calls.length, 3);
});

test("Apple's represented model IDs select the exact regional or cellular variant", async () => {
  const f = fixture();
  await f.read({ ...phone, productType: "iPhone19,7" });
  const render = f.calls.find(call => call.args[1] === "composite");
  assert.deepEqual(render?.args, ["chrome", "composite", "--device-name", "iPhone 18 Pro Max"]);
});

test("mask failures remove temporary files and allow the same rendering path to retry", async () => {
  const f = fixture();
  f.failMask(true);
  const failed = f.read(phone);
  await assert.rejects(failed, /Mask rasterization failed/);
  const removed = access(f.maskDirectories[0]);
  await assert.rejects(removed, { code: "ENOENT" });
  f.failMask(false);
  const bezel = await f.read(phone);
  assert.ok(bezel.mask);
  assert.equal(f.maskDirectories.length, 2);
});

test("invalid layout bounds and non-PNG output cannot reach the panel", async () => {
  const f = fixture();
  f.setScreen({ ...layout.screen, x: 1000 });
  const invalidBounds = f.read(phone);
  await assert.rejects(invalidBounds, /Screen must fit within the bezel/);
  f.setScreen(layout.screen);
  const invalidPng = Buffer.from("not PNG");
  f.setImage(invalidPng);
  const invalidImage = f.read(phone);
  await assert.rejects(invalidImage, /Invalid Apple device frame PNG/);
});

test("a profile without a framebuffer mask keeps its declared rectangular screen", async () => {
  const f = fixture();
  f.omitMask();
  const bezel = await f.read(phone);
  assert.equal(bezel.mask, undefined);
  assert.equal(f.calls.length, 4);
});
