import { androidBookingNamesSchema, type AndroidBookingNames } from "@mobile-dev/shared/android-devices.ts";
import { physicalConnectionLabel, type PhysicalIosDevice } from "@mobile-dev/shared/ios-devices.ts";
import { errorMessage, type SimulatorDevice, type Status } from "@mobile-dev/shared/protocol.ts";
import type { HostBridge } from "./host-bridge.ts";

export type Platform = "ios" | "android";
export const platforms: readonly Platform[] = ["ios", "android"];

export function describeDevice(device: SimulatorDevice, platform: Platform, bookingNames: AndroidBookingNames = {}) {
  const physical = device.kind === "physical";
  const running = device.state === "Booted" || physical && device.state === "connected";
  const runtime = device.runtime.replace(/^com\.apple\.CoreSimulator\.SimRuntime\./, "").replace(/^(iOS|tvOS|watchOS|visionOS)-/, "$1 ").replace(/-/g, ".");
  let detail = physical ? physicalConnectionLabel(device.transportType) : runtime;
  if (physical && !running) detail += device.state === "unauthorized" ? " · Unauthorized" : " · Offline";
  const specs = detail ? `${device.name} · ${detail}` : device.name;
  const booked = platform === "android" && physical && running && Object.hasOwn(bookingNames, device.udid);
  const title = booked ? bookingNames[device.udid] : device.name;
  return {
    device, value: device.udid, title, label: booked ? title : specs, detail: booked ? specs : detail,
    group: physical ? "Connected devices" : platform === "ios" ? "Simulators" : "Emulators",
    tablet: /ipad|tablet|pixel.*tab/i.test(physical ? device.model ?? device.name : device.name),
    running, statusLabel: physical ? "Connected" : "Running",
    canStop: !physical && running && (platform === "ios" || /^emulator-\d+$/.test(device.udid)),
  };
}

export type DeviceOption = ReturnType<typeof describeDevice>;

/** One inventory per platform shares discovery and lifecycle results across all its screens. */
export class DeviceInventory {
  readonly platform: Platform;
  private readonly app: HostBridge;
  private listeners = new Set<() => void>();
  private reading?: Promise<void>;
  private revision = 0;
  private physical: PhysicalIosDevice[] = [];
  status?: Status;
  items: DeviceOption[] = [];
  error = "";

  constructor(app: HostBridge, platform: Platform) { this.app = app; this.platform = platform; }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private async call(name: string, args: Record<string, unknown> = {}, timeout?: number) {
    const result = await this.app.callServerTool({ name, arguments: args }, { timeout });
    if (result.isError) {
      const messages = result.content.flatMap(item => item.type === "text" ? [item.text] : []);
      throw new Error(messages.join("\n"));
    }
    return result;
  }

  refresh() {
    this.reading ??= this.read().finally(() => { this.reading = undefined; });
    return this.reading;
  }

  private async read() {
    const revision = this.revision;
    const android = this.platform === "android";
    const devicesRead = this.call(android ? "mobile_list_android_devices" : "mobile_list_simulators");
    const physicalRead = android ? undefined : this.call("mobile_list_ios_devices");
    const [devices, physical] = await Promise.allSettled([devicesRead, physicalRead]);
    if (revision !== this.revision) return;
    let status: Status;
    if (devices.status === "fulfilled") status = devices.value.structuredContent as Status;
    else status = { connected: false, managed: false, baseUrl: "", devices: [], error: errorMessage(devices.reason) };
    const physicalData = physical.status === "fulfilled" ? physical.value?.structuredContent as { physicalDevices: PhysicalIosDevice[] } | undefined : undefined;
    this.physical = physicalData?.physicalDevices.filter(device => device.state === "connected") ?? [];
    const errors = [status.error];
    if (physical.status === "rejected") errors.push(errorMessage(physical.reason));
    this.error = errors.filter(Boolean).join(" · ");
    this.apply(status, devices.status === "fulfilled" ? devices.value._meta?.bookingNames : undefined);
  }

  apply(status: Status, metadata?: unknown) {
    const parsed = androidBookingNamesSchema.safeParse(metadata);
    const names = parsed.success ? parsed.data : {};
    this.revision++;
    const devices = [...this.physical, ...status.devices];
    this.status = { ...status, devices };
    const sorted = [...devices].sort((a, b) => Number(b.kind === "physical") - Number(a.kind === "physical"));
    this.items = sorted.map(device => describeDevice(device, this.platform, names));
    for (const listener of this.listeners) listener();
  }

  async power(device: SimulatorDevice, boot: boolean) {
    if (device.kind === "physical") throw new Error("Only simulators and emulators can be started or stopped.");
    const android = this.platform === "android";
    const action = boot ? "boot" : "shutdown";
    const name = `mobile_${action}_${android ? "android_emulator" : "simulator"}`;
    const args = android ? { deviceId: device.udid } : { udid: device.udid };
    const timeout = boot ? 300000 : android ? 150000 : 30000;
    const result = await this.call(name, args, timeout);
    this.apply(result.structuredContent as Status, result._meta?.bookingNames);
  }
}
