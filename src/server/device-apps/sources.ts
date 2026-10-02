import type { DeviceApps, ForegroundApp } from "../../shared/device-apps.ts";
import { runningDeviceApps } from "./apps.ts";
import { foregroundPhysicalPid, foregroundSimulatorPid, foregroundAndroidApp } from "./foreground.ts";

const defaultSources = {
  apps: runningDeviceApps,
  physical: foregroundPhysicalPid,
  simulator: foregroundSimulatorPid,
  android: foregroundAndroidApp,
};

export async function readDeviceApps(deviceId: string, signal?: AbortSignal,
  platform: "ios" | "android" = "ios", kind?: "simulator" | "physical",
  sources = defaultSources): Promise<DeviceApps> {
  const running = sources.apps(deviceId, signal, platform, kind);
  if (platform === "android") {
    const detection = sources.android(deviceId, signal);
    const [apps, foregroundApp] = await Promise.all([running, detection]);
    const marked = apps.map(candidate => ({ ...candidate, foreground: candidate.pid === foregroundApp?.pid }));
    return { apps: marked, foregroundApp };
  }
  const detection = kind === "physical" ? sources.physical(deviceId, signal) : sources.simulator(deviceId, signal);
  const [apps, pid] = await Promise.all([running, detection]);
  const app = apps.find(candidate => candidate.pid === pid);
  const foregroundApp: ForegroundApp | null = pid === null ? null : { bundleId: app?.bundleId ?? null, pid };
  const marked = apps.map(candidate => ({ ...candidate, foreground: candidate.pid === pid }));
  return { apps: marked, foregroundApp };
}
