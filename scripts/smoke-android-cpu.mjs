import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { adbPath } from "../src/server/native-logs.ts";
import { deployAndroidCollector, loadAndroidCollector, startAndroidCpuMonitor } from "../src/server/cpu/android.ts";
import { androidSampleSchema, androidReadySchema, AndroidCpuSampler } from "../src/server/cpu/android-counters.ts";

const [deviceId, pidText, countText = "20"] = process.argv.slice(2);
const pid = Number(pidText);
const count = Number(countText);
if (!deviceId || !Number.isSafeInteger(pid) || pid <= 0 || !Number.isSafeInteger(count) || count < 3 || count > 60) {
  throw new Error("Usage: node scripts/smoke-android-cpu.mjs DEVICE_SERIAL RUNNING_PID [SAMPLES=20]");
}
const execute = promisify(execFile);
const adb = await adbPath();
const signal = AbortSignal.timeout(90000);
const root = new URL("../vendor/android-cpu/", import.meta.url);
const collector = await loadAndroidCollector(root);
const remote = await deployAndroidCollector(adb, deviceId, signal, collector);
const child = spawn(adb, ["-s", deviceId, "shell", "-T", `exec ${remote} ${pid}`], { stdio: ["pipe", "pipe", "pipe"] });
const closed = once(child, "close");
const lines = createInterface({ input: child.stdout });
let diagnostics = "";
child.stderr.on("data", data => { diagnostics += data.toString(); });
const deadline = setTimeout(() => child.kill("SIGKILL"), 75000);
let header;
let sampler;
const samples = [];
try {
  for await (const line of lines) {
    const json = JSON.parse(line);
    if (header === undefined) {
      header = androidReadySchema.parse(json);
      assert.equal(header.pid, pid);
      sampler = new AndroidCpuSampler(header.clockTicks, header.processStart);
    } else {
      const profile = androidSampleSchema.parse(json);
      const reading = sampler.sample(profile);
      samples.push({ profile, reading });
      if (samples.length >= count) { child.stdin.end("stop\n"); break; }
    }
  }
  const [code] = await closed;
  assert.equal(code, 0, diagnostics);
  assert.equal(samples.length, count, diagnostics);
  assert.ok(samples.at(-1).reading.cpuPercent !== null);
  for (const sample of samples) assert.ok(sample.reading.memoryBytes > 0);
  const first = samples[0].profile;
  const last = samples.at(-1).profile;
  const collectorCpuUs = BigInt(last.collectorCpuUs) - BigInt(first.collectorCpuUs);
  const elapsedUs = BigInt(last.timestampUs) - BigInt(first.timestampUs);
  const overhead = Number(collectorCpuUs) / Number(elapsedUs) * 100;
  const check = await execute(adb, ["-s", deviceId, "shell", "ps", "-A", "-o", "PID,NAME"], { timeout: 5000 });
  const helperStillRunning = new RegExp(`^\\s*${header.collectorPid}\\s`, "m").test(check.stdout);
  assert.equal(helperStillRunning, false, "The helper must stop with the session.");
  assert.ok(new RegExp(`^\\s*${pid}\\s`, "m").test(check.stdout), "The monitored app must remain running.");
  console.log(JSON.stringify({ deviceId, pid, samples: samples.length, threads: last.threads.length,
    elapsedSeconds: Number(elapsedUs) / 1000000, collectorCpuPercentOfOneCore: overhead,
    meanCollectorCpuUsPerSample: Number(collectorCpuUs) / (samples.length - 1), lastCpuPercent: samples.at(-1).reading.cpuPercent,
    lastMemoryBytes: samples.at(-1).reading.memoryBytes, memoryMetric: "rss" }, null, 2));
  // Exercise the production monitor, then disconnect its transport unexpectedly.
  let transport;
  const readings = [];
  const monitor = await startAndroidCpuMonitor({ deviceId, pid, signal, onSample: reading => readings.push(reading) }, {
    adbPath, deploy: (adb, serial, signal) => deployAndroidCollector(adb, serial, signal, collector),
    spawn: (...arguments_) => { transport = spawn(...arguments_); return transport; },
  });
  await new Promise(resolve => setTimeout(resolve, 2200));
  assert.ok(readings.length >= 2);
  assert.ok(readings.at(-1).cpuPercent !== null);
  for (const reading of readings) assert.ok(reading.memoryBytes > 0);
  transport.kill("SIGKILL");
  const error = await monitor.closed;
  assert.ok(error instanceof Error);
  await monitor.stop();
  await new Promise(resolve => setTimeout(resolve, 1200));
  const disconnected = await execute(adb, ["-s", deviceId, "shell", "ps", "-A", "-o", "PID,NAME"], { timeout: 5000 });
  assert.equal(disconnected.stdout.includes("mobile-dev-cpu-"), false, "ADB disconnection must not leave a collector running.");
  console.log("Production monitor readings, session cleanup and ADB disconnect cleanup passed.");
} finally {
  clearTimeout(deadline);
  child.kill("SIGKILL");
  lines.close();
}
