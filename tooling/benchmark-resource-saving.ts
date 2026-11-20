import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir, cpus, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { gzip } from "node:zlib";
import { Baguette } from "../packages/core/src/baguette.ts";
import { ServeEmu } from "../packages/core/src/serve-emu.ts";
import { ResourceSaving } from "../packages/core/src/resource-saving.ts";
import { usePanelRuntime } from "../packages/core/src/panel-runtime.ts";
import { adbPath } from "../packages/core/src/native-logs.ts";

const execute = promisify(execFile);
const compress = promisify(gzip);
function argument(name: string, defaultValue?: string) {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? defaultValue : process.argv[index + 1];
  if (value === undefined) throw new Error(`Missing ${name}.`);
  return value;
}
const ios = argument("--ios");
const avd = argument("--android");
const output = argument("--output");
const roundsArgument = argument("--rounds", "3");
const settleArgument = argument("--settle", "30");
const secondsArgument = argument("--seconds", "30");
const rounds = Number(roundsArgument);
const settleSeconds = Number(settleArgument);
const sampleSeconds = Number(secondsArgument);
if (/^[A-Fa-f0-9-]{36}$/.test(ios) === false || /^[A-Za-z0-9_.-]+$/.test(avd) === false) throw new Error("Invalid device identifier.");
const root = resolve("dist");
usePanelRuntime(async () => root);
const temporaryRoot = tmpdir();
const prefix = join(temporaryRoot, "mobile-dev-slim-benchmark-");
const temporary = await mkdtemp(prefix);
const collector = join(temporary, "measure");
await execute("/usr/bin/clang", ["-O2", "-Wall", "-Wextra", "tooling/measure-virtual-device.c", "-o", collector]);
const preferences = join(temporary, "preferences");
const saving = new ResourceSaving({ directory: preferences });
const baguette = new Baguette();
const android = new ServeEmu();
baguette.resourceSaving = saving;
android.resourceSaving = saving;
const adb = await adbPath();
const iosTarget = { platform: "ios" as const, id: ios, key: ios, state: "Shutdown" };
const androidTarget = { platform: "android" as const, id: `avd:${avd}`, key: avd, state: "Shutdown" };
type Process = { pid: number; start: string; cpuNs: string; footprintBytes: number };
type Sample = { timeNs: string; processes: Process[] };
type Summary = { memoryMiB: number; cpuPercent: number; processes: number };
const results: Array<{ round: number; enabled: boolean; ios: { samples: Sample[]; summary: Summary }; android: { samples: Sample[]; summary: Summary } }> = [];

async function androidDevice() {
  const status = await android.list();
  return status.devices.find(device => device.kind === "emulator" && device.name === avd && device.state === "Booted");
}

async function stop() {
  const status = await baguette.start();
  const device = status.devices.find(device => device.udid === ios);
  if (device?.state === "Booted") await baguette.changeDeviceState(ios, "shutdown");
  const running = await androidDevice();
  if (running !== undefined) await android.shutdown(running.udid);
}

async function processRoot(platform: "ios" | "android") {
  if (platform === "ios") {
    const result = await execute("/usr/bin/pgrep", ["-f", `${ios}/data/var/run/launchd_bootstrap`]);
    const text = result.stdout.trim();
    return Number(text);
  }
  const result = await execute("/bin/ps", ["-axo", "pid=,command="]);
  const lines = result.stdout.split("\n");
  for (const line of lines) {
    const text = line.trim();
    const tokens = text.split(/\s+/);
    const avdIndex = tokens.indexOf("-avd");
    if (line.includes("qemu-system-") && avdIndex !== -1 && tokens[avdIndex + 1] === avd) return Number(tokens[0]);
  }
  throw new Error("Cannot locate the selected emulator process.");
}

