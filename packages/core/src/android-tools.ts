import { parseResourceInput } from "./resource-input.ts";
import { openRequestSession } from "./request-session.ts";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { ServeEmu, androidIdSchema } from "./serve-emu.ts";
import { AndroidStreams } from "./android-streams.ts";
import type { DeviceSessions } from "./device-sessions.ts";
import { inputSchema } from "@mobile-dev/shared/protocol.ts";
import { sessionIdSchema } from "./session-registry.ts";
import { guarded as guardedTool, jsonResult, READ_ONLY as read, WRITES as write } from "./tool-results.ts";
import type { ServerRequestContext } from "./request-session.ts";
import { assertPng, MAX_SCREENSHOT_BYTES, screenshotResult } from "./png.ts";

const deviceInput = { deviceId: androidIdSchema.describe("An Android serial or avd: name returned by mobile_list_android_devices.") };
function result(data: object, text: string): CallToolResult { return jsonResult({ ...data }, text); }
const guarded = <T>(handler: (input: T, context: ServerRequestContext) => Promise<CallToolResult>) => guardedTool({ operation: "android.tool", retryable: true }, handler);

export function registerAndroidTools(server: McpServer, android: ServeEmu, appUri: string, copyScreenshot: (bytes: Buffer) => Promise<void>, devices: DeviceSessions) {
  const streams = new AndroidStreams(android);
  devices.add(deviceId => streams.closeDevice(deviceId));
  server.registerTool("mobile_list_android_devices", {
    title: "List Android devices", description: "Discover physical Android devices over USB or Wi-Fi and list running emulators and installed AVDs through ADB. Returns device kind, serial, model when available, transport for physical devices, and device/offline/unauthorized state (authorized devices use Booted). Listing does not boot, pair, authorize, or stream a device.", inputSchema: {}, annotations: read,
  }, guarded(async () => { const status = await android.list(); return result(status, status.connected ? JSON.stringify(status.devices) : status.error!); }));
  for (const action of ["boot", "shutdown"] as const) server.registerTool(`mobile_${action}_android_emulator`, {
    title: action === "boot" ? "Boot Android emulator" : "Shut down Android emulator",
    description: action === "boot"
      ? "Boot an installed Android AVD chosen for the app task. Follow the user's choice or choose a suitable AVD from the list when none runs. Reuse a suitable running device. Use the returned running serial for later calls."
      : "Shut down the selected Android emulator from the device list.",
    inputSchema: deviceInput, annotations: { ...write, destructiveHint: action === "shutdown" },
  }, guarded(async ({ deviceId }: { deviceId: string }) => {
    if (action === "shutdown") await devices.closeDevice(deviceId);
    const status = await android[action](deviceId);
    return result(status, `${action === "boot" ? "Booted" : "Shut down"} ${deviceId}.`);
  }));
  // The panel's annotations fall back to this tree; the agent reads screens with device_snapshot.
  registerAppTool(server, "mobile_android_describe_ui", {
    title: "Read Android UI", description: "Read the selected running Android device's accessibility tree. Bounds use full-resolution display pixels; screen gives the active display width and height.",
    inputSchema: deviceInput, annotations: read, _meta: { ui: { visibility: ["app"] } },
  }, guarded(async ({ deviceId }: { deviceId: string }) => {
    const { tree, screen } = await android.accessibility(deviceId);
    return result({ deviceId, tree, screen }, JSON.stringify({ tree, screen }));
  }));
  async function captureScreenshot(deviceId: string) {
    const backend = await android.start(deviceId);
    const response = await fetch(new URL("/api/screenshot", backend.url), { redirect: "error", signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Screenshot failed with HTTP ${response.status}.`);
    return assertPng(Buffer.from(await response.arrayBuffer()), MAX_SCREENSHOT_BYTES, "serve-emu");
  }
  registerAppTool(server, "mobile_android_capture_screenshot", {
    title: "Android screenshot to chat and clipboard",
    description: "Capture the selected Android screen as a PNG and copy it to the clipboard. Return the image for the panel to attach to chat.",
    inputSchema: deviceInput, annotations: write, _meta: { ui: { resourceUri: appUri, visibility: ["app"] } },
  }, guarded(async ({ deviceId }: { deviceId: string }) => {
    const bytes = await captureScreenshot(deviceId);
    return screenshotResult(bytes, { deviceId }, { copy: copyScreenshot, operation: "android.clipboard" });
  }));
  server.registerResource("android-video", new ResourceTemplate("android-stream://mobile-dev/{sessionId}/video?after={sequence}", { list: undefined }), {
    mimeType: "application/json", description: "Read H.264 packets from an authorized Android panel stream.",
  }, async (uri, variables, extra) => {
    const id = parseResourceInput(sessionIdSchema, variables.sessionId);
    const cursorSchema = z.coerce.number().int().nonnegative();
    const after = parseResourceInput(cursorSchema, variables.sequence);
    const batch = await streams.batch(id, after, extra.signal);
    return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(batch) }] };
  });
  registerAppTool(server, "mobile_android_stream_session", {
    title: "Connect Android stream", description: "Start bundled serve-emu for the selected running device and relay H.264 through MCP.",
    inputSchema: deviceInput, annotations: write, _meta: { ui: { resourceUri: appUri, visibility: ["app"] } },
  }, guarded(async ({ deviceId }: { deviceId: string }, context) => {
    context.signal.throwIfAborted();
    const definition = await android.definition(deviceId);
    const sessionId = await openRequestSession(context.signal, () => streams.open(deviceId), id => streams.closeSession(id));
    return { ...result({ deviceId, definition }, `Stream ready for ${definition.identity.name}.`), _meta: { sessionId, frameUri: `android-stream://mobile-dev/${sessionId}/video?after=0` } };
  }));
  registerAppTool(server, "mobile_android_stream_input", {
    title: "Send Android panel input", description: "Send validated input to an authorized Android panel stream.",
    inputSchema: { sessionId: sessionIdSchema, messages: z.array(inputSchema).min(1).max(64) }, annotations: write, _meta: { ui: { visibility: ["app"] } },
  }, guarded(async ({ sessionId, messages }: { sessionId: string; messages: unknown[] }) => result({ accepted: await streams.input(sessionId, messages) }, "Input sent to Android.")));
  registerAppTool(server, "mobile_android_stream_reset", {
    title: "Recover Android video", description: "Request a fresh H.264 keyframe for an authorized panel stream without restarting the device or replaying input.",
    inputSchema: { sessionId: sessionIdSchema }, annotations: write, _meta: { ui: { visibility: ["app"] } },
  }, guarded(async ({ sessionId }: { sessionId: string }) => { await streams.reset(sessionId); return result({}, "Requested a fresh Android video frame."); }));
  registerAppTool(server, "mobile_android_stream_close", {
    title: "Close Android panel stream", description: "Close one panel stream and leave its Android device running.",
    inputSchema: { sessionId: sessionIdSchema }, annotations: write, _meta: { ui: { visibility: ["app"] } },
  }, guarded(async ({ sessionId }: { sessionId: string }) => { streams.closeSession(sessionId); return result({}, "Android stream closed."); }));
  return () => { streams.close(); };
}
