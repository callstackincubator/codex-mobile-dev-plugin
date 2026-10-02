import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import type { Baguette } from "./baguette.ts";
import type { LogSessions } from "./log-sessions.ts";
import { logOptionsSchema } from "../shared/logs.ts";
import type { LogOptions } from "../shared/logs.ts";
import { errorMessage, parseBaseUrl } from "../shared/protocol.ts";
import { listAndroidLogDevices } from "./native-logs.ts";
import { metroTargets } from "./metro-logs.ts";
import { listIosDevices } from "./ios-devices.ts";
import { physicalIosLogDevice } from "./physical-ios-logs.ts";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { captureServerError } from "./telemetry.ts";

const sessionId = z.string().regex(/^[a-f0-9]{64}$/);
const sequence = z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const metadata = { ui: { visibility: ["app", "model"] as ("app" | "model")[] } };
function safe<T>(handler: (input: T) => Promise<CallToolResult>) {
  return async (input: T): Promise<CallToolResult> => {
    try { return await handler(input); }
    catch (error) {
      captureServerError(error, "logs.tool");
      return { isError: true, content: [{ type: "text", text: errorMessage(error) }] };
    }
  };
}

export function registerLogTools(server: McpServer, logs: LogSessions, baguette: Baguette, discoverIosDevices = listIosDevices) {
  server.registerResource("log-batch", new ResourceTemplate("logs://mobile-dev/{sessionId}/batch?after={sequence}", { list: undefined }), {
    mimeType: "application/json", description: "Read a batch from an authorized Mobile Dev log session. Idle sessions expire after five minutes.",
  }, async (uri, variables) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(await logs.read(sessionId.parse(variables.sessionId), sequence.parse(variables.sequence))) }] }));

  registerAppTool(server, "mobile_log_sources", {
    title: "Find log sources", description: "List connected Android devices and inspector targets at an existing local Metro URL. Does not start a dev server. Select a target explicitly before streaming Metro logs.",
    inputSchema: { metroUrl: z.string().max(2048).optional() }, annotations, _meta: metadata,
  }, safe(async ({ metroUrl }: { metroUrl?: string }) => {
    const errors: string[] = [];
    const android = await listAndroidLogDevices().catch(error => { errors.push(`Android: ${errorMessage(error)}`); return []; });
    const metro = metroUrl ? await metroTargets(metroUrl).then(targets => targets.map(({ webSocketDebuggerUrl, ...target }) => target))
      .catch(error => { errors.push(`Metro: ${errorMessage(error)}`); return []; }) : [];
    const data = { android, metro, errors };
    return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
  }));

  registerAppTool(server, "mobile_logs_session", {
    title: "Start app logs", description: "Stream iOS simulator or physical-device unified logs, Android logcat, and/or a selected Metro inspector's JS console and exceptions. For a physical iPhone, use kind physical and the hardware UDID from mobile_list_ios_devices, not its CoreDevice ID. The phone must be connected and paired. Use an iOS executable name for process, or pid for one process lifetime; choose only one. Use an Android packageName to follow the app across restarts. Leaving the app filter empty includes all device processes. iOS unified logs exclude ordinary print/printf output and may redact private values. Metro URL must be local HTTP and targetId must come from mobile_log_sources. Does not launch or rebuild the app.",
    inputSchema: { options: logOptionsSchema }, annotations, _meta: metadata,
  }, safe(async ({ options }: { options: LogOptions }) => {
    if (options.native?.platform === "ios") {
      if (options.native.kind === "physical") await physicalIosLogDevice(options.native.deviceId, discoverIosDevices);
      else await baguette.device(options.native.deviceId, true);
    }
    if (options.native?.platform === "android" && !(await listAndroidLogDevices()).some(device => device.id === options.native?.deviceId)) {
      throw new Error("The selected Android device is absent or unauthorized. Refresh log sources.");
    }
    if (options.metro) parseBaseUrl(options.metro.url, "Metro URL");
    const id = logs.open(options);
    return { content: [{ type: "text", text: "Log stream started." }], structuredContent: { options }, _meta: { sessionId: id, logsUri: `logs://mobile-dev/${id}/batch?after=0` } };
  }));

  registerAppTool(server, "mobile_read_logs", {
    title: "Read app logs", description: "Read buffered logs and source connection status from a Mobile Dev log session. Returns up to 100 records and a cursor for the next read.",
    inputSchema: { sessionId, after: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0) }, annotations, _meta: metadata,
  }, safe(async ({ sessionId: id, after }: { sessionId: string; after: number }) => {
    const batch = await logs.read(id, after, 0);
    return { content: [{ type: "text", text: JSON.stringify(batch) }], structuredContent: { ...batch } };
  }));

  registerAppTool(server, "mobile_logs_keep_alive", {
    title: "Keep buffered app logs alive", description: "Keep an existing log session collecting in the plugin while its UI is hidden, without transferring log entries.",
    inputSchema: { sessionId }, annotations, _meta: { ui: { visibility: ["app"] } },
  }, safe(async ({ sessionId: id }: { sessionId: string }) => {
    logs.keepAlive(id);
    return { content: [], structuredContent: {} };
  }));

  registerAppTool(server, "mobile_logs_close", {
    title: "Stop app logs", description: "Stop one log session's native reader and Metro connection without stopping the app, device, or Metro server.",
    inputSchema: { sessionId }, annotations, _meta: metadata,
  }, safe(async ({ sessionId: id }: { sessionId: string }) => {
    await logs.closeSession(id);
    return { content: [{ type: "text", text: "Log stream stopped." }], structuredContent: {} };
  }));
}
