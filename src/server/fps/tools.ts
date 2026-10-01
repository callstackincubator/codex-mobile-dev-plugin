import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { displayFpsTargetSchema } from "../../shared/display-fps.ts";
import type { DisplayFpsTarget } from "../../shared/display-fps.ts";
import { errorMessage } from "../../shared/protocol.ts";
import { listIosDevices } from "../ios-devices.ts";
import { listAndroidLogDevices } from "../native-logs.ts";
import type { DisplayFpsSessions } from "./sessions.ts";

const sessionString = z.string();
const sessionId = sessionString.regex(/^[a-f0-9]{64}$/);
const coercedNumber = z.coerce.number();
const coercedInteger = coercedNumber.int();
const nonnegativeInteger = coercedInteger.nonnegative();
const sequence = nonnegativeInteger.max(Number.MAX_SAFE_INTEGER);
const afterNumber = z.number();
const afterInteger = afterNumber.int();
const nonnegativeAfter = afterInteger.nonnegative();
const boundedAfter = nonnegativeAfter.max(Number.MAX_SAFE_INTEGER);
const afterSchema = boundedAfter.default(0);
const visibility: ("app" | "model")[] = ["app", "model"];
const metadata = { ui: { visibility } };
const read = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const write = { ...read, readOnlyHint: false };
function safe<T>(handler: (input: T) => Promise<CallToolResult>) {
  return async (input: T): Promise<CallToolResult> => {
    try { return await handler(input); }
    catch (error) { return { isError: true, content: [{ type: "text", text: errorMessage(error) }] }; }
  };
}

export function registerDisplayFpsTools(server: McpServer, sessions: DisplayFpsSessions,
  sources = { ios: listIosDevices, android: listAndroidLogDevices }) {
  async function validate(target: DisplayFpsTarget) {
    if (target.platform === "android") {
      const devices = await sources.android();
      if (devices.some(device => device.id === target.deviceId) === false) throw new Error("Connect and authorize the Android device through ADB.");
      return;
    }
    const devices = await sources.ios();
    const device = devices.find(device => device.udid === target.deviceId);
    if (device === undefined) throw new Error("Display FPS is available on physical iOS devices, not simulators.");
    if (device.state !== "connected") throw new Error("Connect the paired iPhone to monitor Display FPS.");
  }
  const template = new ResourceTemplate("display-fps://mobile-dev/{sessionId}/batch?after={sequence}", { list: undefined });
  server.registerResource("display-fps-batch", template, {
    mimeType: "application/json", description: "Read device-wide Display FPS. Samples use the server's monotonic clock in seconds.",
  }, async (uri, variables) => {
    const id = sessionId.parse(variables.sessionId);
    const after = sequence.parse(variables.sequence);
    const batch = await sessions.read(id, after);
    const text = JSON.stringify(batch);
    return { contents: [{ uri: uri.href, mimeType: "application/json", text }] };
  });
  const startSession = safe(async ({ target }: { target: DisplayFpsTarget }) => {
    await validate(target);
    const id = sessions.open(target);
    const timeOrigin = performance.now() / 1000;
    const data = { sessionId: id, timeOrigin, fpsUri: `display-fps://mobile-dev/${id}/batch?after=0` };
    const text = JSON.stringify(data);
    return { content: [{ type: "text", text }], structuredContent: data };
  });
  registerAppTool(server, "mobile_display_fps_session", {
    title: "Monitor Display FPS",
    description: "Record device-wide display updates independently of an app. Android 12+ uses Perfetto FrameTimeline actual display frames, excluding dropped frames. Physical iOS 17.4+ paired devices use the Instruments CoreAnimationFramesPerSecond counter through a bundled native helper. Requires pairing and Developer Mode; no app SDK, debugger attachment or Instruments GUI. A quiet screen can report zero. This is not the display refresh rate and cannot attribute a drop to one app. Samples use the server monotonic clock in seconds; Android readback is delayed by about three seconds. Returns sessionId, timeOrigin and fpsUri. Read with mobile_read_display_fps or fpsUri, and close with mobile_display_fps_close. Sessions expire after five minutes without reads.",
    inputSchema: { target: displayFpsTargetSchema }, annotations: write, _meta: metadata,
  }, startSession);
  const readSession = safe(async ({ sessionId: id, after }: { sessionId: string; after: number }) => {
    const batch = await sessions.read(id, after, 0);
    const text = JSON.stringify(batch);
    return { content: [{ type: "text", text }], structuredContent: { ...batch } };
  });
  registerAppTool(server, "mobile_read_display_fps", {
    title: "Read Display FPS", description: "Read complete device-wide FPS sampling intervals. Pass the previous cursor as after. Zero is a valid idle reading; null means no complete measurement. Startup returns connecting until the first measurement.",
    inputSchema: { sessionId, after: afterSchema }, annotations: read, _meta: metadata,
  }, readSession);
  const closeSession = safe(async ({ sessionId: id }: { sessionId: string }) => {
    await sessions.closeSession(id);
    return { content: [{ type: "text", text: "Display FPS monitor stopped." }], structuredContent: {} };
  });
  registerAppTool(server, "mobile_display_fps_close", {
    title: "Stop Display FPS", description: "Stop this device's FPS collector and release its tracing connection, leaving apps running.",
    inputSchema: { sessionId }, annotations: write, _meta: metadata,
  }, closeSession);
}
