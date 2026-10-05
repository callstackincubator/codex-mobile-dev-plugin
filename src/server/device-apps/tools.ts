import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { z } from "zod";
import { cpuDeviceSchema } from "../../shared/cpu.ts";
import type { DeviceApps } from "../../shared/device-apps.ts";
import { errorMessage } from "../../shared/protocol.ts";
import { captureServerError } from "../telemetry.ts";
import { FailureEpisodes, expectedOutcome } from "../../shared/error-reporting.ts";
import { errorReportSignature } from "../../shared/telemetry.ts";
import { deviceAppsDiagnosticTags, annotateDeviceAppsError, getDeviceAppsDiagnostic, DEVICE_APPS_DIAGNOSTIC_META } from "../../shared/device-apps-diagnostics.ts";

type Device = z.infer<typeof cpuDeviceSchema>;

export function registerDeviceAppsTool(server: McpServer, discover: (device: Device, signal: AbortSignal) => Promise<DeviceApps>) {
  const episodes = new FailureEpisodes();
  registerAppTool(server, "mobile_performance_sources", {
    title: "Find running apps and the foreground app",
    description: "List running user apps on a booted iOS simulator or connected Android device, or running development apps on a paired physical iPhone. Marks the foreground app on every platform and returns foregroundApp separately from eligible monitoring apps. iOS foregroundApp includes the screen-owning PID; bundleId is null if it is outside the eligible app list. Android returns the top resumed activity package and its main process PID, including apps outside that list. For physical iOS pass kind: physical and the hardware UDID from mobile_list_ios_devices. Does not launch apps or attach a debugger.",
    inputSchema: cpuDeviceSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: { ui: { visibility: ["app", "model"] } },
  }, async (device, context) => {
    const key = `${device.platform}:${device.kind ?? "simulator"}:${device.deviceId}`;
    try {
      const data = await discover(device, context.signal);
      episodes.recover(key);
      const text = JSON.stringify(data);
      return { content: [{ type: "text", text }], structuredContent: data };
    } catch (error) {
      const annotated = annotateDeviceAppsError(error, "discovery", device.platform, device.kind);
      const tags = deviceAppsDiagnosticTags(annotated);
      const signature = errorReportSignature(annotated, tags);
      const expected = expectedOutcome(annotated);
      if (expected !== undefined) episodes.recover(key);
      const report = context.signal.aborted || expected !== undefined || episodes.shouldReport(key, signature);
      captureServerError(annotated, "device_apps.discover", { report, signal: context.signal });
      const diagnostic = getDeviceAppsDiagnostic(annotated);
      const message = errorMessage(error);
      return { isError: true, content: [{ type: "text", text: message }],
        _meta: { [DEVICE_APPS_DIAGNOSTIC_META]: diagnostic } };
    }
  });
}
