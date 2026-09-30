import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { ServeEmu, androidIdSchema } from "./serve-emu.ts";
import { AndroidStreams, androidInput } from "./android-streams.ts";
import { SimulatorUnavailableError } from "./simulator-unavailable.ts";
import { errorMessage, inputSchema } from "../shared/protocol.ts";

const sessionIdSchema = z.string().regex(/^[a-f0-9]{64}$/);
const deviceInput = { deviceId: androidIdSchema.describe("An Android serial or avd: name returned by mobile_list_android_devices.") };
const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const read = { ...write, readOnlyHint: true };
function result(data: object, text: string): CallToolResult { return { content: [{ type: "text", text }], structuredContent: { ...data } }; }
function guarded<T>(handler: (input: T) => Promise<CallToolResult>) {
  return async (input: T): Promise<CallToolResult> => {
    try { return await handler(input); }
    catch (error) { return { isError: true, content: [{ type: "text", text: errorMessage(error) }], _meta: { retryable: !(error instanceof SimulatorUnavailableError) } }; }
  };
}

export function registerAndroidTools(server: McpServer, android: ServeEmu, appUri: string, copyScreenshot: (bytes: Buffer) => Promise<void>, closeCpu: (deviceId: string) => Promise<void>) {
  const streams = new AndroidStreams(android);
  server.registerTool("mobile_list_android_devices", {
    title: "List Android devices", description: "List connected Android devices and installed AVDs without booting or streaming a device.", inputSchema: {}, annotations: read,
  }, guarded(async () => { const status = await android.list(); return result(status, status.connected ? JSON.stringify(status.devices) : status.error!); }));
  for (const action of ["boot", "shutdown"] as const) server.registerTool(`mobile_${action}_android_emulator`, {
    title: action === "boot" ? "Boot Android emulator" : "Shut down Android emulator",
    description: `${action === "boot" ? "Boot" : "Shut down"} the selected Android emulator from the device list.`,
    inputSchema: deviceInput, annotations: { ...write, destructiveHint: action === "shutdown" },
  }, guarded(async ({ deviceId }: { deviceId: string }) => {
    if (action === "shutdown") { await closeCpu(deviceId); streams.closeDevice(deviceId); }
    const status = await android[action](deviceId);
    return result(status, `${action === "boot" ? "Booted" : "Shut down"} ${deviceId}.`);
  }));
  server.registerTool("mobile_android_describe_ui", {
    title: "Read Android UI", description: "Read the selected running Android device's accessibility tree.", inputSchema: deviceInput, annotations: read,
  }, guarded(async ({ deviceId }: { deviceId: string }) => {
    const backend = await android.start(deviceId);
    const tree = await android.json(backend.url, "/api/accessibility");
    return result({ deviceId, tree }, JSON.stringify(tree));
  }));
  server.registerTool("mobile_android_send_input", {
    title: "Send Android input", description: "Send a tap, swipe, button, key, or text to the selected running Android device. Coordinates use screen pixels with matching width and height.",
    inputSchema: { ...deviceInput, input: inputSchema }, annotations: write,
  }, guarded(async ({ deviceId, input }: { deviceId: string; input: unknown }) => {
    const message = androidInput(input);
    if (message.type === "touch") throw new Error("Use tap or swipe for direct Android input. Touch events need an active panel stream.");
    const backend = await android.start(deviceId);
    const type = message.type as string;
    const path = ["home", "back", "recents", "power"].includes(type) ? "/api/key" : `/api/${type}`;
    const acknowledgement = await android.json(backend.url, path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(type === "home" || type === "back" || type === "recents" || type === "power" ? { key: type, record: false } : { ...message, record: false }) });
    return result({ deviceId, acknowledgement }, "Android accepted the input. Read the screen to confirm the result.");
  }));
  async function captureScreenshot(deviceId: string) {
    const backend = await android.start(deviceId);
    const response = await fetch(new URL("/api/screenshot", backend.url), { redirect: "error", signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Screenshot failed with HTTP ${response.status}.`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 16 * 1024 * 1024 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error("serve-emu returned an invalid or oversized PNG screenshot.");
    return bytes;
  }
  server.registerTool("mobile_android_screenshot", {
    title: "Capture Android screen", description: "Return a PNG screenshot of the selected running Android device.", inputSchema: deviceInput, annotations: read,
  }, guarded(async ({ deviceId }: { deviceId: string }) => {
    const bytes = await captureScreenshot(deviceId);
    return { content: [{ type: "image", mimeType: "image/png", data: bytes.toString("base64") }], structuredContent: { deviceId } };
  }));
  registerAppTool(server, "mobile_android_capture_screenshot", {
    title: "Android screenshot to chat and clipboard",
    description: "Capture the selected Android screen as a PNG and copy it to the clipboard. Return the image for the panel to attach to chat.",
    inputSchema: deviceInput, annotations: write, _meta: { ui: { resourceUri: appUri, visibility: ["app"] } },
  }, guarded(async ({ deviceId }: { deviceId: string }) => {
    const bytes = await captureScreenshot(deviceId);
    let copied = false;
    let clipboardError: string | undefined;
    try { await copyScreenshot(bytes); copied = true; }
    catch (error) { clipboardError = errorMessage(error); }
    return { content: [{ type: "image", mimeType: "image/png", data: bytes.toString("base64") }], structuredContent: { deviceId, copied, ...(clipboardError ? { clipboardError } : {}) } };
  }));
  server.registerResource("android-video", new ResourceTemplate("android-stream://mobile-dev/{sessionId}/video?after={sequence}", { list: undefined }), {
    mimeType: "application/json", description: "Read H.264 packets from an authorized Android panel stream.",
  }, async (uri, variables) => {
    const batch = await streams.batch(sessionIdSchema.parse(variables.sessionId), z.coerce.number().int().nonnegative().parse(variables.sequence));
    return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(batch) }] };
  });
  registerAppTool(server, "mobile_android_stream_session", {
    title: "Connect Android stream", description: "Start bundled serve-emu for the selected running device and relay H.264 through MCP.",
    inputSchema: deviceInput, annotations: write, _meta: { ui: { resourceUri: appUri, visibility: ["app"] } },
  }, guarded(async ({ deviceId }: { deviceId: string }) => {
    const definition = await android.definition(deviceId);
    const sessionId = await streams.open(deviceId);
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
  return () => { streams.close(); android.dispose(); };
}
