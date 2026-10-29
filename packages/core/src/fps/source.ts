import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { DisplayFpsTarget } from "@mobile-dev/shared/display-fps.ts";
import { adbPath } from "../native-logs.ts";
import { androidHelper } from "../collectors/android-helper.ts";
import { startCollector } from "../collectors/process.ts";
import type { Collector, CollectorOptions } from "../collectors/process.ts";
import { FrameTimeline } from "./frame-timeline.ts";
import type { FrameReading } from "./frame-timeline.ts";
import { nativeCollectorCommand } from "../native-telemetry.ts";

const execute = promisify(execFile);
const fpsNumber = z.number();
const finiteFps = fpsNumber.finite();
const nonnegativeFps = finiteFps.min(0);
const boundedFps = nonnegativeFps.max(1000);
const fpsValue = boundedFps.nullable();
const readingObject = z.object({ fps: fpsValue });
const readingSchema = readingObject.strict();
export type FpsMonitorOptions = { target: DisplayFpsTarget; signal: AbortSignal; onSample: (reading: FrameReading) => void };

const timing = { readyTimeoutMs: 15000, stallMs: 6000, killMs: 4000 } satisfies Partial<CollectorOptions>;
const labels: CollectorOptions["labels"] = {
  exited: status => `Display FPS collector exited (${status}).`,
  timeout: "The device did not produce live Display FPS samples.",
  stalled: "The device stopped sending Display FPS data. Reconnect and retry.",
};

export async function startDisplayFpsMonitor(options: FpsMonitorOptions,
  iosHelper = new URL("./ios-fps/mobile-dev-ios-fps", import.meta.url),
  androidRoot = new URL("./android-fps/", import.meta.url)): Promise<Collector> {
  if (options.target.platform === "android") return startAndroid(options, androidRoot);
  if (process.platform !== "darwin") throw new Error("iPhone Display FPS requires macOS.");
  const path = fileURLToPath(iosHelper);
  await access(path);
  let previous: number | undefined;
  const sample = (fps: number | null) => {
    const now = performance.now() / 1000;
    const interval = previous === undefined ? 0 : now - previous;
    options.onSample({ fps: interval > 0 && interval < 2.5 ? fps : null, interval, recordedAt: now });
    previous = now;
  };
  return startCollector({
    command: path, args: ["fps", options.target.deviceId], signal: options.signal, ...timing, labels,
    // The ready record starts the first interval.
    ready() { sample(null); },
    output: { kind: "json", maxLineLength: 65536, oversized: "The iPhone FPS collector returned an oversized sample.", record(value) {
      const reading = readingSchema.parse(value);
      sample(reading.fps);
    } },
  });
}

async function startAndroid(options: FpsMonitorOptions, root: URL): Promise<Collector> {
  const adb = await adbPath();
  const prefix = ["-s", options.target.deviceId];
  const settings = { timeout: 5000, maxBuffer: 1024 * 1024, signal: options.signal };
  const version = await execute(adb, [...prefix, "shell", "getprop", "ro.build.version.sdk"], settings);
  const versionText = version.stdout.trim();
  const sdk = Number(versionText);
  if (Number.isInteger(sdk) === false || sdk < 31) throw new Error("Display FPS requires Android 12 or newer (FrameTimeline).");
  const sources = await execute(adb, [...prefix, "shell", "perfetto", "--query"], settings);
  if (sources.stdout.includes("android.surfaceflinger.frametimeline") === false) {
    throw new Error("This Android device does not expose the Perfetto FrameTimeline source.");
  }
  const helper = androidHelper("mobile-dev-fps", root, "Android FPS helper");
  const remote = await helper.deploy(adb, options.target.deviceId, options.signal);
  const command = nativeCollectorCommand(remote);
  return startCollector({
    command: adb, args: [...prefix, "shell", "-T", command], signal: options.signal, ...timing, labels,
    // Startup waits for the first FrameTimeline interval, not only the helper's ready record.
    readyOnData: true,
    output: { kind: "stream", create(control, started) {
      const timeline = new FrameTimeline(reading => { options.onSample(reading); started(); }, undefined, control);
      return chunk => timeline.push(chunk);
    } },
  });
}
