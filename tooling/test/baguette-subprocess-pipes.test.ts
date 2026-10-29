import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { stopReadingWithoutClosing } from "../baguette-subprocess-pipes.mjs";
import { runSwiftTests } from "./swift-tests.ts";

const fixtureDirectory = new URL("../../packages/test-support/fixtures/baguette-subprocess/", import.meta.url);

test("subprocess pipe integration rejects changed and already integrated sources", async () => {
  const adapter = await readFile(new URL("HostSubprocess.swift", fixtureDirectory), "utf8");
  const updated = stopReadingWithoutClosing(adapter);
  assert.throws(() => stopReadingWithoutClosing(updated), /integration point changed/);
  const changed = adapter.replace("        try? pipe?.fileHandleForReading.close()\n        try? pipe?.fileHandleForWriting.close()\n    }\n}", "    }\n}");
  assert.throws(() => stopReadingWithoutClosing(changed), /integration point changed/);
});

test("stopping reading children leaves other descriptors open", {
  skip: process.platform !== "darwin", timeout: 60000,
}, async t => {
  const directory = await mkdtemp(join(tmpdir(), "mobile-dev-subprocess-pipes-test-"));
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const supportPath = join(directory, "Support.swift");
  await copyFile(new URL("Support.swift", fixtureDirectory), supportPath);
  const adapter = await readFile(new URL("HostSubprocess.swift", fixtureDirectory), "utf8");
  const adapterPath = join(directory, "HostSubprocess.swift");
  await writeFile(adapterPath, stopReadingWithoutClosing(adapter));
  const testsPath = join(directory, "SubprocessPipeTests.swift");
  await copyFile(new URL("../../packages/native/baguette/SubprocessPipeTests.swift", import.meta.url), testsPath);
  const output = await runSwiftTests(directory, [supportPath, adapterPath, testsPath], { define: "MOBILE_DEV_SUBPROCESS_STANDALONE", timeout: 20000 });
  assert.match(output, /Test run with 1 test in 1 suite passed/);
});
