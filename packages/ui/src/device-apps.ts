import type { HostBridge } from "./host-bridge.ts";
import type { SimulatorDevice } from "@mobile-dev/shared/protocol.ts";
import { deviceAppsSchema } from "@mobile-dev/shared/device-apps.ts";
import { installedAppsSchema } from "@mobile-dev/shared/app-control.ts";
import type { InstalledApps } from "@mobile-dev/shared/app-control.ts";
import type { DeviceApps } from "@mobile-dev/shared/device-apps.ts";
import { deviceAppsDiagnostic, setDeviceAppsDiagnostic } from "@mobile-dev/shared/device-apps-diagnostics.ts";
import { diagnosticTags } from "@mobile-dev/shared/error-diagnostics.ts";
import type { DeviceAppsStage } from "@mobile-dev/shared/device-apps-diagnostics.ts";
import { captureUiError, countUiEvent, recordUiTiming, getUiTelemetryAttributes } from "./telemetry.ts";
import { FailureEpisodes, errorCategory, setErrorCategory, errorMessage } from "@mobile-dev/shared/error-reporting.ts";
import { errorReportSignature } from "@mobile-dev/shared/telemetry.ts";
import { isDeviceActive, isPhysicalIos, sameDevice } from "@mobile-dev/shared/devices.ts";
import { Store } from "./store.ts";
import { callTool, ToolCallError } from "./tool-call.ts";

export type DeviceAppsSnapshot = DeviceApps & {
  device?: SimulatorDevice;
  discovering: boolean;
  ready: boolean;
  error: string;
};
export type DeviceAppsVisibility = {
  visibilityState: string;
  addEventListener(name: "visibilitychange", listener: () => void): void;
  removeEventListener(name: "visibilitychange", listener: () => void): void;
};
type Discovery = { abort: AbortController; done?: Promise<void> };
/** A device as the app tools name it. */
export type AppDevice = { platform: "ios" | "android"; deviceId: string };
/** The panels that remember which app they showed on each device; each weighs that pick in its own preference order. */
export type AppPanel = "performance" | "storage";

export class DeviceAppsStore extends Store<DeviceAppsSnapshot> {
  private readonly app: HostBridge;
  private readonly visibility: DeviceAppsVisibility;
  private available = false;
  private disposed = false;
  private discovery?: Discovery;
  private readonly failures = new FailureEpisodes();
  private timer?: ReturnType<typeof setInterval>;
  private readonly listings = new Map<string, Promise<InstalledApps>>();
  private readonly picks = new Map<string, string>();

  constructor(app: HostBridge, visibility: DeviceAppsVisibility) {
    super({ apps: [], foregroundApp: null, discovering: false, ready: false, error: "" });
    this.app = app;
    this.visibility = visibility;
    visibility.addEventListener("visibilitychange", this.visibilityChanged);
  }

  selectDevice(device?: SimulatorDevice) {
    const previous = this.state.device;
    const changed = !sameDevice(device, previous);
    if (changed === false) {
      if (device !== previous) this.update({ device });
      return;
    }
    this.cancel();
    this.update({ device, apps: [], foregroundApp: null, ready: false, discovering: false, error: "" });
    this.start();
  }

  setAvailable(available: boolean) {
    if (this.available === available) return;
    this.available = available;
    this.visibilityChanged();
  }

  private canDiscover() {
    const device = this.state.device;
    return this.disposed === false && this.available && this.visibility.visibilityState !== "hidden"
      && isDeviceActive(device);
  }

