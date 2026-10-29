import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { z } from "zod";
import { cpuDeviceSchema } from "@mobile-dev/shared/cpu.ts";
import type { DeviceApps } from "@mobile-dev/shared/device-apps.ts";
import { captureServerError } from "../telemetry.ts";
import { FailureEpisodes, expectedOutcome, errorMessage } from "@mobile-dev/shared/error-reporting.ts";
import { errorReportSignature } from "@mobile-dev/shared/telemetry.ts";
import { annotateDeviceAppsError, getDeviceAppsDiagnostic, DEVICE_APPS_DIAGNOSTIC_META } from "@mobile-dev/shared/device-apps-diagnostics.ts";
import { diagnosticTags } from "@mobile-dev/shared/error-diagnostics.ts";
import { guarded, jsonResult, READ_ONLY } from "../tool-results.ts";

type Device = z.infer<typeof cpuDeviceSchema>;

export function registerDeviceAppsTool(server: McpServer, discover: (device: Device, signal: AbortSignal) => Promise<DeviceApps>) {
  const episodes = new FailureEpisodes();
  const key = (device: Device) => `${device.platform}:${device.kind ?? "simulator"}:${device.deviceId}`;
  registerAppTool(server, "mobile_performance_sources", {
    title: "Find running apps and the foreground app",
    description: "List running user apps on a booted iOS simulator or connected Android device, or running development apps on a paired physical iPhone. Marks the foreground app on every platform and returns foregroundApp separately from eligible monitoring apps. iOS foregroundApp includes the screen-owning PID; bundleId is null if it is outside the eligible app list. Android returns the top resumed activity package and its main process PID, including apps outside that list. For physical iOS pass kind: physical and the hardware UDID from mobile_list_ios_devices. Does not launch apps or attach a debugger.",
    inputSchema: cpuDeviceSchema,
    annotations: READ_ONLY,
    _meta: { ui: { visibility: ["app", "model"] } },
  }, guarded<Device>({
    operation: "device_apps.discover",
    // Reports the first failure of each continuous episode per device; repeats are only counted.
    capture: (error, device, { signal }) => {
      const annotated = annotateDeviceAppsError(error, "discovery", device.platform, device.kind);
      const tags = diagnosticTags(annotated);
      const signature = errorReportSignature(annotated, tags);
      const expected = expectedOutcome(annotated);
      if (expected !== undefined) episodes.recover(key(device));
      const report = signal.aborted || expected !== undefined || episodes.shouldReport(key(device), signature);
      captureServerError(annotated, "device_apps.discover", { report, signal });
    },
    meta: (error, device) => ({ [DEVICE_APPS_DIAGNOSTIC_META]: getDeviceAppsDiagnostic(annotateDeviceAppsError(error, "discovery", device.platform, device.kind)) }),
  }, async (device, context) => {
    const data = await discover(device, context.signal);
    episodes.recover(key(device));
    return jsonResult({ ...data });
  }));
}
