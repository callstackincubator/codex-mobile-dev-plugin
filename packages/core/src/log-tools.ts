import { ExpectedOperationError } from "@mobile-dev/shared/error-reporting.ts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import type { Simctl } from "./simctl.ts";
import type { LogSessions } from "./log-sessions.ts";
import { logOptionsSchema } from "@mobile-dev/shared/logs.ts";
import type { LogOptions } from "@mobile-dev/shared/logs.ts";
import { errorMessage, parseBaseUrl } from "@mobile-dev/shared/protocol.ts";
import { listAndroidLogDevices } from "./native-logs.ts";
import { metroTargets } from "./metro-logs.ts";
import { listIosDevices } from "./ios-devices.ts";
import { physicalIosLogDevice } from "./physical-ios-logs.ts";
import { sessionIdSchema } from "./session-registry.ts";
import { registerSessionTools } from "./session-tools.ts";
import { guarded, jsonResult, READ_ONLY } from "./tool-results.ts";

const metadata = { ui: { visibility: ["app", "model"] as ("app" | "model")[] } };

export function registerLogTools(server: McpServer, logs: LogSessions, simulators: Pick<Simctl, "device">, discoverIosDevices = listIosDevices) {
  registerAppTool(server, "mobile_log_sources", {
    title: "Find log sources", description: "List connected Android devices and inspector targets at an existing local Metro URL. Does not start a dev server. Select a target explicitly before streaming Metro logs.",
    inputSchema: { metroUrl: z.string().max(2048).optional() }, annotations: READ_ONLY, _meta: metadata,
  }, guarded("logs.tool", async ({ metroUrl }: { metroUrl?: string }) => {
    const errors: string[] = [];
    const android = await listAndroidLogDevices().catch(error => { errors.push(`Android: ${errorMessage(error)}`); return []; });
    const metro = metroUrl ? await metroTargets(metroUrl).then(targets => targets.map(({ webSocketDebuggerUrl, ...target }) => target))
      .catch(error => { errors.push(`Metro: ${errorMessage(error)}`); return []; }) : [];
    return jsonResult({ android, metro, errors });
  }));

  async function validate(options: LogOptions) {
    if (options.native?.platform === "ios") {
      if (options.native.kind === "physical") await physicalIosLogDevice(options.native.deviceId, discoverIosDevices);
      else await simulators.device(options.native.deviceId, true);
    }
    if (options.native?.platform === "android" && !(await listAndroidLogDevices()).some(device => device.id === options.native?.deviceId)) {
      throw new ExpectedOperationError("device_unavailable", "The selected Android device is absent or unauthorized. Refresh log sources.");
    }
    if (options.metro) parseBaseUrl(options.metro.url, "Metro URL");
  }
  registerSessionTools(server, {
    scheme: "logs", operation: "logs.tool", writes: false, sessions: logs,
    resource: { name: "log-batch", description: "Read a batch from an authorized Mobile Dev log session. Idle sessions expire after five minutes." },
    start: {
      name: "mobile_logs_session", title: "Start app logs",
      description: "Stream iOS simulator or physical-device unified logs, Android logcat, and/or a selected Metro inspector's JS console and exceptions. For a physical iPhone, use kind physical and the hardware UDID from mobile_list_ios_devices, not its CoreDevice ID. The phone must be connected and paired. Use an iOS executable name for process, or pid for one process lifetime; choose only one. Use an Android packageName to follow the app across restarts. Leaving the app filter empty includes all device processes. iOS unified logs exclude ordinary print/printf output and may redact private values. Metro URL must be local HTTP and targetId must come from mobile_log_sources. Does not launch or rebuild the app.",
      inputSchema: { options: logOptionsSchema }, validate: ({ options }) => validate(options), open: ({ options }) => logs.open(options),
      describe: ({ options }, sessionId, logsUri) => {
        const handles = { sessionId, logsUri };
        // Models need the handle for subsequent reads; _meta is only for the app.
        return { ...jsonResult({ options, ...handles }, JSON.stringify({ status: "started", ...handles })), _meta: handles };
      },
    },
    read: { name: "mobile_read_logs", title: "Read app logs", description: "Read buffered logs and source connection status from a Mobile Dev log session. Returns up to 100 records and a cursor for the next read." },
    between: () => registerAppTool(server, "mobile_logs_keep_alive", {
      title: "Keep buffered app logs alive", description: "Keep an existing log session collecting in the plugin while its UI is hidden, without transferring log entries.",
      inputSchema: { sessionId: sessionIdSchema }, annotations: READ_ONLY, _meta: { ui: { visibility: ["app"] } },
    }, guarded("logs.tool", async ({ sessionId: id }: { sessionId: string }) => {
      logs.keepAlive(id);
      return { content: [], structuredContent: {} };
    })),
    close: { name: "mobile_logs_close", title: "Stop app logs", description: "Stop one log session's native reader and Metro connection without stopping the app, device, or Metro server.", text: "Log stream stopped." },
  });
}
