import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { startDisplayFpsMonitor } from "../src/fps/source.ts";
import type { FrameReading } from "../src/fps/frame-timeline.ts";

const skip = process.platform !== "darwin" && "needs macOS";
const target = { platform: "ios" as const, deviceId: "00008150-000A00000000001E" };

async function helper(t: TestContext, body: string) {
  const root = await mkdtemp(join(tmpdir(), "mobile-dev-ios-fps-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "helper.cjs");
  await writeFile(path, `#!${process.execPath}\n${body}`, { mode: 0o700 });
  return pathToFileURL(path);
}

test("the iOS FPS helper's ready record is the baseline sample", { skip }, async t => {
  const url = await helper(t, `
if (process.argv[2] !== 'fps') process.exit(2);
process.stdout.write('{"type":"ready"}\\n');
setTimeout(() => process.stdout.write('{"fps":59.5}\\n'), 100);
process.stdin.resume();
process.stdin.once('end', () => process.exit(0));
`);
  const samples: FrameReading[] = [];
  let received!: () => void;
  const second = new Promise<void>(resolve => { received = resolve; });
  const abort = new AbortController();
  const monitor = await startDisplayFpsMonitor({ target, signal: abort.signal, onSample: reading => {
    samples.push(reading);
    if (samples.length === 2) received();
  } }, url);
  await second;
  await monitor.stop();
  assert.equal(samples[0].fps, null);
  assert.equal(samples[0].interval, 0);
  assert.equal(samples[1].fps, 59.5);
});

test("the iOS FPS helper's error record becomes the startup failure", { skip }, async t => {
  const record = JSON.stringify({ type: "error", cause: "device_not_found", message: "Connect the paired iPhone." });
  const url = await helper(t, `process.stdout.write(${JSON.stringify(record + "\n")}); process.stderr.write('stderr detail'); process.exitCode = 1;`);
  const abort = new AbortController();
  await assert.rejects(startDisplayFpsMonitor({ target, signal: abort.signal, onSample: () => {} }, url), /^Error: Connect the paired iPhone\.$/);
});
