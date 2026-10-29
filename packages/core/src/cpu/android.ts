import { spawn } from "node:child_process";
import { adbPath } from "../native-logs.ts";
import type { CpuReading } from "./counters.ts";
import { AndroidCpuSampler, androidReadySchema, androidSampleSchema } from "./android-counters.ts";
import { nativeCollectorCommand } from "../native-telemetry.ts";
import { androidHelper } from "../collectors/android-helper.ts";
import type { AndroidHelper } from "../collectors/android-helper.ts";
import { startCollector } from "../collectors/process.ts";
import type { Collector, CollectorOptions } from "../collectors/process.ts";

type Options = { deviceId: string; pid: number; signal: AbortSignal; onSample: (sample: CpuReading) => void };
const stalled = "The Android CPU collector stopped responding. Reconnect the device.";

export function androidCpuCollector(root: URL): AndroidHelper {
  return androidHelper("mobile-dev-cpu", root, "Android CPU collector");
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
