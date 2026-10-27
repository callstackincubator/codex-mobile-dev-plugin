import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { serializeScreenLifecycle } from "../baguette-screen-lifecycle.mjs";

const execute = promisify(execFile);
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
  const runnerPath = join(directory, "TestMain.swift");
  await writeFile(runnerPath, `import Darwin
import Testing
@main enum TestMain {
    static func main() async {
        let status: CInt = await Testing.__swiftPMEntryPoint()
        exit(status)
    }
}
`);
  const platformResult = await execute("xcrun", ["--sdk", "macosx", "--show-sdk-platform-path"]);
  const platform = platformResult.stdout.trim();
  const frameworks = join(platform, "Developer/Library/Frameworks");
  const compilerResult = await execute("xcrun", ["--find", "swiftc"]);
  const compiler = compilerResult.stdout.trim();
  const compilerDirectory = dirname(compiler);
  const testingMacros = join(compilerDirectory, "../lib/swift/host/plugins/testing/libTestingMacros.dylib");
  const binary = join(directory, "screen-tests");
  const sources = files.map(file => join(directory, file));
  sources.push(adapterPath, testsPath, runnerPath);
  await execute("xcrun", ["swiftc", "-swift-version", "6", "-g", "-parse-as-library",
    "-D", "MOBILE_DEV_SCREEN_STANDALONE", "-sanitize=thread", "-load-plugin-library", testingMacros,
    "-F", frameworks, "-Xlinker", "-rpath", "-Xlinker", frameworks, ...sources, "-o", binary], { timeout: 45000 });
  const env = { ...process.env, TSAN_OPTIONS: "halt_on_error=1" };
  const result = await execute(binary, [], { timeout: 10000, env });
  const output = result.stdout + result.stderr;
  assert.match(output, /Test run with 4 tests in 1 suite passed/);
  assert.doesNotMatch(output, /ThreadSanitizer:/);
});
