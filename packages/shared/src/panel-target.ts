import { z } from "zod";
import type { SimulatorDevice } from "./protocol.ts";

const platform = z.enum(["ios", "android"]).optional().describe("The task's established platform. Omit when undecided.");
const kind = z.enum(["simulator", "emulator", "physical"]).optional().describe("The requested device kind. Omit when undecided.");
export const deviceIdSchema = z.string().min(1).max(256).regex(/^[A-Za-z0-9_.:\[\]%-]+$/).describe("An exact device ID from device discovery. Omit to select a matching device automatically.");
const workspaceTool = z.enum(["logs", "performance", "storage", "app-intel", "tracesift", "testing"]).optional().describe("A workspace tool to open. Use testing to open the Testing Studio tab, whether the panel is closed or already open. Omit for the device view.");
const appIntelScreen = z.string().min(1).max(512).optional().describe("An App Intelligence screen ID to focus when workspaceTool is app-intel, from mobile_app_intel's search or screen result. Omit to open on whatever screen the panel last showed.");

const projectPath = z.string().max(4096).optional().describe("With workspaceTool testing: the absolute path of the chat's workspace root (its working directory), so the Testing Studio tab follows the chat. A folder that is not a project selects No project. Pass an empty string when the chat has no project. Omit only when you cannot tell.");

export const panelTargetSchema = z.object({ platform, kind, deviceId: deviceIdSchema.optional(), workspaceTool, appIntelScreen, projectPath }).strict().superRefine((target, context) => {
  if (target.platform === "ios" && target.kind === "emulator" || target.platform === "android" && target.kind === "simulator") {
    context.addIssue({ code: "custom", path: ["kind"], message: "Use simulator for iOS or emulator for Android." });
  }
});

/**
 * Whether the Testing Studio panel can record against a device: a booted iOS simulator or a booted
 * Android emulator. Anything physical is out, because agent-device's session on a physical
 * device is not the one the mirror holds.
 */
/** The platform the recorder attaches with. A simulator listing that omits `platform` is iOS. */
export function recordablePlatform(device: SimulatorDevice): "ios" | "android" {
  return device.platform === "android" ? "android" : "ios";
}

export function isRecordableDevice(device?: SimulatorDevice): boolean {
  if (!device || device.state !== "Booted" || device.kind === "physical") return false;
  return device.platform === "android" ? device.kind === "emulator" : device.platform === "ios" || device.platform === undefined;
}

export type PanelTarget = z.infer<typeof panelTargetSchema>;

export function panelTargetPlatform(target: PanelTarget): "ios" | "android" | undefined {
  if (target.platform !== undefined) return target.platform;
  if (target.kind === "simulator") return "ios";
  if (target.kind === "emulator") return "android";
}

/**
 * Where the opening tools of a panel that does not render inline name their page, a
 * `{ resourceUri }` that MCP Apps hosts ignore and the browser panel reads.
 */
export const PANEL_PAGE_META = "mobile-dev/panel";

/** How often the open Testing Studio tab re-sends its selection, so the server can tell a closed tab from an idle one. */
export const PANEL_HEARTBEAT_MS = 5_000;
