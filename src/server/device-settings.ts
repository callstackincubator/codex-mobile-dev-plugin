import { z } from "zod";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Baguette } from "./baguette.ts";
import { androidIdSchema, type ServeEmu } from "./serve-emu.ts";
import { errorMessage, udidSchema } from "../shared/protocol.ts";
import { contentSizes, deviceSettingSchema, locationSchema, type DeviceSetting, type DeviceSettings } from "../shared/device-settings.ts";

const targetSchema = z.discriminatedUnion("platform", [
  z.object({ platform: z.literal("ios"), id: udidSchema }).strict(),
  z.object({ platform: z.literal("android"), id: androidIdSchema }).strict(),
]);
type Target = z.infer<typeof targetSchema>;
const appearance = z.enum(["light", "dark", "auto"]);
const orientation = z.enum(["auto", "portrait", "landscape"]);

export class DeviceSettingsService {
  private readonly baguette: Baguette;
  private readonly android: ServeEmu;
  constructor(baguette: Baguette, android: ServeEmu) { this.baguette = baguette; this.android = android; }

  private iosReading(value: unknown): DeviceSettings {
    const data = z.object({ appearance: z.string(), contentSize: z.string(), increaseContrast: z.string() }).parse(value);
    return {
      locationSupported: true,
      ...(appearance.safeParse(data.appearance).success ? { appearance: data.appearance as DeviceSettings["appearance"] } : {}),
      ...(z.enum(contentSizes).safeParse(data.contentSize).success ? { contentSize: data.contentSize as DeviceSettings["contentSize"] } : {}),
      ...(["enabled", "disabled"].includes(data.increaseContrast) ? { increaseContrast: data.increaseContrast === "enabled" } : {}),
    };
  }

  async read(target: Target): Promise<DeviceSettings> {
    if (target.platform === "ios") {
      await this.baguette.device(target.id, true);
      return this.iosReading(await this.baguette.json(`/simulators/${target.id}/interface.json`));
    }
    const backend = await this.android.start(target.id);
    const settings: DeviceSettings = { locationSupported: /^emulator-\d+$/.test(target.id) };
    const reads = [
      ["Appearance", "/api/night-mode", (value: unknown) => { const data = z.object({ nightMode: z.object({ mode: z.string() }) }).parse(value); const parsed = appearance.safeParse(data.nightMode.mode); if (parsed.success) settings.appearance = parsed.data; }],
      ["Text size", "/api/font-scale", (value: unknown) => { settings.fontScale = z.object({ fontScale: z.object({ scale: z.number().min(0.7).max(2) }) }).parse(value).fontScale.scale; }],
      ["Rotation", "/api/orientation", (value: unknown) => { const data = z.object({ orientation: z.object({ orientation: z.string() }) }).parse(value); const parsed = orientation.safeParse(data.orientation.orientation); if (parsed.success) settings.orientation = parsed.data; }],
      ["Location", "/api/location", (value: unknown) => { settings.location = z.object({ location: locationSchema.loose().nullable() }).parse(value).location; }],
    ] as const;
    const results = await Promise.allSettled(reads.map(async ([, path, parse]) => parse(await this.android.json(backend.url, path))));
    const errors = results.flatMap((result, index) => result.status === "rejected" ? [`${reads[index][0]}: ${errorMessage(result.reason)}`] : []);
    if (errors.length) settings.errors = errors;
    return settings;
  }

  async update(target: Target, change: DeviceSetting): Promise<Partial<DeviceSettings>> {
    // Validate the platform before starting a backend or applying a setting.
    if (target.platform === "ios") {
      if (["fontScale", "orientation"].includes(change.setting) || change.setting === "appearance" && change.value === "auto") throw new Error("Baguette does not expose this setting.");
      await this.baguette.device(target.id, true);
      const path = `/simulators/${target.id}`;
      if (change.setting === "location") {
        await this.baguette.json(`${path}/location`, change.value === null ? { method: "DELETE" } : this.post(change.value));
        return { location: change.value };
      }
      const value = change.setting === "increaseContrast" ? (change.value ? "enabled" : "disabled") : change.value;
      const response = await this.baguette.json(`${path}/interface`, this.post({ [change.setting]: value }));
      // Baguette can report a successful write whose read-back failed.
      if (z.object({ ok: z.literal(true), applied: z.array(z.string()) }).safeParse(response).success) return this.read(target);
      return this.iosReading(response);
    }
    if (["contentSize", "increaseContrast"].includes(change.setting) || change.setting === "location" && (change.value === null || !/^emulator-\d+$/.test(target.id))) throw new Error("serve-emu does not expose this setting.");
    const backend = await this.android.start(target.id);
    switch (change.setting) {
      case "appearance": {
        const data = z.object({ nightMode: z.object({ mode: appearance }) }).parse(await this.android.json(backend.url, "/api/night-mode", this.post({ mode: change.value })));
        return { appearance: data.nightMode.mode };
      }
      case "fontScale": {
        const data = z.object({ fontScale: z.object({ scale: z.number() }) }).parse(await this.android.json(backend.url, "/api/font-scale", this.post({ scale: change.value })));
        return { fontScale: data.fontScale.scale };
      }
      case "orientation": {
        const data = z.object({ orientation: z.object({ orientation }) }).parse(await this.android.json(backend.url, "/api/orientation", this.post({ orientation: change.value })));
        return { orientation: data.orientation.orientation };
      }
      case "location": {
        const data = z.object({ location: locationSchema.loose() }).parse(await this.android.json(backend.url, "/api/location", this.post(change.value!)));
        return { location: data.location };
      }
      default: throw new Error("serve-emu does not expose this setting.");
    }
  }

  private post(body: object): RequestInit { return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }; }
}

export function registerDeviceSettingsTools(server: McpServer, baguette: Baguette, android: ServeEmu) {
  const service = new DeviceSettingsService(baguette, android);
  const annotations = { destructiveHint: false, openWorldHint: false };
  const guarded = <T>(handler: (input: T) => Promise<object>) => async (input: T) => {
    try { const settings = await handler(input); return { content: [{ type: "text" as const, text: JSON.stringify(settings) }], structuredContent: { settings } }; }
    catch (error) { return { isError: true, content: [{ type: "text" as const, text: errorMessage(error) }] }; }
  };
  registerAppTool(server, "mobile_device_settings", {
    title: "Read device settings", description: "Read the selected running device's display and location settings exposed by Baguette or serve-emu.",
    inputSchema: { target: targetSchema }, annotations: { ...annotations, readOnlyHint: true }, _meta: { ui: { visibility: ["app"] } },
  }, guarded(({ target }: { target: Target }) => service.read(target)));
  registerAppTool(server, "mobile_update_device_setting", {
    title: "Change device setting", description: "Change one supported setting on the selected running device without restarting its stream.",
    inputSchema: { target: targetSchema, change: deviceSettingSchema }, annotations: { ...annotations, readOnlyHint: false }, _meta: { ui: { visibility: ["app"] } },
  }, guarded(({ target, change }: { target: Target; change: DeviceSetting }) => service.update(target, change)));
}
