import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Baguette } from "./baguette.ts";
import type { ServeEmu } from "./serve-emu.ts";
import { inspectReactNative } from "./react-native-inspector.ts";
import { captureServerError } from "./telemetry.ts";
import { errorMessage, udidSchema } from "../shared/protocol.ts";

const execute = promisify(execFile);

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
      let deviceAliases: string[] = [];
      let native: unknown, appName: string | undefined, appId: string | undefined;
      if (platform === "ios") {
        const device = await baguette.device(udidSchema.parse(deviceId), true);
        deviceName = device.name;
        const response = await baguette.json(`/simulators/${deviceId}/describe-ui.json`);
        native = response;
        appName = typeof response.tree?.label === "string" ? response.tree.label : undefined;
      } else {
        const backend = await android.start(deviceId);
        const response = await android.json(backend.url, "/api/accessibility");
        native = response;
        const packages = new Set<string>((response.nodes ?? []).map((item: { packageName?: string }) => item.packageName).filter((name: unknown): name is string => typeof name === "string" && !name.startsWith("com.android.") && name !== "android"));
        if (packages.size === 1) appId = [...packages][0];
        try {
          const properties = await Promise.all(["ro.product.model", "ro.build.version.release", "ro.build.version.sdk"].map(property =>
            execute("adb", ["-s", deviceId, "shell", "getprop", property], { timeout: 3000, maxBuffer: 4096 }).then(result => result.stdout.trim())));
          if (properties.every(Boolean)) deviceAliases = [properties[0], `${properties[0]} - ${properties[1]} - API ${properties[2]}`];
        } catch { /* The backend's device name remains available for matching. */ }
      }
      let runtime: Awaited<ReturnType<typeof inspectReactNative>>;
      try {
        runtime = await inspectReactNative({ url: metroUrl, targetId, deviceName, deviceAliases, appName, appId, platform, screenWidth }, controller.signal);
      } catch {
        // Metro is optional. Native apps, absent servers and reloads retain AX selection.
        runtime = { available: false, reason: "inspector-unavailable" };
      }
      const data = { tree: runtime.available ? [runtime.tree, native] : native, runtime: { available: runtime.available, truncated: runtime.available ? runtime.truncated : false } };
      return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
    } catch (error) {
      captureServerError(error, "inspection.tool");
      return { isError: true, content: [{ type: "text", text: errorMessage(error) }] };
    }
  });
  return () => controller.abort();
}
