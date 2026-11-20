import { z } from "zod";
import type { ServerFeature } from "@mobile-dev/core/server-feature.ts";
import { panelSelectionSchema } from "../shared/panel-selection.ts";
import type { PanelSelection } from "../shared/panel-selection.ts";

function threadId(meta: Record<string, unknown> | undefined) {
  const id = meta?.threadId;
  if (typeof id !== "string" || id.length === 0) throw new Error("Codex did not identify the chat for this panel selection.");
  return id;
}

export const panelSelection: ServerFeature = server => {
  const threads = new Map<string, Map<string, PanelSelection>>();
  const selection = panelSelectionSchema.shape;
  server.registerTool("mobile_set_panel_selection", {
    title: "Report the panel’s selected devices",
    description: "Replace this panel’s active and visible devices. Omit devices when closing the panel.",
    inputSchema: { panelId: z.string().min(1), devices: selection.devices.optional(), activeDeviceId: selection.activeDeviceId },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { ui: { visibility: ["app"] } },
  }, ({ panelId, devices, activeDeviceId }, extra) => {
    const id = threadId(extra._meta);
    let panels = threads.get(id);
    const activeVisible = devices?.some(item => item.deviceId === activeDeviceId);
    if (activeDeviceId !== undefined && activeVisible !== true) {
      throw new Error("The active device must be visible in this panel.");
    }
    // Map insertion order keeps the most recently reported panel last.
    panels?.delete(panelId);
    if (devices !== undefined) {
      if (panels === undefined) {
        panels = new Map();
        threads.set(id, panels);
      }
      const reported = activeDeviceId === undefined ? { devices } : { devices, activeDeviceId };
      panels.set(panelId, reported);
    } else if (panels?.size === 0) {
      threads.delete(id);
    }
    return { content: [] };
  });
  server.registerTool("mobile_read_panel_context", {
    title: "Read the panel’s selected devices",
    description: "Read the active and visible devices from the Mobile Dev panel in this chat before device work. If multiple panels are open, this returns the most recently reported selection.",
    inputSchema: {},
    outputSchema: selection,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, (_input, extra) => {
    const id = threadId(extra._meta);
    const panels = threads.get(id);
    let latest: PanelSelection | undefined;
    if (panels) {
      for (const reported of panels.values()) latest = reported;
    }
    const text = latest === undefined ? "No Mobile Dev panel has reported a selection in this chat." : JSON.stringify(latest);
    return { content: [{ type: "text", text }], structuredContent: latest ?? { devices: [] } };
  });
};