async function samples(pid: number) {
  const collected: Sample[] = [];
  for (let index = 0; index <= sampleSeconds; index++) {
    if (index > 0) await delay(1000);
    const pidArgument = String(pid);
    const result = await execute(collector, [pidArgument]);
    const sample: Sample = JSON.parse(result.stdout);
    collected.push(sample);
  }
  return collected;
}

function summarize(samples: Sample[]): Summary {
  let memory = 0;
  let processes = 0;
  let cpuNs = 0n;
  let wallNs = 0n;
  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index];
    for (const process of sample.processes) memory += process.footprintBytes;
    processes += sample.processes.length;
    const previous = samples[index - 1];
    if (previous === undefined) continue;
    wallNs += BigInt(sample.timeNs) - BigInt(previous.timeNs);
    const old = new Map<string, bigint>();
    for (const process of previous.processes) {
      const cpu = BigInt(process.cpuNs);
      old.set(`${process.pid}:${process.start}`, cpu);
    }
    for (const process of sample.processes) {
      const before = old.get(`${process.pid}:${process.start}`);
      if (before !== undefined) cpuNs += BigInt(process.cpuNs) - before;
    }
  }
  const cpuTime = Number(cpuNs);
  const wallTime = Number(wallNs);
  return { memoryMiB: memory / samples.length / 1024 / 1024, cpuPercent: cpuTime / wallTime * 100, processes: processes / samples.length };
}

async function save() {
  const outputDirectory = dirname(output);
  await mkdir(outputDirectory, { recursive: true });
  const releasesText = await readFile("packages/native/resource-saving/releases.json", "utf8");
  const releases: unknown = JSON.parse(releasesText);
  const processors = cpus();
  const now = new Date();
  const collectedAt = now.toISOString();
  const memoryBytes = totalmem();
  const data = { collectedAt, host: { model: processors[0]?.model, cores: processors.length, memoryBytes }, ios, avd, rounds, settleSeconds, sampleSeconds, memory: "summed host phys_footprint", cpu: "interval CPU time / wall time, 100% is one host core; processes observed at both interval boundaries", releases, results };
  const text = JSON.stringify(data, null, 2);
  const json = text + "\n";
  const bytes = output.endsWith(".gz") ? await compress(json) : json;
  await writeFile(output, bytes);
}

try {
  for (let round = 1; round <= rounds; round++) {
    for (const enabled of [false, true]) {
      await stop();
      await saving.set(iosTarget, enabled);
      await saving.set(androidTarget, enabled);
      console.log(`Round ${round}/${rounds}: booting ${enabled ? "optimized" : "stock"} devices`);
      const iosBoot = baguette.changeDeviceState(ios, "boot", 240000);
      const androidBoot = android.boot(`avd:${avd}`);
      await Promise.all([iosBoot, androidBoot]);
      const running = await androidDevice();
      if (running === undefined) throw new Error("The selected Android emulator is not running.");
      await execute(adb, ["-s", running.udid, "shell", "input", "keyevent", "KEYCODE_HOME"]);
      console.log(`Settling for ${settleSeconds}s`);
      await delay(settleSeconds * 1000);
      const iosProcess = processRoot("ios");
      const androidProcess = processRoot("android");
      const [iosRoot, androidRoot] = await Promise.all([iosProcess, androidProcess]);
      console.log(`Sampling for ${sampleSeconds}s`);
      const iosReadings = samples(iosRoot);
      const androidReadings = samples(androidRoot);
      const [iosSamples, androidSamples] = await Promise.all([iosReadings, androidReadings]);
      const iosSummary = summarize(iosSamples);
      const androidSummary = summarize(androidSamples);
      results.push({ round, enabled, ios: { samples: iosSamples, summary: iosSummary }, android: { samples: androidSamples, summary: androidSummary } });
      const summary = JSON.stringify({ round, enabled, ios: iosSummary, android: androidSummary });
      console.log(summary);
      await save();
    }
  }
} finally {
  await stop();
  baguette.dispose();
  android.dispose();
  await rm(temporary, { recursive: true, force: true });
}
