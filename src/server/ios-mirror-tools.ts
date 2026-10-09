import { parseResourceInput } from "./resource-input.ts";
import { openRequestSession } from "./request-session.ts";
import { ExpectedOperationError } from "../shared/error-reporting.ts";
import { IosMirrorInputBusyError } from "../shared/ios-mirror-errors.ts";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

import { errorMessage, touchInputSchema } from "../shared/protocol.ts";
import { listIosDevices } from "./ios-devices.ts";
import { IosMirrorSessions } from "./ios-mirror.ts";
import { readPhysicalIosBezel } from "./physical-ios-bezel.ts";
import type { PhysicalIosBezelReader } from "./physical-ios-bezel.ts";
import { copyPNGToClipboard } from "./clipboard.ts";
import { captureServerError } from "./telemetry.ts";

const sessionId = z.string().regex(/^[a-f0-9]{64}$/);
const annotations = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const maxPngBytes = 16 * 1024 * 1024;
const maxPngBase64Groups = Math.ceil(maxPngBytes / 3);
const maxPngBase64Length = maxPngBase64Groups * 4;
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

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
  }, async ({ udid }, context) => {
    try {
      context.signal.throwIfAborted();
      const devices = await discover();
      const device = devices.find(device => device.udid === udid);
      if (device === undefined || device.state !== "connected") throw new ExpectedOperationError("device_unavailable", "The physical iOS device is no longer connected.");
      const bezel = await readBezel(device);
      const id = await openRequestSession(context.signal, () => sessions.open(udid), id => sessions.closeSession(id));
      return { content: [{ type: "text", text: `Mirroring ${device.name}.` }], structuredContent: { name: device.name }, _meta: { bezel, sessionId: id, frameUri: `ios-video://mobile-dev/${id}/video` } };
    } catch (error) {
      captureServerError(error, "mobile_ios_mirror_session", { signal: context.signal });
      return { isError: true, content: [{ type: "text", text: errorMessage(error) }] };
    }
  });

  registerAppTool(server, "mobile_ios_mirror_input", {
    title: "Touch physical iOS screen", description: "Send ordered touch-down, move, and release samples to this physical iOS screen stream. Coordinates use the displayed frame dimensions.",
    inputSchema: { sessionId, generation: z.number().int().min(0), messages: z.array(touchInputSchema).min(1).max(64) }, annotations,
    _meta: { ui: { visibility: ["app"] } },
  }, async ({ sessionId: id, messages, generation }) => {
    try {
      await sessions.input(id, messages, generation);
      return { content: [{ type: "text", text: "Touch input delivered." }] };
    } catch (error) {
      const inputBusy = error instanceof IosMirrorInputBusyError;
      return { isError: true, content: [{ type: "text", text: errorMessage(error) }], _meta: { streamDisconnected: inputBusy === false, inputBusy } };
    }
  });

  registerAppTool(server, "mobile_ios_mirror_reset", {
    title: "Reset physical iOS video", description: "Request a new HEVC keyframe for this mirroring session.", inputSchema: { sessionId }, annotations,
    _meta: { ui: { visibility: ["app"] } },
  }, async ({ sessionId: id }) => {
    await sessions.reset(id);
    return { content: [{ type: "text", text: "Requested a keyframe." }] };
  });
  registerAppTool(server, "mobile_ios_mirror_capture_screenshot", {
    title: "Physical iOS screenshot to chat and clipboard",
    description: "Copy the PNG captured from this mirroring session's displayed frame to the macOS clipboard. Returns the same image for the panel to attach to the chat input.",
    inputSchema: { sessionId, image: z.string().min(1).max(maxPngBase64Length).regex(/^[A-Za-z0-9+/]+={0,2}$/) }, annotations,
    _meta: { ui: { resourceUri: appUri, visibility: ["app"] } },
  }, async ({ sessionId: id, image }) => {
    try {
      const udid = sessions.deviceId(id);
      const bytes = Buffer.from(image, "base64");
      const signature = bytes.subarray(0, 8);
      const valid = signature.equals(pngSignature);
      if (image.length % 4 !== 0 || bytes.length > maxPngBytes || valid === false) throw new Error("The panel returned an invalid or oversized PNG screenshot.");
      let copied = false;
      let clipboardError: string | undefined;
      try { await copyScreenshot(bytes); copied = true; }
      catch (error) {
        captureServerError(error, "ios-mirror.clipboard");
        clipboardError = errorMessage(error);
      }
      return {
        content: [{ type: "image", mimeType: "image/png", data: image }],
        structuredContent: { udid, copied, ...(clipboardError ? { clipboardError } : {}) },
      };
    } catch (error) {
      captureServerError(error, "mobile_ios_mirror_capture_screenshot");
      return { isError: true, content: [{ type: "text", text: errorMessage(error) }] };
    }
  });
  registerAppTool(server, "mobile_ios_mirror_close", {
    title: "Close physical iOS mirroring", description: "Close this panel’s subscription. Other panels keep mirroring the device.", inputSchema: { sessionId }, annotations,
    _meta: { ui: { visibility: ["app"] } },
  }, async ({ sessionId: id }) => {
    await sessions.closeSession(id);
    return { content: [{ type: "text", text: "Mirroring closed." }] };
  });
  return () => sessions.close();
}
