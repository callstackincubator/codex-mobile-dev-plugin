import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { serializeScreenLifecycle } from "../baguette-screen-lifecycle.mjs";
import { runSwiftTests } from "./swift-tests.ts";

const fixtureDirectory = new URL("../../packages/test-support/fixtures/baguette-screen/", import.meta.url);

test("screen lifecycle integration rejects changed and already integrated sources", async () => {
  const adapterUrl = new URL("SimulatorKitScreen.swift", fixtureDirectory);
  const adapter = await readFile(adapterUrl, "utf8");
  const updated = serializeScreenLifecycle(adapter);
  assert.throws(() => serializeScreenLifecycle(updated), /integration point changed/);
  const changed = adapter.replace("    func stop() {", "    func stopCapture() {");
  assert.throws(() => serializeScreenLifecycle(changed), /integration point changed/);
});

test("screen cleanup waits for active reads, supports callback shutdown and cleans failed starts", {
  skip: process.platform !== "darwin", timeout: 60000,
}, async t => {
  const parent = tmpdir();
  const prefix = join(parent, "mobile-dev-screen-lifecycle-test-");
  const directory = await mkdtemp(prefix);
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const files = ["Support.swift", "PendingCapture.swift", "ScreenIdleFloor.swift", "FramebufferSurfacePick.swift", "IOPortsRefresh.swift"];
  for (const file of files) {
    const source = new URL(file, fixtureDirectory);
    const target = join(directory, file);
    await copyFile(source, target);
  }
  const adapterUrl = new URL("SimulatorKitScreen.swift", fixtureDirectory);
  const adapter = await readFile(adapterUrl, "utf8");
  const updated = serializeScreenLifecycle(adapter);
  const adapterPath = join(directory, "SimulatorKitScreen.swift");
  await writeFile(adapterPath, updated);
  const testsUrl = new URL("../../packages/native/baguette/ScreenLifecycleTests.swift", import.meta.url);
  const testsPath = join(directory, "ScreenLifecycleTests.swift");
  await copyFile(testsUrl, testsPath);
  const sources = files.map(file => join(directory, file));
  sources.push(adapterPath, testsPath);
  const output = await runSwiftTests(directory, sources, { define: "MOBILE_DEV_SCREEN_STANDALONE", sanitizeThread: true, timeout: 10000 });
  assert.match(output, /Test run with 4 tests in 1 suite passed/);
  assert.doesNotMatch(output, /ThreadSanitizer:/);
});
