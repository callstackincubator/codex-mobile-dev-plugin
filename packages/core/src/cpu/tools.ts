import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { cpuTargetSchema } from "@mobile-dev/shared/cpu.ts";
import { readDeviceApps } from "../device-apps/sources.ts";
import { withDeviceAppsDiagnostic } from "@mobile-dev/shared/device-apps-diagnostics.ts";
import { registerDeviceAppsTool } from "../device-apps/tools.ts";
import type { DeviceResolver } from "../devices.ts";
import { registerSessionTools } from "../session-tools.ts";
import { jsonResult } from "../tool-results.ts";
import type { CpuSessions } from "./sessions.ts";

export function registerCpuTools(server: McpServer, cpu: CpuSessions, devices: Pick<DeviceResolver, "resolve">, { apps = readDeviceApps } = {}) {
  registerDeviceAppsTool(server, async (device, signal) => {
    await withDeviceAppsDiagnostic(() => devices.resolve(device, "cpu"), "device_validation", device.platform, device.kind);
    return apps(device.deviceId, signal, device.platform, device.kind);
  });

  registerSessionTools(server, {
    scheme: "cpu", operation: "cpu.tool", writes: true, sessions: cpu,
    resource: { name: "cpu-batch", description: "Read live process and thread CPU plus main-process memory samples from an authorized Mobile Dev performance session." },
    start: {
      name: "mobile_cpu_session", title: "Monitor native app CPU and memory", description: "Monitor process and per-thread CPU plus main-process memory once per second without an app SDK, app launch or restart. Returns sessionId and cpuUri in the tool result. Poll mobile_read_cpu with sessionId and the previous cursor as after; close with mobile_cpu_close when finished. Android uses a small external native /proc collector over ADB, without root or debugger attachment; the device must permit ADB shell to read app counters. iOS uses debugserver and requires a development-signed build with get-task-allow and no existing Xcode/LLDB attachment. Physical iOS 17.4+ also requires pairing, Developer Mode and a mounted developer disk image; pass target.kind: physical and the hardware UDID from mobile_list_ios_devices. Attach and detach briefly pause the app. 100% is one occupied device CPU core. Memory is RSS on Android and physical footprint on iOS, reported in bytes. Idle sessions expire after five minutes.",
      inputSchema: { target: cpuTargetSchema }, validate: ({ target }) => devices.resolve(target, "cpu"), open: ({ target }) => cpu.open(target),
      describe: ({ target }, sessionId, cpuUri) => jsonResult({ target, sessionId, cpuUri }),
    },
    read: { name: "mobile_read_cpu", title: "Read native CPU and memory usage", description: "Read buffered CPU and memory samples and connection status using sessionId returned by mobile_cpu_session. Pass the previous result's cursor as after to read only new samples. Each sample includes process CPU, per-thread CPU and memoryBytes for the main process. The batch memoryMetric is rss on Android or physical-footprint on iOS; 100% CPU is one core. Startup can return connecting or an initial null CPU baseline before a full sampling interval has elapsed. Memory is an absolute byte reading available from the first sample." },
    close: { name: "mobile_cpu_close", title: "Stop native CPU and memory monitor", description: "Stop the external CPU collector or detach the iOS CPU debugger, leaving the app running.", text: "CPU and memory monitor stopped." },
  });
}
