import { z } from "zod";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Baguette } from "./baguette.ts";
import { androidIdSchema, type ServeEmu } from "./serve-emu.ts";
import { AndroidNetworkThrottle, type ThrottleReading } from "./network-throttle/android.ts";
import { captureServerError } from "./telemetry.ts";
import { errorMessage, udidSchema, type SimulatorDevice } from "@mobile-dev/shared/protocol.ts";
import { ExpectedOperationError, expectedOutcome } from "@mobile-dev/shared/error-reporting.ts";
import { annotateDeviceCommand, deviceCommandTags } from "@mobile-dev/shared/device-command-diagnostics.ts";
import { contentSizes, deviceSettingSchema, locationSchema, networkPresets, type DeviceSetting, type DeviceSettings, type NetworkCondition, type NetworkPreset } from "@mobile-dev/shared/device-settings.ts";

const targetSchema = z.discriminatedUnion("platform", [
  z.object({ platform: z.literal("ios"), id: udidSchema }).strict(),
  z.object({ platform: z.literal("android"), id: androidIdSchema }).strict(),
]);
type Target = z.infer<typeof targetSchema>;
type Patch = Partial<DeviceSettings>;
const appearance = z.enum(["light", "dark", "auto"]);
const orientation = z.enum(["auto", "portrait", "landscape"]);
const unsupported = (backend: string) => new ExpectedOperationError("invalid_input", `${backend} does not expose this setting.`);
const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

// Each read fills its own settings; a failed one is listed in errors without hiding the others.
async function collect(settings: DeviceSettings, reads: Record<string, () => Promise<Patch>>): Promise<DeviceSettings> {
  const labels = Object.keys(reads);
  const results = await Promise.allSettled(Object.values(reads).map(read => read()));
  const errors = results.flatMap((result, index) => {
    if (result.status === "fulfilled") { Object.assign(settings, result.value); return []; }
    return [`${labels[index]}: ${errorMessage(result.reason)}`];
  });
  if (errors.length) settings.errors = errors;
  return settings;
}

// One platform's settings. Changes it cannot make throw before its backend starts.
interface PlatformSettings {
  read(id: string): Promise<DeviceSettings>;
  update(id: string, change: DeviceSetting): Promise<Patch>;
  // Looks the device up without starting its backend; throws an expected outcome when it stopped or went away.
  listed(id: string): Promise<SimulatorDevice>;
}

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
const iosInterfaceSchema = z.object({ appearance: z.string(), contentSize: z.string(), increaseContrast: z.string() });
const contrast = z.enum(["enabled", "disabled"]);

function iosInterface(value: unknown): Patch {
  const data = iosInterfaceSchema.parse(value);
  const mode = appearance.safeParse(data.appearance);
  const size = z.enum(contentSizes).safeParse(data.contentSize);
  const highContrast = contrast.safeParse(data.increaseContrast);
  return {
    ...(mode.success && { appearance: mode.data }),
    ...(size.success && { contentSize: size.data }),
    ...(highContrast.success && { increaseContrast: highContrast.data === "enabled" }),
  };
}

class IosSettings implements PlatformSettings {
  private readonly baguette: Baguette;
  constructor(baguette: Baguette) { this.baguette = baguette; }

  private async simulator(id: string) {
    await this.baguette.device(id, true).catch(error => { throw annotateDeviceCommand(error, "baguette_start"); });
    return `/simulators/${id}`;
  }

  listed(id: string) { return this.baguette.listedDevice(id, true); }

  async read(id: string) {
    const path = await this.simulator(id);
    // The status bar and network are optional extras; a failure there keeps the display controls.
    const [display, settings] = await Promise.all([
      this.baguette.json(`${path}/interface.json`).then(iosInterface),
      collect({ locationSupported: true }, {
        "Status bar": async () => ({ statusBar: Object.keys(z.record(z.string(), z.unknown()).parse(await this.baguette.json(`${path}/status-bar`))).length > 0 ? "clean" : "live" }),
        Network: async () => ({ network: iosNetwork(await this.baguette.json(`${path}/network`)) }),
      }),
    ]);
    return { ...settings, ...display };
  }

