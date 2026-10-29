import { z } from "zod";

// adb serials, including wireless "[fe80::1%en0]:5555" ones, and the avd: IDs of stopped emulators.
export const androidIdSchema = z.string().min(1).max(256).regex(/^[A-Za-z0-9_.:\[\]%-]+$/);

const avdPrefix = "avd:";

export function isEmulatorSerial(id: string): boolean {
  return /^emulator-\d+$/.test(id);
}

// A stopped emulator has no serial, so it is listed by its AVD name.
export function avdId(name: string): string {
  return `${avdPrefix}${name}`;
}

export function isStoppedAvd(id: string): boolean {
  return id.startsWith(avdPrefix);
}

export function stoppedAvdName(id?: string): string | undefined {
  return id !== undefined && isStoppedAvd(id) ? id.slice(avdPrefix.length) : undefined;
}
