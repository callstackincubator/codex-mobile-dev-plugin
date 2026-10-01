import type { CpuApp } from "../../shared/cpu.ts";
import { runningCpuApps } from "./apps.ts";
import { foregroundPhysicalPid } from "./foreground.ts";

export async function runningPerformanceApps(deviceId: string, signal?: AbortSignal,
  platform: "ios" | "android" = "ios", kind?: "simulator" | "physical",
  sources = { apps: runningCpuApps, foreground: foregroundPhysicalPid }): Promise<CpuApp[]> {
  const running = sources.apps(deviceId, signal, platform, kind);
  if (platform !== "ios" || kind !== "physical") return running;
  const foreground = sources.foreground(deviceId, signal);
  const [apps, pid] = await Promise.all([running, foreground]);
  return apps.map(app => ({ ...app, foreground: app.pid === pid }));
}
