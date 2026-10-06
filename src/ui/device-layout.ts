import type { SimulatorDevice } from "../shared/protocol.ts";

export type DeviceLayout = "both" | "ios" | "android" | "none";

export function isDeviceActive(device?: SimulatorDevice): boolean {
  if (device?.kind === "physical" && device.platform === "ios") return device.state === "connected";
  return device?.state === "Booted";
}

export function activeDeviceLayout(ios?: SimulatorDevice, android?: SimulatorDevice): DeviceLayout {
  const iosActive = isDeviceActive(ios);
  const androidActive = isDeviceActive(android);
  if (iosActive && androidActive) return "both";
  if (iosActive) return "ios";
  if (androidActive) return "android";
  return "none";
}
