import { spawnSync } from "node:child_process";
import { execText } from "./exec.ts";

export type GeoFix = {
  latitude: number;
  longitude: number;
  altitude?: number;
  satellites?: number;
  velocity?: number;
};

function finiteNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
  return value;
}

function optionalNumber(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  return finiteNumber(value, name);
}

function optionalInteger(value: unknown, name: string): number | undefined {
  const n = optionalNumber(value, name);
  if (n === undefined) return undefined;
  if (!Number.isInteger(n)) throw new Error(`${name} must be an integer`);
  return n;
}

function decimal(value: number): string {
  return String(Number(value.toFixed(7)));
}

function geoFixArgs(serial: string, fix: GeoFix): string[] {
  if (!/^emulator-\d+$/.test(serial)) {
    throw new Error("location control is currently supported for Android Emulator serials only");
  }

  const args = [
    "-s",
    serial,
    "emu",
    "geo",
    "fix",
    decimal(fix.longitude),
    decimal(fix.latitude),
  ];
  if (fix.altitude !== undefined) args.push(decimal(fix.altitude));
  if (fix.satellites !== undefined) args.push(String(fix.satellites));
  if (fix.velocity !== undefined) args.push(decimal(fix.velocity));
  return args;
}

function assertGeoFixOutput(status: number | null, output: string): void {
  if (status !== 0 || /^KO\b/.test(output)) {
    throw new Error(`adb emu geo fix failed: ${output || "unknown error"}`);
  }
}

export function parseGeoFix(value: unknown): GeoFix {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("location payload must be an object");
  }
  const record = value as Record<string, unknown>;
  const latitude = finiteNumber(record.latitude, "latitude");
  const longitude = finiteNumber(record.longitude, "longitude");
  const altitude = optionalNumber(record.altitude, "altitude");
  const satellites = optionalInteger(record.satellites, "satellites");
  const velocity = optionalNumber(record.velocity, "velocity");

  if (latitude < -90 || latitude > 90) throw new Error("latitude must be between -90 and 90");
  if (longitude < -180 || longitude > 180) throw new Error("longitude must be between -180 and 180");
  if (altitude !== undefined && (altitude < -1000 || altitude > 100000)) {
    throw new Error("altitude must be between -1000 and 100000");
  }
  if (satellites !== undefined && (satellites < 1 || satellites > 64)) {
    throw new Error("satellites must be between 1 and 64");
  }
  if (velocity !== undefined && (velocity < 0 || velocity > 1000)) {
    throw new Error("velocity must be between 0 and 1000");
  }

  return { latitude, longitude, altitude, satellites, velocity };
}

export function setEmulatorLocation(serial: string, fix: GeoFix): void {
  const r = spawnSync("adb", geoFixArgs(serial, fix), { encoding: "utf8", timeout: 5_000 });
  const output = `${r.stdout}${r.stderr}`.trim();
  assertGeoFixOutput(r.status, output);
}

export async function setEmulatorLocationAsync(
  serial: string,
  fix: GeoFix,
  signalOrExec?: AbortSignal | typeof execText,
  runExecOverride?: typeof execText,
): Promise<void> {
  const signal =
    signalOrExec instanceof AbortSignal ? signalOrExec : undefined;
  const runExec =
    runExecOverride ??
    (typeof signalOrExec === "function" ? signalOrExec : execText);
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error("location update aborted");
  }
  const result = await runExec("adb", geoFixArgs(serial, fix), {
    timeout: 5_000,
    maxBuffer: 64 * 1024,
    lane: "interactive",
    signal,
  });
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error("location update aborted");
  }
  if (result.timedOut) throw new Error("adb emu geo fix timed out");
  const output = `${result.stdout}${result.stderr}`.trim();
  if (result.error) {
    throw new Error(
      `adb emu geo fix failed: ${output || result.error.message}`,
      { cause: result.error },
    );
  }
  assertGeoFixOutput(result.status, output);
}