  async update(id: string, change: DeviceSetting): Promise<Patch> {
    switch (change.setting) {
      case "appearance":
        if (change.value === "auto") throw unsupported("Baguette");
        return this.setInterface(id, "appearance", change.value);
      case "contentSize": return this.setInterface(id, "contentSize", change.value);
      case "increaseContrast": return this.setInterface(id, "increaseContrast", change.value ? "enabled" : "disabled");
      case "location": {
        const path = await this.simulator(id);
        await this.baguette.json(`${path}/location`, change.value === null ? { method: "DELETE" } : post(change.value));
        return { location: change.value };
      }
      case "statusBar": {
        const path = await this.simulator(id);
        await this.baguette.json(`${path}/status-bar`, change.value === "live" ? { method: "DELETE" } : post(cleanIosStatusBar));
        return { statusBar: change.value };
      }
      case "network": {
        // Conditioning is injected into apps at launch, so Baguette keeps it until it is cleared.
        const path = await this.simulator(id);
        if (change.value === "normal") { await this.baguette.json(`${path}/network`, { method: "DELETE" }); return { network: "normal" }; }
        return { network: iosNetwork(await this.baguette.json(`${path}/network`, post(change.value === "offline" ? { offline: true } : { profile: change.value }))) };
      }
      default: throw unsupported("Baguette");
    }
  }

  private async setInterface(id: string, key: string, value: string): Promise<Patch> {
    const path = await this.simulator(id);
    const response = await this.baguette.json(`${path}/interface`, post({ [key]: value }));
    // Baguette can report a successful write whose read-back failed.
    if (z.object({ ok: z.literal(true), applied: z.array(z.string()) }).safeParse(response).success) return this.read(id);
    return iosInterface(response);
  }
}

// serve-emu reads and writes these settings through one endpoint each; a write answers like a read.
// `field` names the value in the request body; without one the value is the body.
type AndroidEndpoint = { label: string; path: string; field: string | null; patch: (response: unknown) => Patch };
const androidEndpoints: Partial<Record<DeviceSetting["setting"], AndroidEndpoint>> = {
  appearance: { label: "Appearance", path: "/api/night-mode", field: "mode", patch: response => {
    const mode = appearance.safeParse(z.object({ nightMode: z.object({ mode: z.string() }) }).parse(response).nightMode.mode);
    return mode.success ? { appearance: mode.data } : {};
  } },
  fontScale: { label: "Text size", path: "/api/font-scale", field: "scale",
    patch: response => ({ fontScale: z.object({ fontScale: z.object({ scale: z.number().min(0.7).max(2) }) }).parse(response).fontScale.scale }) },
  orientation: { label: "Rotation", path: "/api/orientation", field: "orientation", patch: response => {
    const rotation = orientation.safeParse(z.object({ orientation: z.object({ orientation: z.string() }) }).parse(response).orientation.orientation);
    return rotation.success ? { orientation: rotation.data } : {};
  } },
  location: { label: "Location", path: "/api/location", field: null,
    patch: response => ({ location: z.object({ location: locationSchema.loose().nullable() }).parse(response).location }) },
  statusBar: { label: "Status bar", path: "/api/status-bar", field: "mode",
    patch: response => ({ statusBar: z.object({ statusBar: z.object({ mode: z.enum(["clean", "live"]) }) }).parse(response).statusBar.mode }) },
};

const radiosSchema = z.object({ network: z.object({ enabled: z.boolean().nullable() }).loose() });
const radiosOff = (value: unknown) => radiosSchema.parse(value).network.enabled === false;
const isEmulator = (id: string) => /^emulator-\d+$/.test(id);
// Radios that are off read as offline, and a proxy the user set up reads as custom; the panel leaves it alone.
const androidNetwork = (offline: boolean, throttle: ThrottleReading): NetworkCondition | "custom" =>
  offline ? "offline" : "foreignProxy" in throttle ? "custom" : throttle.preset ?? "normal";

class AndroidSettings implements PlatformSettings {
  private readonly android: ServeEmu;
  private readonly throttle: AndroidNetworkThrottle;
  constructor(android: ServeEmu, throttle: AndroidNetworkThrottle) { this.android = android; this.throttle = throttle; }

  private async backend(id: string) {
    const backend = await this.android.start(id).catch(error => { throw annotateDeviceCommand(error, "serve_emu_start"); });
    return backend.url;
  }

  listed(id: string) { return this.android.device(id, true); }

