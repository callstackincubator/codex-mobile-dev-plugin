import { chatMessage } from "./chat-message.ts";
import type { App } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { androidChoices, devicesViewSchema, isSelectableDevice, simulatorChoices } from "../shared/device-choice.ts";
import type { DeviceChoice, DevicesView } from "../shared/device-choice.ts";
import type { Status } from "../shared/protocol.ts";
import { captureUiError, countUiEvent, markUiSurfaceReady, recordUiTiming, setUiGauge, setUiSurface, setUiTelemetryContext } from "./telemetry.ts";

type DevicesState = {
  view?: DevicesView;
  devices: DeviceChoice[];
  selected: ReadonlySet<string>;
  pendingKey: string;
  canMessage: boolean;
  sending: boolean;
  sent: boolean;
  error: string;
};

export function deviceKey(device: Pick<DeviceChoice, "platform" | "deviceId">) { return `${device.platform}:${device.deviceId}`; }
export function canBootDevice(device: DeviceChoice) { return device.kind !== "physical" && device.state === "Shutdown"; }
export function canStopDevice(device: DeviceChoice) {
  if (device.state !== "Booted") return false;
  return device.platform === "ios" ? device.kind === "simulator" : device.kind === "emulator" && /^emulator-\d+$/.test(device.deviceId);
}
export function deviceKindLabel(device: DeviceChoice) {
  const platform = device.platform === "ios" ? "iOS" : "Android";
  return `${platform} ${device.kind === "physical" ? "device" : device.kind}`;
}

export class DevicesController {
  private readonly app: App;
  private state: DevicesState = { devices: [], selected: new Set(), pendingKey: "", canMessage: false, sending: false, sent: false, error: "" };
  private listeners = new Set<() => void>();
  private disposed = false;
  private readyAt = performance.now();

  constructor(app: App) { this.app = app; }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  getSnapshot = () => this.state;
  private update(next: Partial<DevicesState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }
  get choosing() { return this.state.view !== undefined && "mode" in this.state.view && this.state.view.mode === "choose"; }
  canSelect(device: DeviceChoice) {
    const view = this.state.view;
    if (view === undefined || "action" in view || this.state.sent) return false;
    return view.mode === "browse" || isSelectableDevice(device);
  }
  hostChanged() {
    const capabilities = this.app.getHostCapabilities();
    const canMessage = Boolean(capabilities?.message?.text);
    this.update({ canMessage });
  }
  accept(result: CallToolResult) {
    if (this.disposed) return;
    if (result.isError) {
      const texts = result.content.filter(item => item.type === "text");
      const error = texts.map(item => item.text).join("\n");
      this.update({ error });
      return;
    }
    if (result.structuredContent?.devices === undefined) return;
    const startedAt = performance.now();
    const view = devicesViewSchema.parse(result.structuredContent);
    setUiSurface("devices");
    const platforms = new Set(view.devices.map(device => device.platform));
    const [platform] = platforms;
    setUiTelemetryContext({ device_platform: platforms.size === 1 ? platform : "mixed", device_kind: "none" });
    setUiGauge("ui.devices.count", view.devices.length);
    this.update({ view, devices: view.devices as DeviceChoice[], selected: new Set(), sent: false, error: "" });
    recordUiTiming("ui.devices.process", performance.now() - startedAt);
    markUiSurfaceReady(this.readyAt);
  }
  toggle = (device: DeviceChoice) => {
    if (this.canSelect(device) === false) return;
    const key = deviceKey(device);
    const view = this.state.view;
    const single = view !== undefined && "mode" in view && view.selectionMode === "single";
    const selected = new Set(single ? [] : this.state.selected);
    if (this.state.selected.has(key)) selected.delete(key);
    else selected.add(key);
    this.update({ selected });
  };
  boot = (device: DeviceChoice) => this.changeState(device, "boot");
  stop = (device: DeviceChoice) => this.changeState(device, "shutdown");
  private async changeState(device: DeviceChoice, action: "boot" | "shutdown") {
    const allowed = action === "boot" ? canBootDevice(device) : canStopDevice(device);
    if (allowed === false || this.state.pendingKey || this.disposed) return;
    const key = deviceKey(device);
    this.update({ pendingKey: key, error: "" });
    const event = action === "boot" ? "ui.devices.boot" : "ui.devices.stop";
    try {
      const ios = device.platform === "ios";
      const name = ios ? `mobile_${action}_simulator` : `mobile_${action}_android_emulator`;
      const result = await this.app.callServerTool({ name, arguments: ios ? { udid: device.deviceId } : { deviceId: device.deviceId } }, { timeout: 150_000 });
      if (result.isError) {
        const texts = result.content.filter(item => item.type === "text");
        throw new Error(texts.map(item => item.text).join("\n") || `Could not ${action === "boot" ? "boot" : "stop"} ${device.name}.`);
      }
      const status = result.structuredContent as Status;
      this.refresh(ios ? simulatorChoices(status) : androidChoices(status), device.platform);
      countUiEvent(event);
    } catch (error) {
      countUiEvent(`${event}_failed`);
      this.update({ error: error instanceof Error ? error.message : `Could not change ${device.name}.` });
    } finally { this.update({ pendingKey: "" }); }
  }
  // An Android AVD gets a new serial when it boots, so emulators also match by AVD name.
  private refresh(fresh: DeviceChoice[], platform: DeviceChoice["platform"]) {
    const selected = new Set(this.state.selected);
    const devices = this.state.devices.map(device => {
      if (device.platform !== platform || device.kind === "physical" && platform === "ios") return device;
      const match = fresh.find(candidate => candidate.kind === device.kind && candidate.deviceId === device.deviceId)
        ?? (device.kind === "emulator" ? fresh.find(candidate => candidate.kind === "emulator" && candidate.name === device.name) : undefined);
      if (match === undefined) return device;
      const next = { ...device, deviceId: match.deviceId, state: match.state, runtime: match.runtime } as DeviceChoice;
      if (selected.delete(deviceKey(device))) selected.add(deviceKey(next));
      return next;
    });
    this.update({ devices, selected });
  }
  async send() {
    const { devices, selected, canMessage, sending } = this.state;
    const chosen = devices.filter(device => selected.has(deviceKey(device)));
    if (chosen.length === 0 || canMessage === false || sending || this.disposed) return;
    this.update({ sending: true, error: "" });
    const items = chosen.map(device => `${device.name} (${deviceKindLabel(device)}, ID ${device.deviceId})`);
    const prompt = `Use ${items.length === 1 ? items[0] : `these devices: ${items.join(", ")}`}.`;
    const message = chatMessage(this.app, prompt);
    const startedAt = performance.now();
    try {
      const result = await this.app.sendMessage(message);
      if (result.isError) throw new Error("The host could not send this choice to chat.");
      countUiEvent("ui.devices.send");
      recordUiTiming("ui.devices.message_ack", performance.now() - startedAt);
      setUiGauge("ui.devices.selected", chosen.length);
      this.update({ sent: this.choosing, selected: new Set() });
    } catch (error) {
      captureUiError(error, "devices.send");
      const text = error instanceof Error ? error.message : "Could not send this choice to chat.";
      this.update({ error: text });
    } finally { this.update({ sending: false }); }
  }
  dispose() { this.disposed = true; this.listeners.clear(); }
}
