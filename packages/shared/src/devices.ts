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

/** Describes a panel's device to the model: its ID, state and what the tools can do with it. The active device is the one logs follow. */
export function formatDeviceContext(device: SimulatorDevice, active: boolean): string {
  const role = active ? "Active" : "Visible";
  if (isPhysicalIos(device)) {
    const transport = device.transportType === undefined ? "Transport not reported." : `Transport: ${device.transportType}.`;
    return `${role} physical iOS device: ${device.name}. UDID: ${device.udid}. State: ${device.state}. ${transport} The panel mirrors this device through an interactive HEVC stream with pointer taps and drags. Native unified logs use mobile_logs_session with platform ios, kind physical, and this hardware UDID. They do not require launching the app; ordinary print output is unavailable and private values may be redacted. Physical iOS keyboard input, hardware buttons, screenshots, and agent-device control are not implemented yet.`;
  }
  if (device.kind === "physical" && device.platform === "android") return `${role} physical Android device: ${device.name}. Serial: ${device.udid}. State: ${device.state}. Transport: ${device.transportType}. Use this serial with the Mobile Dev Android tools for platform android.`;
  return `${role} ${device.platform === "android" ? "Android" : "iOS"} simulator: ${device.name}. Device ID: ${device.udid}. State: ${device.state}. Use this ${device.platform === "android" ? "serial" : "UDID"} with the Mobile Dev tools for platform ${device.platform}.`;
}
