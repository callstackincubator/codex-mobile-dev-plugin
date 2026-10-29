import type { SimulatorDevice } from "@mobile-dev/shared/protocol.ts";
import { isDeviceActive } from "@mobile-dev/shared/devices.ts";
import { accessibilityScreen, screenComponents, screenSize } from "@mobile-dev/shared/screen-annotations.ts";
import { platformTools } from "./device-discovery.ts";
import type { Platform } from "./device-discovery.ts";
import type { DeviceScreen } from "./device-screen.ts";
import type { DeviceStream } from "./device-stream.ts";
import type { HostBridge } from "./host-bridge.ts";
import type { PanelContext } from "./model-context.ts";
import type { InspectedTree, ScreenCapture } from "./screen-annotations.ts";
import { encodeScreenshotAttachment } from "./screenshot-attachment.ts";
import { streamTransports, transportFor } from "./stream-transports.ts";
import { captureUiError, countUiEvent, recordUiTiming } from "./telemetry.ts";
import { callTool } from "./tool-call.ts";

/** What screen captures read: the panel's canvas, its stream and the device it shows. */
export type CaptureTarget = { app: HostBridge; platform: Platform; screen: DeviceScreen; stream: DeviceStream; selected?: SimulatorDevice };

/** The frame on screen, for a note or a mirrored iPhone's screenshot, measured in the device's units. */
export function captureScreen({ screen, stream, selected }: CaptureTarget): ScreenCapture {
  const points = stream.points;
  if (!stream.live || !screen.video || !points.width || !points.height) throw new Error("Wait for the device screen to load.");
  const started = performance.now();
  let data: string;
  try { data = screen.capture(); }
  finally { recordUiTiming("ui.screenshot.capture", performance.now() - started); }
  const units = selected ? streamTransports[transportFor(selected)].units : "points";
  return { screenshot: { id: crypto.randomUUID(), data, capturedAt: new Date().toISOString() }, screen: { ...points, units } };
}

/** The components Select can pick: the app's inspected tree, or the device's accessibility tree when inspection fails. */
export async function readScreenTree({ app, platform, stream }: CaptureTarget, simulator: SimulatorDevice, capturedWidth?: number): Promise<InspectedTree> {
  if (streamTransports[transportFor(simulator)].touchOnly) return { tree: [] };
  const screenWidth = capturedWidth ?? stream.points.width;
  const startedAt = performance.now();
  try {
    try {
      const result = await callTool(app, { name: "mobile_inspect_ui", arguments: { platform, deviceId: simulator.udid, deviceName: simulator.name, screenWidth } }, { timeout: 10000 });
      const content = result.structuredContent;
      if (!content?.tree) throw new Error("Component inspection returned no tree.");
      const runtime = content.runtime;
      if (runtime && typeof runtime === "object" && "available" in runtime && runtime.available === true) countUiEvent("ui.annotations.runtime_available");
      if (runtime && typeof runtime === "object" && "truncated" in runtime && runtime.truncated === true) countUiEvent("ui.annotations.inspection_truncated");
      return { tree: content.tree, screen: screenSize(content.screen) };
    } catch {
      // Hosts with an older tool list and failed inspectors can still read AX.
      countUiEvent("ui.annotations.inspection_fallback");
      const tools = platformTools[platform];
      const described = (await callTool(app, { name: tools.describe, arguments: tools.device(simulator.udid) }, { timeout: 5000 })).structuredContent;
      const screen = screenSize(described?.screen);
      if (tools.pixelBounds && screen) return { tree: screenComponents(described?.tree, screenWidth / screen.width) };
      return { tree: described?.tree, screen: accessibilityScreen(described?.tree) };
    }
  } finally { recordUiTiming("ui.annotations.inspection", performance.now() - startedAt); }
}

/** Takes the selected device's screenshot and attaches it to the chat; `attachFailed` reports an attachment the chat refused. */
export async function takeScreenshot(target: CaptureTarget, context: PanelContext, attachFailed: (message: string) => void) {
  const simulator = target.selected;
  if (!simulator || !isDeviceActive(simulator) || !context.canAttachScreenshots) return;
  const kind = transportFor(simulator);
  const transport = streamTransports[kind];
  try {
    const stream = target.stream.stream;
    let image: string | undefined;
    // A mirrored iPhone's screenshot is the frame on screen.
    if (!transport.backend) {
      if (!target.stream.live || stream?.transport !== kind) throw new Error("Wait for the device screen to load.");
      image = captureScreen(target).screenshot.data;
    }
    const result = await callTool(target.app, { name: transport.screenshot.tool, arguments: transport.screenshot.args({ device: simulator, stream, image }) }, { timeout: 30000 });
    const png = result.content.find(item => item.type === "image" && item.mimeType === "image/png");
    if (!png || png.type !== "image") throw new Error("The plugin did not return a PNG screenshot.");
    try {
      const attachment = await encodeScreenshotAttachment(png.data);
      await context.attachScreenshot({ id: crypto.randomUUID(), ...attachment, simulator });
    } catch (error) {
      captureUiError(error, "screenshot.attach");
      attachFailed("The screenshot could not be attached to chat.");
    }
  } catch (error) {
    captureUiError(error, "screenshot.capture");
  }
}