  async read(id: string) {
    const url = await this.backend(id);
    const reads: Record<string, () => Promise<Patch>> = {};
    for (const { label, path, patch } of Object.values(androidEndpoints)) reads[label] = async () => patch(await this.android.json(url, path));
    reads.Network = async () => {
      const [radios, throttle] = await Promise.all([this.android.json(url, "/api/network"), this.throttle.read(id)]);
      return { network: androidNetwork(radiosOff(radios), throttle) };
    };
    return collect({ locationSupported: isEmulator(id) }, reads);
  }

  async update(id: string, change: DeviceSetting): Promise<Patch> {
    if (change.setting === "network") return { network: await this.setNetwork(id, change.value) };
    const endpoint = androidEndpoints[change.setting];
    // Only emulators take a simulated location, and serve-emu cannot clear it.
    if (!endpoint || change.setting === "location" && (change.value === null || !isEmulator(id))) throw unsupported("serve-emu");
    const url = await this.backend(id);
    return endpoint.patch(await this.android.json(url, endpoint.path, post(endpoint.field ? { [endpoint.field]: change.value } : change.value)));
  }

  // Offline turns the radios off; the presets slow traffic through a proxy on the Mac.
  private async setNetwork(id: string, condition: NetworkCondition) {
    const url = await this.backend(id);
    const offline = condition === "offline";
    const throttle = await this.throttle.set(id, condition === "normal" || offline ? null : condition);
    // Toggling the radios restarts Wi-Fi, so they change only when going offline or coming back.
    if (radiosOff(await this.android.json(url, "/api/network")) !== offline) await this.android.json(url, "/api/network", post({ enabled: !offline }));
    return androidNetwork(offline, throttle);
  }
}

export class DeviceSettingsService {
  readonly throttle: AndroidNetworkThrottle;
  private readonly platforms: Record<Target["platform"], PlatformSettings>;

  constructor(baguette: Baguette, android: ServeEmu, throttle = new AndroidNetworkThrottle()) {
    this.throttle = throttle;
    this.platforms = { ios: new IosSettings(baguette), android: new AndroidSettings(android, throttle) };
  }

  read(target: Target) { return this.checked(target, platform => platform.read(target.id)); }
  update(target: Target, change: DeviceSetting) { return this.checked(target, platform => platform.update(target.id, change)); }

  // A request that failed because the device stopped or went away is an expected outcome, not a backend
  // failure. A device list that cannot be read says nothing about the device, so the original failure stands.
  private async checked<T>(target: Target, work: (platform: PlatformSettings) => Promise<T>): Promise<T> {
    const platform = this.platforms[target.platform];
    try { return await work(platform); }
    catch (error) {
      if (expectedOutcome(error) !== undefined) throw error;
      const gone = await platform.listed(target.id).then(() => undefined, (lookup: unknown) => lookup);
      throw expectedOutcome(gone) === undefined ? error : gone;
    }
  }
}

export function registerDeviceSettingsTools(server: McpServer, baguette: Baguette, android: ServeEmu) {
  const service = new DeviceSettingsService(baguette, android);
  const annotations = { destructiveHint: false, openWorldHint: false };
  // Backend messages can contain device IDs, so Sentry receives the setting name and how its request failed.
  const guarded = <T extends { target: Target }>(action: (input: T) => string, handler: (input: T) => Promise<object>) => async (input: T) => {
    try { const settings = await handler(input); return { content: [{ type: "text" as const, text: JSON.stringify(settings) }], structuredContent: { settings } }; }
    catch (error) {
      // Expected outcomes carry fixed reasons and are counted without a report.
      captureServerError(error, `device_settings.${action(input)}`, {
        reportAs: new Error("Device setting command failed."), tags: { device_platform: input.target.platform, ...deviceCommandTags(error) },
      });
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
    // A device that went away is an expected outcome; the next backend start checks it again.
    service.throttle.recover(serial).catch(error => captureServerError(error, "device_settings.network_recovery", {
      reportAs: new Error("Network throttle recovery failed."), tags: { device_platform: "android", ...deviceCommandTags(error) },
    }));
  });
  // Android throttling must be undone before the plugin exits, or the device keeps a dead proxy.
  return () => { stopRecovery(); return service.throttle.close(); };
}
