import { z } from "zod";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Baguette } from "./baguette.ts";
import { androidIdSchema, type ServeEmu } from "./serve-emu.ts";
import { AndroidNetworkThrottle } from "./network-throttle.ts";
import { captureServerError } from "./telemetry.ts";
import { errorMessage, udidSchema } from "../shared/protocol.ts";
import { ExpectedOperationError, expectedOutcome } from "../shared/error-reporting.ts";
import { contentSizes, deviceSettingSchema, locationSchema, networkConditions, networkPresets, type DeviceSetting, type DeviceSettings, type NetworkPreset } from "../shared/device-settings.ts";

const targetSchema = z.discriminatedUnion("platform", [
  z.object({ platform: z.literal("ios"), id: udidSchema }).strict(),
  z.object({ platform: z.literal("android"), id: androidIdSchema }).strict(),
]);
type Target = z.infer<typeof targetSchema>;
const appearance = z.enum(["light", "dark", "auto"]);
const orientation = z.enum(["auto", "portrait", "landscape"]);
const unsupported = (backend: string) => new ExpectedOperationError("invalid_input", `${backend} does not expose this setting.`);

// Baguette names its presets; the numbers in networkPresets match them.
const baguetteNetworkSchema = z.object({ active: z.boolean(), profile: z.string().nullish(), offline: z.boolean().optional() }).loose();
function iosNetwork(value: unknown): DeviceSettings["network"] {
  const data = baguetteNetworkSchema.parse(value);
  if (!data.active) return "normal";
  if (data.offline) return "offline";
  return data.profile && data.profile in networkPresets ? data.profile as NetworkPreset : "custom";
}
// A clean status bar is the marketing one: 9:41, full battery, full signal.
const cleanIosStatusBar = { time: "9:41", batteryState: "charged", batteryLevel: 100, wifiMode: "active", wifiBars: 3, cellularMode: "active", cellularBars: 4, operatorName: "" };

const radiosSchema = z.object({ network: z.object({ enabled: z.boolean().nullable() }).loose() });
const radiosOff = (value: unknown) => radiosSchema.parse(value).network.enabled === false;
const isEmulator = (id: string) => /^emulator-\d+$/.test(id);

