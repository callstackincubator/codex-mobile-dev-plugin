import type { DeviceApps, ForegroundApp } from "../../shared/device-apps.ts";
import { runningDeviceApps } from "./apps.ts";
import { foregroundPhysicalPid, foregroundSimulatorPid, foregroundAndroidApp } from "./foreground.ts";
import { withDeviceAppsDiagnostic } from "../../shared/device-apps-diagnostics.ts";

const defaultSources = {
  apps: runningDeviceApps,
  physical: foregroundPhysicalPid,
  simulator: foregroundSimulatorPid,
  android: foregroundAndroidApp,
};

export async function readDeviceApps(deviceId: string, signal?: AbortSignal,
  platform: "ios" | "android" = "ios", kind?: "simulator" | "physical",
  sources = defaultSources): Promise<DeviceApps> {
  const running = withDeviceAppsDiagnostic(() => sources.apps(deviceId, signal, platform, kind), "running_apps", platform, kind);
  if (platform === "android") {
    const detection = withDeviceAppsDiagnostic(() => sources.android(deviceId, signal), "foreground", platform, kind);
    const [apps, foregroundApp] = await Promise.all([running, detection]);
    const marked = apps.map(candidate => ({ ...candidate, foreground: candidate.pid === foregroundApp?.pid }));
    return { apps: marked, foregroundApp };
  }
  const detect = () => kind === "physical" ? sources.physical(deviceId, signal) : sources.simulator(deviceId, signal);
  const detection = withDeviceAppsDiagnostic(detect, "foreground", platform, kind);
  const [apps, pid] = await Promise.all([running, detection]);
  const app = apps.find(candidate => candidate.pid === pid);
  const foregroundApp: ForegroundApp | null = pid === null ? null : { bundleId: app?.bundleId ?? null, pid };
  const marked = apps.map(candidate => ({ ...candidate, foreground: candidate.pid === pid }));
  return { apps: marked, foregroundApp };
}
