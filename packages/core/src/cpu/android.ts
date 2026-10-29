import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { adbPath } from "../native-logs.ts";
import type { CpuReading } from "./counters.ts";
import { AndroidCpuSampler, androidReadySchema, androidSampleSchema } from "./android-counters.ts";
import { nativeCollectorCommand } from "../native-telemetry.ts";
import { startCollector } from "../collectors/process.ts";
import type { Collector, CollectorOptions } from "../collectors/process.ts";

const execute = promisify(execFile);
const abiSchema = z.enum(["arm64-v8a", "armeabi-v7a", "x86", "x86_64"]);
const releaseSchema = z.object({ binaries: z.record(z.string(), z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/) })) });
export type AndroidCollector = ReadonlyMap<z.infer<typeof abiSchema>, { bytes: Buffer; sha256: string }>;
type Options = { deviceId: string; pid: number; signal: AbortSignal; onSample: (sample: CpuReading) => void };
const stalled = "The Android CPU collector stopped responding. Reconnect the device.";
type Command = (adb: string, args: string[], signal?: AbortSignal) => Promise<string>;
const command: Command = async (adb, args, signal) => {
  const result = await execute(adb, args, { signal, timeout: 10000, maxBuffer: 1024 * 1024 });
  return result.stdout;
};

export async function loadAndroidCollector(root: URL): Promise<AndroidCollector> {
  const manifest = new URL("release.json", root);
  const releaseText = await readFile(manifest, "utf8");
  const releaseJson: unknown = JSON.parse(releaseText);
  const release = releaseSchema.parse(releaseJson);
  const collector = new Map<z.infer<typeof abiSchema>, { bytes: Buffer; sha256: string }>();
  for (const abi of abiSchema.options) {
    const local = new URL(`${abi}/mobile-dev-cpu`, root);
    const bytes = await readFile(local);
    const hash = createHash("sha256");
    hash.update(bytes);
    const sha256 = hash.digest("hex");
    if (sha256 !== release.binaries[`${abi}/mobile-dev-cpu`]?.sha256) throw new Error(`The bundled Android CPU collector failed its integrity check for ${abi}.`);
    collector.set(abi, { bytes, sha256 });
  }
  return collector;
}

export async function deployAndroidCollector(adb: string, deviceId: string, signal: AbortSignal,
  collector: AndroidCollector, run: Command = command): Promise<string> {
  signal.throwIfAborted();
  const rawAbi = await run(adb, ["-s", deviceId, "shell", "getprop", "ro.product.cpu.abi"], signal);
  const abiText = rawAbi.trim();
  const abi = abiSchema.parse(abiText);
  const binary = collector.get(abi);
  if (binary === undefined) throw new Error(`The bundled Android CPU collector is missing ${abi}.`);
  const remote = `/data/local/tmp/mobile-dev-cpu-${binary.sha256}`;
  const token = randomBytes(8);
  const tokenText = token.toString("hex");
  const temporary = `${remote}-${tokenText}`;
  const hostTemporary = tmpdir();
  const prefix = join(hostTemporary, "mobile-dev-cpu-");
  const directory = await mkdtemp(prefix);
  const localPath = join(directory, "mobile-dev-cpu");
  try {
    await writeFile(localPath, binary.bytes, { mode: 0o600 });
    signal.throwIfAborted();
    await run(adb, ["-s", deviceId, "push", localPath, temporary], signal);
    // Atomic replacement also permits another session to execute the same binary.
    await run(adb, ["-s", deviceId, "shell", `chmod 700 ${temporary} && mv ${temporary} ${remote}`], signal);
  } catch (error) {
    await run(adb, ["-s", deviceId, "shell", "rm", "-f", temporary]).catch(() => {});
    throw error;
  } finally { await rm(directory, { recursive: true, force: true }); }
  return remote;
}

export async function startAndroidCpuMonitor(options: Options, dependencies: {
  adbPath: typeof adbPath;
  deploy: (adb: string, deviceId: string, signal: AbortSignal) => Promise<string>;
  spawn?: CollectorOptions["spawn"];
}): Promise<Collector> {
  options.signal.throwIfAborted();
  const adb = await dependencies.adbPath();
  const remote = await dependencies.deploy(adb, options.deviceId, options.signal);
  const pid = String(options.pid);
  const command = nativeCollectorCommand(remote, [pid]);
  let sampler: AndroidCpuSampler | undefined;
  return startCollector({
    command: adb, args: ["-s", options.deviceId, "shell", "-T", command], signal: options.signal,
    spawn: dependencies.spawn ?? spawn, readyTimeoutMs: 10000, stallMs: 10000, killMs: 1500,
    labels: {
      exited: status => `Android CPU collector exited (${status}). The app may have stopped.`,
      timeout: stalled, stalled, cancelled: "Android CPU monitoring was cancelled.",
      invalid: message => `Invalid Android CPU stream: ${message}`,
    },
    ready(record) {
      const header = androidReadySchema.parse(record);
      if (header.pid !== options.pid) throw new Error("The Android collector selected the wrong process.");
      sampler = new AndroidCpuSampler(header.clockTicks, header.processStart);
    },
    output: { kind: "json", maxLineLength: 1024 * 1024, oversized: "Oversized Android CPU sample.", record(value) {
      if (sampler === undefined) throw new Error("The Android collector sent a sample before its header.");
      const profile = androidSampleSchema.parse(value);
      const reading = sampler.sample(profile);
      options.onSample(reading);
    } },
  });
}
