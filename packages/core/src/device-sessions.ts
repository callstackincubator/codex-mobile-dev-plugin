import { throwFailures } from "./session-registry.ts";

/** Every kind of session a device can hold, so shutting the device down closes them all. */
export class DeviceSessions {
  private readonly closers: ((deviceId: string) => Promise<void>)[] = [];

  add(close: (deviceId: string) => Promise<void>) { this.closers.push(close); }

  /** Closes the device's sessions everywhere, then reports every failure. */
  async closeDevice(deviceId: string) {
    const results = await Promise.allSettled(this.closers.map(close => Promise.resolve().then(() => close(deviceId))));
    throwFailures(results, "Device sessions failed to close.");
  }
}
