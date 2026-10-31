import { ExpectedOperationError } from "@mobile-dev/shared/error-reporting.ts";
import type { MemoryMetric } from "@mobile-dev/shared/cpu.ts";
import type { PhysicalIosDevice } from "@mobile-dev/shared/ios-devices.ts";
import { Simctl } from "./simctl.ts";
import { listIosDevices } from "./ios-devices.ts";
import { listAndroidDevices } from "./android-sdk.ts";
import type { AndroidDevice } from "./android-sdk.ts";

/** What a feature needs a device for; each purpose has its own requirements and messages. */
export type DevicePurpose = "cpu" | "fps" | "logs";
export type DeviceQuery = { platform: "ios" | "android"; deviceId: string; kind?: "simulator" | "physical" };

/** What the plugin can measure on a kind of device. */
export type DeviceCapabilities = {
  /** Android reports resident memory, iOS the app's physical footprint. */
  memoryMetric: MemoryMetric;
  /** Display FPS reads Android's FrameTimeline or a paired iPhone's counter; simulators have neither. */
  displayFps: boolean;
  /** How long a finished recording waits for late FPS readings; Android reads back about three seconds behind. */
  fpsDrainMs: number;
};

export function deviceCapabilities({ platform, kind }: Pick<DeviceQuery, "platform" | "kind">): DeviceCapabilities {
  if (platform === "android") return { memoryMetric: "rss", displayFps: true, fpsDrainMs: 5000 };
  return { memoryMetric: "physical-footprint", displayFps: kind === "physical", fpsDrainMs: 1500 };
}

export type ResolvedDevice = { deviceId: string; name: string; capabilities: DeviceCapabilities } & (
  | { platform: "ios"; kind: "simulator" }
  | { platform: "ios"; kind: "physical"; device: PhysicalIosDevice }
  | { platform: "android" });

export type DeviceSources = {
  simulators?: Pick<Simctl, "device">;
  ios?: (signal?: AbortSignal) => Promise<PhysicalIosDevice[]>;
  android?: () => Promise<AndroidDevice[]>;
};

const androidUnavailable: Record<DevicePurpose, string> = {
  cpu: "The Android device is offline or unauthorized. Connect and authorize it through ADB.",
  fps: "Connect and authorize the Android device through ADB.",
  logs: "The selected Android device is absent or unauthorized. Refresh log sources.",
};
const unavailable = (message: string) => new ExpectedOperationError("device_unavailable", message);

/** Holds a physical iPhone to what `purpose` needs: CPU a paired one, FPS a connected one, logs a paired one on USB or Wi-Fi. */
export function requirePhysicalIos(device: PhysicalIosDevice | undefined, purpose: DevicePurpose): PhysicalIosDevice {
  if (purpose === "cpu" && (device?.state !== "connected" || device.pairingState !== "paired")) throw unavailable("Connect the paired iPhone and enable Developer Mode to monitor CPU and memory.");
  if (purpose === "fps" && device?.state !== "connected") throw unavailable("Connect the paired iPhone to monitor Display FPS.");
  if (purpose === "logs") {
    if (device?.state !== "connected") throw unavailable("The selected physical iOS device is no longer connected. Refresh the device list.");
    if (device.pairingState !== "paired") throw unavailable("The selected iPhone is not paired. Unlock it and trust this Mac.");
    if (device.transportType !== "wired" && device.transportType !== "localNetwork") throw unavailable("The selected iPhone has no supported USB or Wi-Fi connection.");
  }
  return device!;
}

/**
 * Finds the device a tool targets and checks it can serve the purpose, so CPU, FPS, logs
 * and recordings list devices and word their failures one way.
 */
export class DeviceResolver {
  private readonly simulators: Pick<Simctl, "device">;
  private readonly ios: (signal?: AbortSignal) => Promise<PhysicalIosDevice[]>;
  /** Authorized Android devices, as mobile_log_sources lists them. */
  readonly androidDevices: () => Promise<AndroidDevice[]>;

  constructor({ simulators = new Simctl(), ios = listIosDevices, android = listAndroidDevices }: DeviceSources = {}) {
    this.simulators = simulators;
    this.ios = ios;
    this.androidDevices = android;
  }

  async resolve(target: DeviceQuery, purpose: DevicePurpose, signal?: AbortSignal): Promise<ResolvedDevice> {
    const capabilities = deviceCapabilities(target);
    if (target.platform === "android") {
      const device = (await this.androidDevices()).find(candidate => candidate.id === target.deviceId);
      if (device === undefined) throw unavailable(androidUnavailable[purpose]);
      return { platform: "android", deviceId: device.id, name: device.name, capabilities };
    }
    // Display FPS targets name no kind: an ID that no iPhone reports is a simulator's.
    if (target.kind === "physical" || purpose === "fps") {
      signal?.throwIfAborted();
      const devices = await this.ios(signal);
      signal?.throwIfAborted();
      const found = devices.find(candidate => candidate.udid === target.deviceId);
      if (found !== undefined || target.kind === "physical") {
        const device = requirePhysicalIos(found, purpose);
        return { platform: "ios", kind: "physical", deviceId: device.udid, name: device.name, device, capabilities: deviceCapabilities({ platform: "ios", kind: "physical" }) };
      }
    }
    const simulator = deviceCapabilities({ platform: "ios", kind: "simulator" });
    if (purpose === "fps" && simulator.displayFps === false) throw new ExpectedOperationError("invalid_input", "Display FPS is available on physical iOS devices, not simulators.");
    const { name } = await this.simulators.device(target.deviceId, true);
    return { platform: "ios", kind: "simulator", deviceId: target.deviceId, name, capabilities: simulator };
  }
}
