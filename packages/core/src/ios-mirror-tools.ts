import { parseResourceInput } from "./resource-input.ts";
import { openRequestSession } from "./request-session.ts";
import { ExpectedOperationError, errorMessage } from "@mobile-dev/shared/error-reporting.ts";
import { IosMirrorInputBusyError } from "@mobile-dev/shared/ios-mirror-errors.ts";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

import { touchInputSchema } from "@mobile-dev/shared/protocol.ts";
import { listIosDevices } from "./ios-devices.ts";
import { IosMirrorSessions } from "./ios-mirror.ts";
import { readPhysicalIosBezel } from "./physical-ios-bezel.ts";
import type { PhysicalIosBezelReader } from "./physical-ios-bezel.ts";
import { copyPNGToClipboard } from "./clipboard.ts";
import { sessionIdSchema as sessionId } from "./session-registry.ts";
import { guarded, WRITES as annotations } from "./tool-results.ts";
import { assertPng, MAX_SCREENSHOT_BYTES, screenshotResult } from "./png.ts";

const maxPngBase64Groups = Math.ceil(MAX_SCREENSHOT_BYTES / 3);
const maxPngBase64Length = maxPngBase64Groups * 4;
// Failures name their tool; the panel stops reconnecting only when a retry cannot help.
const guard = (operation: string) => ({ operation, retryable: true });

export function registerIosMirrorTools(server: McpServer, appUri: string, sessions = new IosMirrorSessions(), discover = listIosDevices, readBezel: PhysicalIosBezelReader = readPhysicalIosBezel, copyScreenshot = copyPNGToClipboard) {
  server.registerResource("ios-physical-video", new ResourceTemplate("ios-video://mobile-dev/{sessionId}/video", { list: undefined }), {
    title: "Physical iOS device video", mimeType: "application/json",
  }, async (uri, variables) => {
    const id = parseResourceInput(sessionId, variables.sessionId);
    const batch = await sessions.batch(id);
    const text = JSON.stringify(batch);
    return { contents: [{ uri: uri.href, mimeType: "application/json", text }] };
  });

  registerAppTool(server, "mobile_ios_mirror_session", {
    title: "Mirror physical iOS device", description: "Open an interactive HEVC screen stream for a connected, paired iPhone or iPad over USB or Wi-Fi. Supports pointer taps and drags.",
    inputSchema: { udid: z.string().regex(/^[A-Fa-f0-9-]{8,64}$/) }, annotations, _meta: { ui: { resourceUri: appUri, visibility: ["app"] } },
  }, guarded(guard("mobile_ios_mirror_session"), async ({ udid }: { udid: string }, context) => {
    context.signal.throwIfAborted();
    const devices = await discover();
    const device = devices.find(device => device.udid === udid);
    if (device === undefined || device.state !== "connected") throw new ExpectedOperationError("device_unavailable", "The physical iOS device is no longer connected.");
    const bezel = await readBezel(device);
    const id = await openRequestSession(context.signal, () => sessions.open(udid), id => sessions.closeSession(id));
    return { content: [{ type: "text", text: `Mirroring ${device.name}.` }], structuredContent: { name: device.name }, _meta: { bezel, sessionId: id, frameUri: `ios-video://mobile-dev/${id}/video` } };
  }));

  registerAppTool(server, "mobile_ios_mirror_input", {
    title: "Touch physical iOS screen", description: "Send ordered touch-down, move, and release samples to this physical iOS screen stream. Coordinates use the displayed frame dimensions.",
    inputSchema: { sessionId, generation: z.number().int().min(0), messages: z.array(touchInputSchema).min(1).max(64) }, annotations,
    _meta: { ui: { visibility: ["app"] } },
  }, guarded({
    // Input arrives with every pointer move; its failures are the panel's to recover from.
    operation: "mobile_ios_mirror_input", capture: () => {},
    meta: error => ({ streamDisconnected: error instanceof IosMirrorInputBusyError === false, inputBusy: error instanceof IosMirrorInputBusyError }),
  }, async ({ sessionId: id, messages, generation }: { sessionId: string; messages: z.infer<typeof touchInputSchema>[]; generation: number }) => {
    await sessions.input(id, messages, generation);
    return { content: [{ type: "text", text: "Touch input delivered." }] };
  }));

  registerAppTool(server, "mobile_ios_mirror_reset", {
    title: "Reset physical iOS video", description: "Request a new HEVC keyframe for this mirroring session.", inputSchema: { sessionId }, annotations,
    _meta: { ui: { visibility: ["app"] } },
  }, guarded(guard("mobile_ios_mirror_reset"), async ({ sessionId: id }: { sessionId: string }) => {
    await sessions.reset(id);
    return { content: [{ type: "text", text: "Requested a keyframe." }] };
  }));
  registerAppTool(server, "mobile_ios_mirror_capture_screenshot", {
    title: "Physical iOS screenshot to chat and clipboard",
    description: "Copy the PNG captured from this mirroring session's displayed frame to the macOS clipboard. Returns the same image for the panel to attach to the chat input.",
    inputSchema: { sessionId, image: z.string().min(1).max(maxPngBase64Length).regex(/^[A-Za-z0-9+/]+={0,2}$/) }, annotations,
    _meta: { ui: { resourceUri: appUri, visibility: ["app"] } },
  }, guarded(guard("mobile_ios_mirror_capture_screenshot"), async ({ sessionId: id, image }: { sessionId: string; image: string }) => {
    const udid = sessions.deviceId(id);
    // Unpadded base64 fails with anything else that is not a whole PNG.
    const bytes = assertPng(Buffer.from(image.length % 4 === 0 ? image : "", "base64"), MAX_SCREENSHOT_BYTES, "The panel");
    return screenshotResult(bytes, { udid }, { copy: copyScreenshot, operation: "ios-mirror.clipboard", data: image });
  }));
  registerAppTool(server, "mobile_ios_mirror_close", {
    title: "Close physical iOS mirroring", description: "Close this panel’s subscription. Other panels keep mirroring the device.", inputSchema: { sessionId }, annotations,
    _meta: { ui: { visibility: ["app"] } },
  }, guarded(guard("mobile_ios_mirror_close"), async ({ sessionId: id }: { sessionId: string }) => {
    await sessions.closeSession(id);
    return { content: [{ type: "text", text: "Mirroring closed." }] };
  }));
  return () => sessions.close();
}
