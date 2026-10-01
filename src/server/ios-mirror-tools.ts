import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

import { errorMessage } from "../shared/protocol.ts";
import { listIosDevices } from "./ios-devices.ts";
import { IosMirrorSessions } from "./ios-mirror.ts";
import { readPhysicalIosBezel } from "./physical-ios-bezel.ts";
import type { PhysicalIosBezelReader } from "./physical-ios-bezel.ts";

const sessionId = z.string().regex(/^[a-f0-9]{64}$/);
const annotations = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

export function registerIosMirrorTools(server: McpServer, appUri: string, sessions = new IosMirrorSessions(), discover = listIosDevices, readBezel: PhysicalIosBezelReader = readPhysicalIosBezel) {
  server.registerResource("ios-physical-video", new ResourceTemplate("ios-video://mobile-dev/{sessionId}/video", { list: undefined }), {
    title: "Physical iOS device video", mimeType: "application/json",
  }, async (uri, variables) => {
    const id = sessionId.parse(variables.sessionId);
    const batch = await sessions.batch(id);
    const text = JSON.stringify(batch);
    return { contents: [{ uri: uri.href, mimeType: "application/json", text }] };
  });

  registerAppTool(server, "mobile_ios_mirror_session", {
    title: "Mirror physical iOS device", description: "Open a view-only HEVC screen stream for a connected, paired iPhone or iPad over USB or Wi-Fi.",
    inputSchema: { udid: z.string().regex(/^[A-Fa-f0-9-]{8,64}$/) }, annotations, _meta: { ui: { resourceUri: appUri, visibility: ["app"] } },
  }, async ({ udid }) => {
    try {
      const devices = await discover();
      const device = devices.find(device => device.udid === udid);
      if (device === undefined || device.state !== "connected") throw new Error("The physical iOS device is no longer connected.");
      const bezel = await readBezel(device);
      const id = await sessions.open(udid);
      return { content: [{ type: "text", text: `Mirroring ${device.name}.` }], structuredContent: { name: device.name }, _meta: { bezel, sessionId: id, frameUri: `ios-video://mobile-dev/${id}/video` } };
    } catch (error) { return { isError: true, content: [{ type: "text", text: errorMessage(error) }] }; }
  });

  registerAppTool(server, "mobile_ios_mirror_reset", {
    title: "Reset physical iOS video", description: "Request a new HEVC keyframe for this mirroring session.", inputSchema: { sessionId }, annotations,
    _meta: { ui: { visibility: ["app"] } },
  }, async ({ sessionId: id }) => {
    sessions.reset(id);
    return { content: [{ type: "text", text: "Requested a keyframe." }] };
  });
  registerAppTool(server, "mobile_ios_mirror_close", {
    title: "Close physical iOS mirroring", description: "Stop the media streams owned by this mirroring session.", inputSchema: { sessionId }, annotations,
    _meta: { ui: { visibility: ["app"] } },
  }, async ({ sessionId: id }) => {
    await sessions.closeSession(id);
    return { content: [{ type: "text", text: "Mirroring closed." }] };
  });
  return () => sessions.close();
}
