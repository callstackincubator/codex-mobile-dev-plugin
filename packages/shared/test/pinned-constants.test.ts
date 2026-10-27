import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { startupOutcomes as runtimeOutcomes, startupStages as runtimeStages } from "../../runtimes/serve-emu/src/startup-diagnostics.ts";
import { startupOutcomes, startupStages } from "../src/android-startup-diagnostics.ts";
import { BAGUETTE_PIN } from "../src/simulator-definition-diagnostics.ts";

// Shared code keeps copies so it never imports vendored runtimes; these must not drift.
test("shared Android startup names match the serve-emu runtime", () => {
  assert.deepEqual(startupStages, runtimeStages);
  assert.deepEqual(startupOutcomes, runtimeOutcomes);
});

test("the shared Baguette pin matches the vendored release", async () => {
  const release = JSON.parse(await readFile("packages/native/vendor/baguette-release.json", "utf8"));
  assert.deepEqual(BAGUETTE_PIN, { version: release.version, sourceCommit: release.rebuild.sourceCommit });
});
