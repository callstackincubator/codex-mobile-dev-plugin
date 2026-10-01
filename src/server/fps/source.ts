import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { DisplayFpsTarget } from "../../shared/display-fps.ts";
import { adbPath } from "../native-logs.ts";
import type { CpuMonitor } from "../cpu/monitor.ts";
import { collectorProcess } from "./process.ts";
import { deployFpsHelper } from "./android-helper.ts";
import { FrameTimeline } from "./frame-timeline.ts";
import type { FrameReading } from "./frame-timeline.ts";

const execute = promisify(execFile);
const fpsNumber = z.number();
const finiteFps = fpsNumber.finite();
const nonnegativeFps = finiteFps.min(0);
const boundedFps = nonnegativeFps.max(1000);
const fpsValue = boundedFps.nullable();
const readingObject = z.object({ fps: fpsValue });
const readingSchema = readingObject.strict();
export type FpsMonitorOptions = { target: DisplayFpsTarget; signal: AbortSignal; onSample: (reading: FrameReading) => void };

export async function startDisplayFpsMonitor(options: FpsMonitorOptions,
  iosHelper = new URL("./ios-fps/mobile-dev-ios-fps", import.meta.url),
  androidRoot = new URL("./android-fps/", import.meta.url)): Promise<CpuMonitor> {
  if (options.target.platform === "android") return startAndroid(options, androidRoot);
  if (process.platform !== "darwin") throw new Error("iPhone Display FPS requires macOS.");
  const path = fileURLToPath(iosHelper);
  await access(path);
  let pending = "";
  let previous: number | undefined;
  return collectorProcess(path, [options.target.deviceId], { signal: options.signal, data(chunk, ready) {
    pending += chunk.toString("utf8");
    if (pending.length > 65536) throw new Error("The iPhone FPS collector returned an oversized sample.");
    let newline = pending.indexOf("\n");
    while (newline >= 0) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      const decoded = JSON.parse(line);
      const reading = readingSchema.parse(decoded);
      const now = performance.now() / 1000;
      const interval = previous === undefined ? 0 : now - previous;
      const fps = interval > 0 && interval < 2.5 ? reading.fps : null;
      options.onSample({ fps, interval, recordedAt: now });
      previous = now;
      ready();
      newline = pending.indexOf("\n");
    }
  } });
}

async function startAndroid(options: FpsMonitorOptions, root: URL): Promise<CpuMonitor> {
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
  const remote = await deployFpsHelper(adb, options.target.deviceId, options.signal, root);
  let firstReady: (() => void) | undefined;
  const timeline = new FrameTimeline(reading => { options.onSample(reading); firstReady?.(); });
  return collectorProcess(adb, [...prefix, "shell", "-T", `exec ${remote}`], {
    signal: options.signal,
    data(chunk, ready) { firstReady = ready; timeline.push(chunk); },
  });
}