  private cancel() {
    this.failures.clear();
    const discovery = this.discovery;
    this.discovery = undefined;
    discovery?.abort.abort();
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private start() {
    if (this.canDiscover() === false) return;
    this.timer = setInterval(() => { void this.refresh(); }, 3000);
    void this.refresh();
  }

  private visibilityChanged = () => {
    this.cancel();
    this.update({ apps: [], foregroundApp: null, ready: false, discovering: false, error: "" });
    this.start();
  };

  refresh(): Promise<void> {
    if (this.canDiscover() === false) return Promise.resolve();
    if (this.discovery?.done) return this.discovery.done;
    const discovery: Discovery = { abort: new AbortController() };
    this.discovery = discovery;
    this.update({ discovering: true });
    discovery.done = this.discover(discovery);
    return discovery.done;
  }

  private async discover(discovery: Discovery) {
    const device = this.state.device!;
    const parameters: { deviceId: string; platform: string; kind?: "physical" } = { deviceId: device.udid, platform: device.platform };
    if (isPhysicalIos(device)) parameters.kind = "physical";
    const startedAt = performance.now();
    const telemetryContext = getUiTelemetryAttributes();
    let stage = "transport" as DeviceAppsStage;
    try {
      const result = await callTool(this.app, { name: "mobile_performance_sources", arguments: parameters }, {
        signal: discovery.abort.signal, timeout: 45000,
      }).catch(error => {
        // The server answered with its own explanation; anything else failed in transport.
        if (error instanceof ToolCallError) stage = "discovery";
        throw error;
      });
      if (this.discovery !== discovery) return;
      stage = "response";
      const data = deviceAppsSchema.parse(result.structuredContent);
      this.failures.recover("discovery");
      this.update({ ...data, ready: true, error: "" });
    } catch (error) {
      if (this.discovery !== discovery) return;
      this.update({ apps: [], foregroundApp: null, ready: false, error: errorMessage(error) });
      if (getUiTelemetryAttributes() === telemetryContext) countUiEvent("ui.device_apps.discovery_failure");
      if (stage !== "discovery") {
        const failure = new Error("Selected-device app discovery failed.");
        const category = errorCategory(error);
        setErrorCategory(failure, category);
        const diagnostic = deviceAppsDiagnostic(error, stage, device.platform, device.kind);
        setDeviceAppsDiagnostic(failure, diagnostic);
        const tags = diagnosticTags(failure);
        const signature = errorReportSignature(error, tags);
        if (this.failures.shouldReport("discovery", signature)) captureUiError(failure, "device_apps.discover", telemetryContext);
        else countUiEvent("ui.device_apps.discovery_repeated", 1, telemetryContext);
      }
    } finally {
      if (this.discovery === discovery) {
        const elapsed = performance.now() - startedAt;
        if (getUiTelemetryAttributes() === telemetryContext) recordUiTiming("ui.device_apps.discovery", elapsed);
        this.discovery = undefined;
        this.update({ discovering: false });
      }
    }
  }

  /**
   * A device's installed apps, listed again for each request so apps installed since appear.
   * Panels that ask while a listing for the same device runs share it.
   */
  installedApps({ platform, deviceId }: AppDevice): Promise<InstalledApps> {
    const key = `${platform}:${deviceId}`;
    let listing = this.listings.get(key);
    if (listing === undefined) {
      listing = callTool(this.app, { name: "mobile_list_apps", arguments: { platform, deviceId } }, { timeout: 60000, schema: installedAppsSchema })
        .finally(() => { this.listings.delete(key); });
      this.listings.set(key, listing);
    }
    return listing;
  }

  /** The app a panel last showed on a device. */
  pickedApp(panel: AppPanel, { platform, deviceId }: AppDevice) { return this.picks.get(`${panel}:${platform}:${deviceId}`); }
  pickApp(panel: AppPanel, { platform, deviceId }: AppDevice, bundleId: string) { this.picks.set(`${panel}:${platform}:${deviceId}`, bundleId); }

  dispose() {
    this.disposed = true;
    this.cancel();
    this.visibility.removeEventListener("visibilitychange", this.visibilityChanged);
    this.update({ apps: [], foregroundApp: null, ready: false, discovering: false, error: "" });
    this.close();
  }
}
