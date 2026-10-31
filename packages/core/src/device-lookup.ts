import { SimulatorUnavailableError } from "./simulator-unavailable.ts";

/** What a backend tells the user about a device that is gone, or stopped when it must be booted. */
export type DeviceLookup = { booted?: boolean; missing: string; stopped: string };

/** The listed device with `id`. A missing device, or a stopped one when `booted`, is unavailable. */
export function requireDevice<T extends { udid: string; state: string }>(devices: readonly T[], id: string, { booted = false, missing, stopped }: DeviceLookup): T {
  const device = devices.find(item => item.udid === id);
  if (device === undefined) throw new SimulatorUnavailableError(missing);
  if (booted && device.state !== "Booted") throw new SimulatorUnavailableError(stopped);
  return device;
}
