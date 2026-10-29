import type { SimulatorDevice } from "./protocol.ts";

type DeviceIdentity = { platform?: string; kind?: string };

export function isPhysicalIos<T extends DeviceIdentity>(device?: T): device is T & { platform: "ios"; kind: "physical" } {
  return device?.platform === "ios" && device.kind === "physical";
}

// Paired iPhones report "connected"; simulators, emulators and Android hardware report "Booted".
export function isDeviceActive(device?: DeviceIdentity & { state: string }): boolean {
  return isPhysicalIos(device) ? device.state === "connected" : device?.state === "Booted";
}

// The same device in the same state, so a refreshed listing does not restart its consumers.
export function sameDevice(a?: SimulatorDevice, b?: SimulatorDevice): boolean {
  return a?.udid === b?.udid && a?.platform === b?.platform && a?.kind === b?.kind && a?.state === b?.state;
}