export class DeviceSettingsService {
  private readonly baguette: Baguette;
  private readonly android: ServeEmu;
  readonly throttle: AndroidNetworkThrottle;
  constructor(baguette: Baguette, android: ServeEmu, throttle = new AndroidNetworkThrottle()) { this.baguette = baguette; this.android = android; this.throttle = throttle; }

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
      const path = `/simulators/${target.id}`;
      // The status bar and network are optional extras; a failure there keeps the display controls.
      const [display, statusBar, network] = await Promise.allSettled([
        this.baguette.json(`${path}/interface.json`),
        this.baguette.json(`${path}/status-bar`).then(value => Object.keys(z.record(z.string(), z.unknown()).parse(value)).length > 0 ? "clean" as const : "live" as const),
        this.baguette.json(`${path}/network`).then(iosNetwork),
      ]);
      if (display.status === "rejected") throw display.reason;
      const settings: DeviceSettings = { ...this.iosReading(display.value), networkConditions: [...networkConditions] };
      const errors: string[] = [];
      if (statusBar.status === "fulfilled") settings.statusBar = statusBar.value;
      else errors.push(`Status bar: ${errorMessage(statusBar.reason)}`);
      if (network.status === "fulfilled") settings.network = network.value;
      else errors.push(`Network: ${errorMessage(network.reason)}`);
      if (errors.length) settings.errors = errors;
      return settings;
    }
    const backend = await this.android.start(target.id);
    const settings: DeviceSettings = { locationSupported: isEmulator(target.id), networkConditions: [...networkConditions] };
    const get = (path: string) => this.android.json(backend.url, path);
    const reads: [string, () => Promise<void>][] = [
      ["Appearance", async () => { const data = z.object({ nightMode: z.object({ mode: z.string() }) }).parse(await get("/api/night-mode")); const parsed = appearance.safeParse(data.nightMode.mode); if (parsed.success) settings.appearance = parsed.data; }],
      ["Text size", async () => { settings.fontScale = z.object({ fontScale: z.object({ scale: z.number().min(0.7).max(2) }) }).parse(await get("/api/font-scale")).fontScale.scale; }],
      ["Rotation", async () => { const data = z.object({ orientation: z.object({ orientation: z.string() }) }).parse(await get("/api/orientation")); const parsed = orientation.safeParse(data.orientation.orientation); if (parsed.success) settings.orientation = parsed.data; }],
      ["Location", async () => { settings.location = z.object({ location: locationSchema.loose().nullable() }).parse(await get("/api/location")).location; }],
      ["Status bar", async () => { settings.statusBar = z.object({ statusBar: z.object({ mode: z.enum(["clean", "live"]) }) }).parse(await get("/api/status-bar")).statusBar.mode; }],
      ["Network", async () => {
        const [radios, throttle] = await Promise.all([get("/api/network"), this.throttle.read(target.id)]);
        // A proxy the user set up shows as custom; this panel leaves it alone.
        settings.network = radiosOff(radios) ? "offline" : "foreignProxy" in throttle ? "custom" : throttle.preset ?? "normal";
      }],
    ];
    const results = await Promise.allSettled(reads.map(([, read]) => read()));
    const errors = results.flatMap((result, index) => result.status === "rejected" ? [`${reads[index][0]}: ${errorMessage(result.reason)}`] : []);
    if (errors.length) settings.errors = errors;
    return settings;
  }

  async update(target: Target, change: DeviceSetting): Promise<Partial<DeviceSettings>> {
    // Validate the platform before starting a backend or applying a setting.
    if (target.platform === "ios") {
      if (["fontScale", "orientation"].includes(change.setting) || change.setting === "appearance" && change.value === "auto") throw unsupported("Baguette");
      await this.baguette.device(target.id, true);
      const path = `/simulators/${target.id}`;
      if (change.setting === "location") {
        await this.baguette.json(`${path}/location`, change.value === null ? { method: "DELETE" } : this.post(change.value));
        return { location: change.value };
      }
      if (change.setting === "statusBar") {
        await this.baguette.json(`${path}/status-bar`, change.value === "live" ? { method: "DELETE" } : this.post(cleanIosStatusBar));
        return { statusBar: change.value };
      }
      if (change.setting === "network") {
        // Conditioning is injected into apps at launch, so Baguette keeps it until it is cleared.
        if (change.value === "normal") { await this.baguette.json(`${path}/network`, { method: "DELETE" }); return { network: "normal" }; }
        return { network: iosNetwork(await this.baguette.json(`${path}/network`, this.post(change.value === "offline" ? { offline: true } : { profile: change.value }))) };
      }
      const value = change.setting === "increaseContrast" ? (change.value ? "enabled" : "disabled") : change.value;
      const response = await this.baguette.json(`${path}/interface`, this.post({ [change.setting]: value }));
      // Baguette can report a successful write whose read-back failed.
      if (z.object({ ok: z.literal(true), applied: z.array(z.string()) }).safeParse(response).success) return this.read(target);
      return this.iosReading(response);
    }
    if (["contentSize", "increaseContrast"].includes(change.setting) || change.setting === "location" && (change.value === null || !isEmulator(target.id))) throw unsupported("serve-emu");
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
      case "statusBar": {
        const data = z.object({ statusBar: z.object({ mode: z.enum(["clean", "live"]) }) }).parse(await this.android.json(backend.url, "/api/status-bar", this.post({ mode: change.value })));
        return { statusBar: data.statusBar.mode };
      }
      case "network": {
        // Offline turns the radios off; the presets slow traffic through a proxy on the Mac.
        const preset: NetworkPreset | null = change.value === "normal" || change.value === "offline" ? null : change.value;
        const throttle = await this.throttle.set(target.id, preset);
        // Toggling the radios restarts Wi-Fi, so they change only when going offline or coming back.
        const goOffline = change.value === "offline";
        if (radiosOff(await this.android.json(backend.url, "/api/network")) !== goOffline) await this.android.json(backend.url, "/api/network", this.post({ enabled: !goOffline }));
        // Going back to normal keeps the user's own proxy, which reads as custom.
        return { network: !goOffline && "foreignProxy" in throttle ? "custom" : change.value };
      }
      default: throw unsupported("serve-emu");
    }
  }

  private post(body: object): RequestInit { return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }; }
}

export function registerDeviceSettingsTools(server: McpServer, baguette: Baguette, android: ServeEmu) {
  const service = new DeviceSettingsService(baguette, android);
  const annotations = { destructiveHint: false, openWorldHint: false };
  // Backend messages can contain device IDs, so Sentry receives only the setting name.
  const guarded = <T>(action: (input: T) => string, handler: (input: T) => Promise<object>) => async (input: T) => {
    try { const settings = await handler(input); return { content: [{ type: "text" as const, text: JSON.stringify(settings) }], structuredContent: { settings } }; }
    catch (error) {
      // Expected outcomes carry fixed reasons and are counted without a report.
      captureServerError(expectedOutcome(error) === undefined ? new Error("Device setting command failed.") : error, `device_settings.${action(input)}`);
      return { isError: true, content: [{ type: "text" as const, text: errorMessage(error) }] };
    }
  };
  registerAppTool(server, "mobile_device_settings", {
    title: "Read device settings", description: "Read the selected running device's display, location, status bar, and network settings exposed by Baguette or serve-emu.",
    inputSchema: { target: targetSchema }, annotations: { ...annotations, readOnlyHint: true }, _meta: { ui: { visibility: ["app"] } },
  }, guarded<{ target: Target }>(() => "read", ({ target }) => service.read(target)));
  registerAppTool(server, "mobile_update_device_setting", {
    title: "Change device setting", description: "Change one supported setting on the selected running device without restarting its stream.",
    inputSchema: { target: targetSchema, change: deviceSettingSchema }, annotations: { ...annotations, readOnlyHint: false }, _meta: { ui: { visibility: ["app"] } },
  }, guarded<{ target: Target; change: DeviceSetting }>(({ change }) => change.setting, ({ target, change }) => service.update(target, change)));
  const stopRecovery = android.onStart(serial => {
    service.throttle.recover(serial).catch(() => captureServerError(new Error("Network throttle recovery failed."), "device_settings.network_recovery"));
  });
  // Android throttling must be undone before the plugin exits, or the device keeps a dead proxy.
  return () => { stopRecovery(); return service.throttle.close(); };
}
