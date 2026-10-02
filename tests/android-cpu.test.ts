import test from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { access, cp, mkdir, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { AndroidCpuSampler, androidSampleSchema } from "../src/server/cpu/android-counters.ts";
import { startAndroidCpuMonitor, deployAndroidCollector, loadAndroidCollector } from "../src/server/cpu/android.ts";
import { createCpuSessions } from "../src/server/cpu/sessions.ts";
import type { CpuSessions } from "../src/server/cpu/sessions.ts";
import { parseAndroidApps } from "../src/server/device-apps/apps.ts";
import { cpuTargetSchema } from "../src/shared/cpu.ts";
import type { CpuTarget } from "../src/shared/cpu.ts";

const sample = (timestampUs = "1000000", processTicks = "100", threads = [
  { tid: 123, start: "50", ticks: "60", name: "main" }, { tid: 124, start: "51", ticks: "40", name: "worker" },
]) => ({ type: "sample" as const, timestampUs, processTicks, processStart: "42", collectorCpuUs: "100", memoryBytes: 104857600, threads });

test("Android CPU uses kernel clock rate, supports multiple cores, and keeps exited-thread CPU in process totals", () => {
  const sampler = new AndroidCpuSampler(100, "42");
  assert.equal(sampler.sample(sample()).cpuPercent, null);
  const reading = sampler.sample(sample("2000000", "300", [{ tid: 123, start: "50", ticks: "160", name: "main" }]));
  assert.equal(reading.intervalUs, 1000000);
  assert.equal(reading.cpuPercent, 200);
  assert.equal(reading.threads[0].cpuPercent, 100);
});

test("Android CPU distinguishes reused thread IDs, clock gaps and counter resets", () => {
  const sampler = new AndroidCpuSampler(250, "42");
  sampler.sample(sample());
  const reading = sampler.sample(sample("2000000", "225", [{ tid: 123, start: "80", ticks: "1", name: "replacement" }]));
  assert.equal(reading.cpuPercent, 50);
  assert.equal(reading.threads[0].cpuPercent, null);
  assert.equal(reading.threads[0].id, "123-80");
  assert.equal(sampler.sample(sample("2000000", "250")).cpuPercent, null);
  assert.equal(sampler.sample(sample("20000000", "300")).cpuPercent, null);
  assert.equal(sampler.sample(sample("21000000", "10")).cpuPercent, null);
  assert.throws(() => sampler.sample({ ...sample(), processStart: "43" }), /restarted/);
  assert.throws(() => androidSampleSchema.parse({ ...sample(), processTicks: "-1" }));
});

test("Android memory is available immediately and rejects missing or invalid byte values", () => {
  const sampler = new AndroidCpuSampler(100, "42");
  const baseline = sampler.sample(sample());
  assert.equal(baseline.cpuPercent, null);
  assert.equal(baseline.memoryBytes, 104857600);
  const next = { ...sample("2000000", "150"), memoryBytes: 52428800 };
  const reading = sampler.sample(next);
  assert.equal(reading.memoryBytes, 52428800);
  for (const memoryBytes of [undefined, -1, 1.5, 9007199254740992, "104857600"]) {
    const malformed = { ...sample(), memoryBytes };
    assert.throws(() => androidSampleSchema.parse(malformed));
  }
});

test("Android app discovery selects installed user app main processes", () => {
  const apps = parseAndroidApps("package:com.example.app\npackage:com.example.other\n", "PID NAME\n123 com.example.app\n124 com.example.app:worker\n125 com.android.settings\n456 com.example.other\n0 com.example.other\n");
  assert.deepEqual(apps, [{ bundleId: "com.example.app", pid: 123 }, { bundleId: "com.example.other", pid: 456 }]);
  assert.equal(cpuTargetSchema.safeParse({ platform: "android", deviceId: "emulator-5554", bundleId: "com.example.app" }).success, true);
  assert.equal(cpuTargetSchema.safeParse({ deviceId: "emulator-5554", bundleId: "com.example.app" }).success, false);
  assert.equal(cpuTargetSchema.safeParse({ platform: "android", deviceId: "avd:Pixel", bundleId: "com.example.app" }).success, false);
  assert.equal(cpuTargetSchema.safeParse({ platform: "android", deviceId: "emulator-5554;id", bundleId: "com.example.app" }).success, false);
});

function source(script: string) {
  return { adbPath: async () => process.execPath, deploy: async () => "/data/local/tmp/cpu",
    spawn: () => spawn(process.execPath, ["-e", script], { stdio: ["pipe", "pipe", "pipe"] }) };
}
const header = { type: "ready", pid: 123, collectorPid: 999, clockTicks: 100, processStart: "42" };
const wait = 'process.stdin.on("data", () => process.exit(0)); process.stdin.on("end", () => process.exit(0));';

test("Android monitor handles fragmented records and idempotent stop without touching the app", async () => {
  const payload = [header, sample(), sample("2000000", "150")].map(value => JSON.stringify(value)).join("\n") + "\n";
  const script = `const text = ${JSON.stringify(payload)}; process.stdout.write(text.slice(0, 20)); setTimeout(() => process.stdout.write(text.slice(20)), 10); ${wait}`;
  const readings: number[] = [];
  const monitor = await startAndroidCpuMonitor({ deviceId: "emulator-5554", pid: 123, signal: new AbortController().signal,
    onSample: reading => { if (reading.cpuPercent !== null) readings.push(reading.cpuPercent); } }, source(script));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.deepEqual(readings, [50]);
  await Promise.all([monitor.stop(), monitor.stop()]);
});

test("Android permission failures and malformed counters fail without invented samples", async () => {
  const options = { deviceId: "emulator-5554", pid: 123, signal: new AbortController().signal, onSample() { assert.fail("No samples expected"); } };
  await assert.rejects(startAndroidCpuMonitor(options, source('process.stderr.write("Permission denied reading /proc/123/stat"); process.exit(1);')), /Permission denied/);
  const script = `process.stdout.write(${JSON.stringify(JSON.stringify(header) + "\ninvalid-json\n")}); ${wait}`;
  const monitor = await startAndroidCpuMonitor(options, source(script));
  const error = await monitor.closed;
  assert.match(error.message, /Invalid Android CPU stream/);
  await monitor.stop();
});

test("closing during Android collector startup cancels and waits for the helper", async () => {
  const abort = new AbortController();
  const starting = startAndroidCpuMonitor({ deviceId: "emulator-5554", pid: 123, signal: abort.signal, onSample() {} }, source(wait));
  setTimeout(() => abort.abort(), 30);
  await assert.rejects(starting, /cancelled/);
});

test("Android deployment verifies ABI binaries and atomically replaces the executable", async () => {
  const commands: string[][] = [];
  const root = new URL("../vendor/android-cpu/", import.meta.url);
  const collector = await loadAndroidCollector(root);
  const arm64 = collector.get("arm64-v8a");
  assert.ok(arm64);
  const run = async (_adb: string, args: string[]) => {
    commands.push(args);
    if (args[2] === "push") {
      const staged = await readFile(args[3]);
      assert.deepEqual(staged, arm64.bytes);
    }
    return commands.length === 1 ? "arm64-v8a\n" : "";
  };
  const signal = new AbortController().signal;
  const remote = await deployAndroidCollector("adb", "emulator-5554", signal, collector, run);
  assert.match(remote, /^\/data\/local\/tmp\/mobile-dev-cpu-[a-f0-9]{64}$/);
  assert.equal(commands[1][2], "push");
  assert.notEqual(commands[1].at(-1), remote, "Do not overwrite a running executable.");
  assert.match(commands[2].at(-1)!, /chmod 700 .* && mv /);
  const stagedFile = commands[1][3];
  const leftover = access(stagedFile);
  await assert.rejects(leftover, { code: "ENOENT" });
  const release = JSON.parse(await readFile(new URL("release.json", root), "utf8"));
  for (const [abi, metadata] of Object.entries<{ sha256: string }>(release.binaries)) {
    const bytes = await readFile(new URL(`${abi}/mobile-dev-cpu`, root));
    const digest = createHash("sha256").update(bytes).digest("hex");
    assert.equal(digest, metadata.sha256);
  }
});

test("Android CPU sessions reconnect after the original plugin cache is removed", async t => {
  const temporaryBase = tmpdir();
  const prefix = join(temporaryBase, "mobile-dev-cpu-cache-test-");
  const temporary = await mkdtemp(prefix);
  const previousSdk = process.env.ANDROID_HOME;
  let cpu: CpuSessions | undefined;
  t.after(async () => {
    try { await cpu?.close(); }
    finally {
      if (previousSdk === undefined) delete process.env.ANDROID_HOME;
      else process.env.ANDROID_HOME = previousSdk;
      await rm(temporary, { recursive: true, force: true });
    }
  });
  const original = join(temporary, "plugin-cache", "old-version", "dist", "android-cpu");
  await cp("vendor/android-cpu", original, { recursive: true });
  const root = pathToFileURL(`${original}/`);
  const sessions = await createCpuSessions(root);
  cpu = sessions;
  const sdk = join(temporary, "sdk");
  const platformTools = join(sdk, "platform-tools");
  await mkdir(platformTools, { recursive: true });
  const adb = join(platformTools, "adb");
  const pushes = join(temporary, "pushes.txt");
  const collectorHeader = JSON.stringify(header);
  const baseline = sample();
  const active = sample("2000000", "150");
  const collectorSamples = [baseline, active];
  const collectorPayload = collectorSamples.map(value => JSON.stringify(value));
  const body = `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[2] === 'push') {
  const bytes = fs.readFileSync(args[3]);
  if (bytes.length === 0) throw new Error('Empty staged collector.');
  fs.appendFileSync(${JSON.stringify(pushes)}, args[3] + '\\n');
} else if (args[3] === 'pm') process.stdout.write('package:com.example.app\\n');
else if (args[3] === 'ps') process.stdout.write('PID NAME\\n123 com.example.app\\n');
else if (args[3] === 'getprop') process.stdout.write('arm64-v8a\\n');
else if (args[3] === '-T') {
  process.stdout.write(${JSON.stringify(collectorHeader)} + '\\n');
  for (const record of ${JSON.stringify(collectorPayload)}) process.stdout.write(record + '\\n');
  process.stdin.on('data', () => process.exit(0));
  process.stdin.on('end', () => process.exit(0));
}
`;
  await writeFile(adb, body, { mode: 0o700 });
  process.env.ANDROID_HOME = sdk;
  const target: CpuTarget = { platform: "android", deviceId: "emulator-cache-test", bundleId: "com.example.app" };
  const readUsage = async (id: string) => {
    let cursor = 0;
    for (let attempt = 0; attempt < 20; attempt++) {
      const batch = await sessions.read(id, cursor, 300);
      assert.notEqual(batch.phase, "failed", batch.error);
      const measured = batch.samples.find(reading => reading.cpuPercent !== null);
      if (measured) return measured.cpuPercent;
      cursor = batch.cursor;
    }
    assert.fail("The CPU session did not report a measured sample.");
  };
  const first = sessions.open(target);
  const firstUsage = await readUsage(first);
  assert.equal(firstUsage, 50);
  await sessions.closeSession(first);
  await rm(original, { recursive: true });
  const missingCache = access(original);
  await assert.rejects(missingCache, { code: "ENOENT" });
  const second = sessions.open(target);
  const secondUsage = await readUsage(second);
  assert.equal(secondUsage, 50);
  await sessions.closeSession(second);
  const pushText = await readFile(pushes, "utf8");
  const trimmedPushes = pushText.trim();
  const stagedPaths = trimmedPushes.split("\n");
  assert.equal(stagedPaths.length, 2);
  assert.notEqual(stagedPaths[0], stagedPaths[1]);
  for (const staged of stagedPaths) {
    const leftover = access(staged);
    await assert.rejects(leftover, { code: "ENOENT" });
  }
});

test("collector startup verifies every ABI before retaining its bytes", async t => {
  const temporaryBase = tmpdir();
  const prefix = join(temporaryBase, "mobile-dev-cpu-integrity-test-");
  const temporary = await mkdtemp(prefix);
  t.after(() => rm(temporary, { recursive: true, force: true }));
  await cp("vendor/android-cpu", temporary, { recursive: true });
  const binary = join(temporary, "x86", "mobile-dev-cpu");
  await writeFile(binary, "corrupted");
  const root = pathToFileURL(`${temporary}/`);
  const loading = loadAndroidCollector(root);
  await assert.rejects(loading, /integrity check for x86/);
});

test("failed Android deployment removes host staging and the partial device upload", async () => {
  const root = new URL("../vendor/android-cpu/", import.meta.url);
  const collector = await loadAndroidCollector(root);
  const commands: string[][] = [];
  let stagedFile = "";
  const run = async (_adb: string, args: string[]) => {
    commands.push(args);
    if (args.includes("getprop")) return "arm64-v8a\n";
    if (args[2] === "push") { stagedFile = args[3]; throw new Error("Upload failed"); }
    return "";
  };
  const signal = new AbortController().signal;
  const deploying = deployAndroidCollector("adb", "emulator-5554", signal, collector, run);
  await assert.rejects(deploying, /Upload failed/);
  const cleanup = commands.at(-1);
  assert.deepEqual(cleanup?.slice(2, 5), ["shell", "rm", "-f"]);
  const leftover = access(stagedFile);
  await assert.rejects(leftover, { code: "ENOENT" });
});

test("native /proc parser handles spaces, closing parentheses and newlines in thread names", async t => {
  const temporary = await mkdtemp(join(tmpdir(), "mobile-cpu-parser-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const path = resolve("native/android-cpu/collector.c");
  const name = "worker ) name\n";
  const fixture = `123 (${name}) S 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20`;
  const harness = `#define COLLECTOR_TEST\n#include ${JSON.stringify(path)}\n#include <assert.h>\nint main(void) { Counter c = {0}; char stat[] = ${JSON.stringify(fixture)}; assert(parse_stat(stat, &c) == 0); assert(c.ticks == 23); assert(c.start == 19); assert(strcmp(c.name, ${JSON.stringify(name)}) == 0); json_string(c.name); char bad[] = "123 (name) S 1"; assert(parse_stat(bad, &c) == -1); return 0; }\n`;
  const file = join(temporary, "test.c");
  const binary = join(temporary, "test");
  await writeFile(file, harness);
  execFileSync("cc", ["-std=c11", file, "-o", binary]);
  const output = execFileSync(binary, [], { encoding: "utf8" });
  assert.equal(JSON.parse(output), name);
});

test("native memory parser uses the device page size and rejects malformed or overflowing RSS", async t => {
  const temporaryBase = tmpdir();
  const prefix = join(temporaryBase, "mobile-memory-parser-");
  const temporary = await mkdtemp(prefix);
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const sourcePath = resolve("native/android-cpu/collector.c");
  const include = JSON.stringify(sourcePath);
  const harness = `#define COLLECTOR_TEST
#include ${include}
#include <assert.h>
int main(void) {
    uint64_t bytes = 0;
    int result = parse_memory("1000 25 5 0 0 0 0\\n", 4096, &bytes);
    assert(result == 0 && bytes == 102400);
    result = parse_memory("1000\\t25 5 0 0 0 0\\n", 16384, &bytes);
    assert(result == 0 && bytes == 409600);
    result = parse_memory("1000 0\\n", 4096, &bytes);
    assert(result == 0 && bytes == 0);
    const char *invalid[] = {"1000", "1000 -1", "1000 1.5", "1000 garbage", "1000 18446744073709551615", "18446744073709551616 1"};
    for (size_t index = 0; index < sizeof(invalid) / sizeof(invalid[0]); index++) {
        result = parse_memory(invalid[index], 4096, &bytes);
        assert(result == -1);
    }
    result = parse_memory("1000 25", 0, &bytes);
    assert(result == -1);
    return 0;
}
`;
  const file = join(temporary, "test.c");
  const binary = join(temporary, "test");
  await writeFile(file, harness);
  execFileSync("cc", ["-std=c11", file, "-o", binary]);
  execFileSync(binary);
});
