import type { SimulatorDevice } from "../shared/protocol.ts";
import { panelTargetPlatform } from "../shared/panel-target.ts";
import type { PanelTarget } from "../shared/panel-target.ts";

export type DeviceLayout = "both" | "ios" | "android" | "none";

export function isDeviceActive(device?: SimulatorDevice): boolean {
  if (device?.kind === "physical" && device.platform === "ios") return device.state === "connected";
  return device?.state === "Booted";
}

// Open one platform by default. iOS wins when both have an active device; the
// platform select can still show both.
export function activeDeviceLayout(ios?: SimulatorDevice, android?: SimulatorDevice): DeviceLayout {
  if (isDeviceActive(ios)) return "ios";
  return isDeviceActive(android) ? "android" : "none";
}

export function initialPanelDevice(devices: SimulatorDevice[], platform: "ios" | "android", previous?: string, target?: PanelTarget): SimulatorDevice | undefined {
  const requestedPlatform = target ? panelTargetPlatform(target) : undefined;
  if (requestedPlatform !== undefined && requestedPlatform !== platform) return;
  const candidates = devices.filter(device => {
    if (target?.deviceId !== undefined && device.udid !== target.deviceId) return false;
    const kind = device.kind ?? (platform === "ios" ? "simulator" : "emulator");
    return target?.kind === undefined || kind === target.kind;
  });
  const selected = candidates.find(device => device.udid === previous);
  if (selected !== undefined) return selected;
  const running = candidates.find(device => device.state === "Booted");
  if (running !== undefined) return running;
  const physical = candidates.find(device => device.kind === "physical" && device.platform === "ios" && device.state === "connected");
  if (physical !== undefined) return physical;
  if (target?.platform !== undefined || target?.kind !== undefined || target?.deviceId !== undefined) return candidates[0];
}
