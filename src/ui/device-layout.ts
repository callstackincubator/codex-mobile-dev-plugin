import type { SimulatorDevice } from "../shared/protocol.ts";

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
