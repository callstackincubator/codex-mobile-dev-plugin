import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverTestingTargets, expoTargets } from "../src/testing-target-discovery.ts";

test("Expo config produces both iOS and Android targets when both identifiers are known", () => {
  assert.deepEqual(expoTargets({ expo: { ios: { bundleIdentifier: "com.example.app" }, android: { package: "com.example.app" } } }), [
    { name: "ios", platform: "ios", bundleId: "com.example.app" },
    { name: "android", platform: "android", bundleId: "com.example.app" },
  ]);
});

test("target discovery uses the project-local Expo CLI without npx", async () => {
  const root = await mkdtemp(join(tmpdir(), "testing-expo-cli-"));
  try {
    const bin = join(root, "node_modules/.bin/expo");
    await mkdir(join(root, "node_modules/.bin"), { recursive: true });
    await writeFile(bin, `#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({ios:{bundleIdentifier:'com.cli.ios'},android:{package:'com.cli.android'}}));\n`);
    await chmod(bin, 0o755);
    await writeFile(join(root, "app.json"), JSON.stringify({ expo: { ios: { bundleIdentifier: "com.static.wrong" } } }));
    const result = await discoverTestingTargets(root);
    assert.equal(result.source, "expo-cli");
    assert.deepEqual(result.targets.map(target => target.bundleId), ["com.cli.ios", "com.cli.android"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a failing local CLI falls back to non-executing app.config data, then foreground app", async () => {
  const root = await mkdtemp(join(tmpdir(), "testing-expo-static-"));
  try {
    const bin = join(root, "node_modules/.bin/expo");
    await mkdir(join(root, "node_modules/.bin"), { recursive: true });
    await writeFile(bin, "#!/bin/sh\nexit 2\n"); await chmod(bin, 0o755);
    await writeFile(join(root, "app.config.ts"), `export default { expo: { ios: { bundleIdentifier: 'com.static.ios' }, android: { package: 'com.static.android' } } };\n`);
    const result = await discoverTestingTargets(root, { platform: "ios", bundleId: "com.foreground" });
    assert.equal(result.source, "static-expo");
    assert.deepEqual(result.targets.map(target => target.bundleId), ["com.static.ios", "com.static.android"]);

    await rm(join(root, "app.config.ts"));
    const foreground = await discoverTestingTargets(root, { platform: "android", bundleId: "com.foreground" });
    assert.equal(foreground.source, "foreground");
    assert.deepEqual(foreground.targets, [{ name: "android", platform: "android", bundleId: "com.foreground" }]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
