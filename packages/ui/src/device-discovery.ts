import type { SimulatorDevice, Status } from "@mobile-dev/shared/protocol.ts";
import { physicalConnectionLabel } from "@mobile-dev/shared/ios-devices.ts";
import type { PhysicalIosDevice } from "@mobile-dev/shared/ios-devices.ts";
import type { PanelTarget } from "@mobile-dev/shared/panel-target.ts";
import { avdId, isEmulatorSerial, stoppedAvdName } from "@mobile-dev/shared/android-ids.ts";
import { isPhysicalIos } from "@mobile-dev/shared/devices.ts";
import { errorMessage } from "@mobile-dev/shared/error-reporting.ts";
import { physicalIosDevicesResultSchema, simulatorStatusResultSchema } from "@mobile-dev/shared/tool-results.ts";
import type { DeviceOption } from "./device-picker.ts";
import type { HostBridge } from "./host-bridge.ts";
import { callTool } from "./tool-call.ts";

export type Platform = "ios" | "android";

/** The tools that list, boot, stop and describe one platform's devices. */
export const platformTools: Record<Platform, {
  list: string; boot: string; shutdown: string; describe: string;
  /** How the device tools name a device. */
  device(id: string): Record<string, unknown>;
  /** Emulators take a new ID when they boot or stop, so the panel follows an AVD by its name. */
  renames: boolean;
  /** Accessibility bounds come in device pixels and are scaled to the captured video. */
  pixelBounds: boolean;
}> = {
  ios: { list: "mobile_list_simulators", boot: "mobile_boot_simulator", shutdown: "mobile_shutdown_simulator", describe: "mobile_describe_ui", device: udid => ({ udid }), renames: false, pixelBounds: false },
  android: { list: "mobile_list_android_devices", boot: "mobile_boot_android_emulator", shutdown: "mobile_shutdown_android_emulator", describe: "mobile_android_describe_ui", device: deviceId => ({ deviceId }), renames: true, pixelBounds: true },
};

/** A platform's listing. On iOS the paired iPhones are listed beside the simulators and can fail on their own. */
export type Discovered = { status: Status; paired?: { devices: PhysicalIosDevice[]; error: string } };

export async function discoverDevices(app: Pick<HostBridge, "callServerTool">, platform: Platform): Promise<Discovered> {
  const listing = callTool(app, { name: platformTools[platform].list, arguments: {} }, { schema: simulatorStatusResultSchema });
  if (platform === "android") return { status: await listing };
  const [simulators, physical] = await Promise.allSettled([listing, callTool(app, { name: "mobile_list_ios_devices", arguments: {} }, { schema: physicalIosDevicesResultSchema })]);
  const status: Status = simulators.status === "fulfilled" ? simulators.value : { connected: false, managed: false, baseUrl: "", devices: [], error: errorMessage(simulators.reason) };
  const errors = status.error ? [status.error] : [];
  if (physical.status === "rejected") errors.push(errorMessage(physical.reason));
  const devices = physical.status === "fulfilled" ? physical.value.physicalDevices.filter(device => device.state === "connected") : [];
  return { status, paired: { devices, error: errors.join(" · ") } };
}

/** Boots or stops a simulator or emulator, and returns the platform's listing after it. */
export function changeDeviceState(app: Pick<HostBridge, "callServerTool">, platform: Platform, action: "boot" | "shutdown", id: string): Promise<Status> {
  const tools = platformTools[platform];
  return callTool(app, { name: tools[action], arguments: tools.device(id) }, { timeout: action === "boot" ? 150000 : 30000, schema: simulatorStatusResultSchema });
}

/** The same AVD by name in a listing, after its ID changed. Only emulators rename. */
export function renamedAvd(platform: Platform, status: Status, device: SimulatorDevice, state?: string) {
  if (!platformTools[platform].renames) return;
  return status.devices.find(item => item.kind !== "physical" && item.name === device.name && (state === undefined || item.state === state));
}

/** Keeps an opening target on its AVD as the emulator boots into a serial or stops back to its avd: ID. */
export function followOpeningTarget(target: PanelTarget | undefined, next: Status, selected: SimulatorDevice | undefined, platform: Platform): PanelTarget | undefined {
  if (!target || !platformTools[platform].renames) return target;
  const opening = stoppedAvdName(target.deviceId);
  if (opening !== undefined) {
    const booted = next.devices.find(device => device.kind !== "physical" && device.name === opening && device.state === "Booted");
    return booted ? { ...target, deviceId: booted.udid } : target;
  }
  if (selected && target.deviceId === selected.udid && selected.kind !== "physical") {
    const stopped = next.devices.find(device => device.udid === avdId(selected.name) && device.state === "Shutdown");
    if (stopped) return { ...target, deviceId: stopped.udid };
  }
  return target;
}

