import type { App } from "@modelcontextprotocol/ext-apps";
import type { SimulatorDevice } from "../shared/protocol.ts";
import { errorMessage } from "../shared/protocol.ts";
import { deviceAppsSchema } from "../shared/device-apps.ts";
import type { DeviceApps } from "../shared/device-apps.ts";
import { deviceAppsDiagnostic, setDeviceAppsDiagnostic, deviceAppsDiagnosticTags } from "../shared/device-apps-diagnostics.ts";
import type { DeviceAppsStage } from "../shared/device-apps-diagnostics.ts";
import { captureUiError, countUiEvent, recordUiTiming, getUiTelemetryAttributes } from "./telemetry.ts";
import { FailureEpisodes, errorCategory, setErrorCategory } from "../shared/error-reporting.ts";
import { errorReportSignature } from "../shared/telemetry.ts";

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

export class DeviceAppsStore {
  private readonly app: App;
  private readonly visibility: DeviceAppsVisibility;
  private available = false;
  private disposed = false;
  private discovery?: Discovery;
  private readonly failures = new FailureEpisodes();
  private timer?: ReturnType<typeof setInterval>;
  private listeners = new Set<() => void>();
  private snapshot: DeviceAppsSnapshot = { apps: [], foregroundApp: null, discovering: false, ready: false, error: "" };

  constructor(app: App, visibility: DeviceAppsVisibility) {
    this.app = app;
    this.visibility = visibility;
    visibility.addEventListener("visibilitychange", this.visibilityChanged);
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  getSnapshot = () => this.snapshot;

  private update(fields: Partial<DeviceAppsSnapshot>) {
    this.snapshot = { ...this.snapshot, ...fields };
    for (const listener of this.listeners) listener();
  }

  selectDevice(device?: SimulatorDevice) {
    const previous = this.snapshot.device;
    const changed = device?.udid !== previous?.udid || device?.platform !== previous?.platform
      || device?.kind !== previous?.kind || device?.state !== previous?.state;
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
    const device = this.snapshot.device;
    return this.disposed === false && this.available && this.visibility.visibilityState !== "hidden"
      && device !== undefined && (device.state === "Booted" || device.state === "connected");
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
    const device = this.snapshot.device!;
    const platform = device.platform ?? "ios";
    const parameters: { deviceId: string; platform: string; kind?: "physical" } = { deviceId: device.udid, platform };
    if (platform === "ios" && device.kind === "physical") parameters.kind = "physical";
    const startedAt = performance.now();
    const telemetryContext = getUiTelemetryAttributes();
    let stage: DeviceAppsStage = "transport";
    try {
      const result = await this.app.callServerTool({ name: "mobile_performance_sources", arguments: parameters }, {
        signal: discovery.abort.signal, timeout: 45000,
      });
      if (this.discovery !== discovery) return;
      if (result.isError) {
        stage = "discovery";
        const texts = result.content.filter(item => item.type === "text");
        const message = texts.map(item => item.text).join("\n");
        throw new Error(message);
      }
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
        const diagnostic = deviceAppsDiagnostic(error, stage, platform, device.kind);
        setDeviceAppsDiagnostic(failure, diagnostic);
        const tags = deviceAppsDiagnosticTags(failure);
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

  dispose() {
    this.disposed = true;
    this.cancel();
    this.visibility.removeEventListener("visibilitychange", this.visibilityChanged);
    this.update({ apps: [], foregroundApp: null, ready: false, discovering: false, error: "" });
    this.listeners.clear();
  }
}
