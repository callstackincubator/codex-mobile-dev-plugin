import type { CpuTarget } from "../../shared/cpu.ts";
import type { CpuReading } from "./counters.ts";
import { startIosCpuMonitor } from "./monitor.ts";
import { openPhysicalDebugserver } from "./physical.ts";
import { deployAndroidCollector, startAndroidCpuMonitor } from "./android.ts";
import type { AndroidCollector } from "./android.ts";
import { spawn } from "node:child_process";
import { adbPath } from "../native-logs.ts";

export type CpuMonitorOptions = {
  target: CpuTarget; pid: number; signal: AbortSignal; onSample: (sample: CpuReading) => void;
};

export function startCpuMonitor(options: CpuMonitorOptions, collector: AndroidCollector) {
  if (options.target.platform === "android") {
    const deploy = (adb: string, deviceId: string, signal: AbortSignal) => deployAndroidCollector(adb, deviceId, signal, collector);
    const dependencies = { adbPath, spawn, deploy };
    const androidOptions = { ...options, deviceId: options.target.deviceId };
    return startAndroidCpuMonitor(androidOptions, dependencies);
  }
  if (options.target.kind === "physical") {
    const open = (signal: AbortSignal) => openPhysicalDebugserver(options.target.deviceId, signal);
    return startIosCpuMonitor(options, open);
  }
  return startIosCpuMonitor(options);
}
