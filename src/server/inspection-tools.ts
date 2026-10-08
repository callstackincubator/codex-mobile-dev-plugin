import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Baguette } from "./baguette.ts";
import type { ServeEmu } from "./serve-emu.ts";
import { inspectReactNative } from "./react-native-inspector.ts";
import type { InspectorRequest } from "./react-native-inspector.ts";
import { readDeviceApps } from "./device-apps/sources.ts";
import { captureServerError } from "./telemetry.ts";
import { errorMessage, udidSchema } from "../shared/protocol.ts";
import { accessibilityScreen, screenComponents } from "../shared/screen-annotations.ts";
import type { ScreenSize } from "../shared/screen-annotations.ts";
import { adbPath } from "./native-logs.ts";

const execute = promisify(execFile);

type NativeSnapshot = {
  native: unknown;
  app: Pick<InspectorRequest, "deviceName" | "deviceAliases" | "appName" | "appId" | "resolveForegroundAppId">;
  screen?: ScreenSize;
};

async function iosSnapshot(baguette: Baguette, deviceId: string, signal: AbortSignal): Promise<NativeSnapshot> {
  const udid = udidSchema.parse(deviceId);
  const device = await baguette.device(udid, true);
  const response = await baguette.describeUi(udid);
  return {
    native: response,
    screen: accessibilityScreen(response.tree),
    app: {
      deviceName: device.name,
      appName: typeof response.tree?.label === "string" ? response.tree.label : undefined,
      resolveForegroundAppId: async () => (await readDeviceApps(udid, signal, "ios", "simulator")).foregroundApp?.bundleId ?? undefined,
    },
  };
}

async function androidSnapshot(android: ServeEmu, deviceId: string, deviceName: string, screenWidth: number): Promise<NativeSnapshot> {
  const [response, deviceAliases] = await Promise.all([android.accessibility(deviceId), androidAliases(deviceId)]);
  const packages = new Set<string>((response.tree.nodes ?? []).map((item: { packageName?: string }) => item.packageName).filter((name: unknown): name is string => typeof name === "string" && !name.startsWith("com.android.") && name !== "android"));
  return {
    native: screenComponents(response.tree, screenWidth / response.screen.width),
    app: { deviceName, deviceAliases, appId: packages.size === 1 ? [...packages][0] : undefined },
  };
}

// Metro names Android targets by model and release rather than the backend's device name.
async function androidAliases(deviceId: string): Promise<string[]> {
  try {
    const adb = await adbPath();
    const properties = await Promise.all(["ro.product.model", "ro.build.version.release", "ro.build.version.sdk"].map(property =>
      execute(adb, ["-s", deviceId, "shell", "getprop", property], { timeout: 3000, maxBuffer: 4096 }).then(result => result.stdout.trim())));
    return properties.every(Boolean) ? [properties[0], `${properties[0]} - ${properties[1]} - API ${properties[2]}`] : [];
  } catch {
    // The backend's device name remains available for matching.
    return [];
  }
}

export function registerInspectionTools(server: McpServer, baguette: Baguette, android: ServeEmu) {
  const controller = new AbortController();
  registerAppTool(server, "mobile_inspect_ui", {
    title: "Inspect app elements",
    description: "Read native accessibility elements and, for a matching React Native development app, measured runtime component bounds through an existing local Metro debugger. Does not start Metro, modify app props or take over an exclusive debugger. iOS bounds use device points; Android bounds use screen pixels. Optional targetId selects a known Metro target explicitly.",
    inputSchema: {
      platform: z.enum(["ios", "android"]), deviceId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/), deviceName: z.string().min(1).max(256),
      screenWidth: z.number().positive().max(16384), metroUrl: z.string().max(2048).optional(), targetId: z.string().max(512).optional(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: { ui: { visibility: ["app", "model"] } },
  }, async ({ platform, deviceId, deviceName, screenWidth, metroUrl, targetId }) => {
    try {
      const { native, app, screen } = platform === "ios"
        ? await iosSnapshot(baguette, deviceId, controller.signal)
        : await androidSnapshot(android, deviceId, deviceName, screenWidth);
      let runtime: Awaited<ReturnType<typeof inspectReactNative>>;
      try {
        runtime = await inspectReactNative({ ...app, url: metroUrl, targetId, platform, screenWidth }, controller.signal);
      } catch {
        // Metro is optional. Native apps, absent servers and reloads retain AX selection.
        runtime = { available: false, reason: "inspector-unavailable" };
      }
      // Deep React trees exceed host JSON decoder limits. Keep ancestry as IDs on flat records.
      const data = { tree: screenComponents(runtime.available ? [runtime.tree, native] : native), runtime: { available: runtime.available, truncated: runtime.available ? runtime.truncated : false }, ...(screen && { screen }) };
      return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
    } catch (error) {
      captureServerError(error, "inspection.tool");
      return { isError: true, content: [{ type: "text", text: errorMessage(error) }] };
    }
  });
  return () => controller.abort();
}