function runtimeLabel(runtime: string) {
  return runtime.replace(/^com\.apple\.CoreSimulator\.SimRuntime\./, "").replace(/^(iOS|tvOS|watchOS|visionOS)-/, "$1 ").replace(/-/g, ".");
}

/** The picker's entries: connected hardware first, then simulators or emulators. */
export function deviceOptions(status: Status, physical: readonly PhysicalIosDevice[], platform: Platform): DeviceOption[] {
  const paired: DeviceOption[] = physical.map(device => ({
    value: device.udid, label: `${device.name} · ${physicalConnectionLabel(device.transportType)}`, group: "Connected devices",
    kind: /ipad/i.test(device.model) ? "tablet" : "phone", running: true, statusLabel: "Connected", canStop: false,
  }));
  const wired: DeviceOption[] = status.devices.flatMap(device => {
    if (device.kind !== "physical") return [];
    const running = device.state === "Booted";
    const stateLabel = device.state === "unauthorized" ? "Unauthorized" : "Offline";
    return [{
      value: device.udid, label: `${device.name} · ${physicalConnectionLabel(device.transportType)}${running ? "" : ` · ${stateLabel}`}`,
      group: "Connected devices", kind: /tablet|pixel.*tab/i.test(device.name) ? "tablet" : "phone",
      running, statusLabel: "Connected", canStop: false,
    }];
  });
  const virtual: DeviceOption[] = status.devices.filter(device => device.kind !== "physical").map(device => {
    const runtime = runtimeLabel(device.runtime);
    return {
      value: device.udid, label: `${device.name}${runtime ? ` · ${runtime}` : ""}`,
      group: platform === "ios" ? "Simulators" : "Emulators",
      kind: /ipad|tablet|pixel.*tab/i.test(device.name) ? "tablet" : "phone", running: device.state === "Booted",
      canStop: device.state === "Booted" && (platform === "ios" || isEmulatorSerial(device.udid)),
    };
  });
  return [...paired, ...wired, ...virtual];
}

/**
 * What the stage says about the selected device, or undefined to leave the screen as it is:
 * a stream being opened, or the device that was just stopped.
 */
export function selectionMessage(selected: SimulatorDevice | undefined, { platform, target, reconnecting, stopped }: { platform: Platform; target?: PanelTarget; reconnecting: boolean; stopped: boolean }) {
  if (isPhysicalIos(selected)) return reconnecting ? undefined : { title: `${selected.name} · ${physicalConnectionLabel(selected.transportType)}`, description: "Opening the physical device screen…" };
  if (selected?.kind === "physical" && selected.state !== "Booted") {
    const description = selected.state === "unauthorized"
      ? "Unlock the device and allow USB debugging, or pair it for wireless debugging."
      : "Reconnect the device and check that ADB debugging is enabled.";
    return { title: `${selected.name} · ${selected.state}`, description };
  }
  if (selected === undefined && (target?.platform !== undefined || target?.kind !== undefined || target?.deviceId !== undefined)) {
    return { title: "Requested device unavailable.", description: "The requested device could not be found. Connect it or choose another device from the picker." };
  }
  if (reconnecting || stopped) return;
  if (selected) return { title: "Select a device to open its screen.", description: "" };
  return { title: platform === "android" ? "No Android devices. Create an AVD in Android Studio or connect a device." : "No iOS devices. Connect an iPhone or add a simulator in Xcode.", description: "" };
}

/**
 * Lists a panel's devices, sharing a listing in flight, and polls every three seconds while `polls` allows.
 * A listing that a newer one superseded is dropped.
 */
export class DeviceDiscovery {
  private revision = 0;
  private listing?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private readonly read: () => Promise<Discovered>;
  private readonly apply: (found: Discovered) => Promise<void>;

  constructor(read: () => Promise<Discovered>, apply: (found: Discovered) => Promise<void>) {
    this.read = read;
    this.apply = apply;
  }

  /** A listing from elsewhere, such as a boot's result, replaces the ones in flight. */
  supersede() { this.revision++; }

  list(): Promise<void> {
    this.listing ??= this.refresh().finally(() => { this.listing = undefined; });
    return this.listing;
  }

  private async refresh() {
    const revision = ++this.revision;
    const found = await this.read();
    if (revision === this.revision && !this.disposed) await this.apply(found);
  }

  poll(polls: () => boolean, failed: (error: unknown) => void) {
    if (this.disposed || this.timer !== undefined) return;
    this.timer = setTimeout(async () => {
      this.timer = undefined;
      try { if (polls()) await this.list(); }
      catch (error) { failed(error); }
      finally { this.poll(polls, failed); }
    }, 3000);
  }

  dispose() { this.disposed = true; clearTimeout(this.timer); }
}
