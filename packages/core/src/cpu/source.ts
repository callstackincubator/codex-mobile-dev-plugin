import type { CpuTarget } from "@mobile-dev/shared/cpu.ts";
import type { CpuReading } from "./counters.ts";
import { startIosCpuMonitor } from "./monitor.ts";
import { openPhysicalDebugserver } from "./physical.ts";
import { startAndroidCpuMonitor } from "./android.ts";
import type { AndroidHelper } from "../collectors/android-helper.ts";
import { adbPath } from "../native-logs.ts";

export type CpuMonitorOptions = {
  target: CpuTarget; pid: number; signal: AbortSignal; onSample: (sample: CpuReading) => void;
};

export function startCpuMonitor(options: CpuMonitorOptions, collector: AndroidHelper) {
  if (options.target.platform === "android") {
    const deploy = (adb: string, deviceId: string, signal: AbortSignal) => collector.deploy(adb, deviceId, signal);
    const androidOptions = { ...options, deviceId: options.target.deviceId };
    return startAndroidCpuMonitor(androidOptions, { adbPath, deploy });
  }
  if (options.target.kind === "physical") {
    const open = (signal: AbortSignal) => openPhysicalDebugserver(options.target.deviceId, signal);
    return startIosCpuMonitor(options, open);
  }
  return startIosCpuMonitor(options);
}
