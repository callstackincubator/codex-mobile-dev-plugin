import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { z } from "zod";
import { adbPath } from "../native-logs.ts";
import type { CpuReading } from "./counters.ts";
import type { CpuMonitor } from "./monitor.ts";
import { AndroidCpuSampler, androidReadySchema, androidSampleSchema } from "./android-counters.ts";
import { errorMessage } from "../../shared/protocol.ts";

const execute = promisify(execFile);
const abiSchema = z.enum(["arm64-v8a", "armeabi-v7a", "x86", "x86_64"]);
const releaseSchema = z.object({ binaries: z.record(abiSchema, z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/) })) });
export type AndroidCollector = ReadonlyMap<z.infer<typeof abiSchema>, { bytes: Buffer; sha256: string }>;
type Options = { deviceId: string; pid: number; signal: AbortSignal; onSample: (sample: CpuReading) => void };
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
    if (sha256 !== release.binaries[abi].sha256) throw new Error(`The bundled Android CPU collector failed its integrity check for ${abi}.`);
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

export async function startAndroidCpuMonitor(options: Options,
  dependencies: { adbPath: typeof adbPath; deploy: (adb: string, deviceId: string, signal: AbortSignal) => Promise<string>; spawn: typeof spawn }): Promise<CpuMonitor> {
  options.signal.throwIfAborted();
  const adb = await dependencies.adbPath();
  const remote = await dependencies.deploy(adb, options.deviceId, options.signal);
  options.signal.throwIfAborted();
  const child = dependencies.spawn(adb, ["-s", options.deviceId, "shell", "-T", `exec ${remote} ${options.pid}`], {
    stdio: ["pipe", "pipe", "pipe"], shell: false,
  });
  let finish!: (error: Error) => void;
  const closed = new Promise<Error>(resolve => { finish = resolve; });
  let accept!: () => void;
  const ready = new Promise<void>(resolve => { accept = resolve; });
  let exited!: () => void;
  const exit = new Promise<void>(resolve => { exited = resolve; });
  let sampler: AndroidCpuSampler | undefined;
  let stopping: Promise<void> | undefined;
  let diagnostics = "";
  let pending = "";
  const decoder = new StringDecoder("utf8");
  let watchdog: NodeJS.Timeout;
  const deadline = () => {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => fail(new Error("The Android CPU collector stopped responding. Reconnect the device.")), 10000);
    watchdog.unref();
  };
  const stop = (): Promise<void> => {
    if (stopping) return stopping;
    stopping = (async () => {
      clearTimeout(watchdog);
      options.signal.removeEventListener("abort", abort);
      child.stdin?.end("stop\n");
      const kill = setTimeout(() => child.kill("SIGKILL"), 1500);
      kill.unref();
      try { await exit; } finally { clearTimeout(kill); }
    })();
    return stopping;
  };
  const fail = (error: Error) => { finish(error); void stop(); };
  const abort = () => fail(new Error("Android CPU monitoring was cancelled."));
  child.stdin?.on("error", error => { if (stopping === undefined) fail(error); });
  child.once("error", error => { exited(); fail(error); });
  child.once("close", (code, signal) => {
    exited();
    clearTimeout(watchdog);
    options.signal.removeEventListener("abort", abort);
    finish(new Error(diagnostics.trim() || `Android CPU collector exited (${code ?? signal}). The app may have stopped.`));
  });
  child.stderr?.on("data", (chunk: Buffer) => { diagnostics = (diagnostics + chunk.toString()).slice(-4096); });
  child.stdout?.on("data", (chunk: Buffer) => {
    if (stopping) return;
    pending += decoder.write(chunk);
    if (pending.length > 1024 * 1024) { fail(new Error("Oversized Android CPU sample.")); return; }
    let newline: number;
    while ((newline = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      try {
        const json: unknown = JSON.parse(line);
        if (sampler === undefined) {
          const header = androidReadySchema.parse(json);
          if (header.pid !== options.pid) throw new Error("The Android collector selected the wrong process.");
          sampler = new AndroidCpuSampler(header.clockTicks, header.processStart);
          accept();
        } else {
          const profile = androidSampleSchema.parse(json);
          const reading = sampler.sample(profile);
          options.onSample(reading);
        }
        deadline();
      } catch (error) { fail(new Error(`Invalid Android CPU stream: ${errorMessage(error)}`)); return; }
    }
  });
  options.signal.addEventListener("abort", abort, { once: true });
  deadline();
  if (options.signal.aborted) abort();
  const result = await Promise.race([ready, closed]);
  if (result instanceof Error) { await stop(); throw result; }
  return { closed, stop };
}
