import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ExpectedOperationError } from "@mobile-dev/shared/error-reporting.ts";
import type { ExpectedOutcome } from "@mobile-dev/shared/error-reporting.ts";
import type { IosVideoBatch } from "@mobile-dev/shared/ios-video.ts";

export type NativeConfiguration = { revision: number; width: number; height: number; codec: string; description: Buffer };
export type NativeBatch = { generation: number; frames: { data: Buffer; timestamp: number; key: boolean }[]; configuration?: NativeConfiguration; dropped: number };
export type NativeTouchSample = { phase: number; x: number; y: number; width: number; height: number };
export type NativeCapture = { read(): Promise<NativeBatch>; touch(samples: NativeTouchSample[], generation: number): Promise<void>; requestKeyframe(): void; close(): Promise<void> };
export type IosCapture = { read(): Promise<IosVideoBatch>; touch(samples: NativeTouchSample[], generation: number): Promise<void>; reset(): Promise<void>; close(): Promise<void> };
type NativeAddon = { openDevice(udid: string): Promise<NativeCapture> };
let addon: NativeAddon | undefined;

// Device states the addon reports that need no Sentry issue (packages/native/ios-mirror/src/error.rs).
const expectedCodes: Record<string, ExpectedOutcome> = {
  device_not_found: "device_unavailable",
  // CoreDevice refuses to share the display during a phone or VoIP call.
  core_device_9022: "device_unavailable",
  display_service_unavailable: "unsupported_platform",
  touch_service_unavailable: "unsupported_platform",
  input_stale: "device_unavailable",
  input_invalid: "invalid_input",
  stream_closed: "session_closed",
};

/** A failure from the iOS capture addon, with its stable `code`. */
export type NativeCaptureError = Error & { code: string };

/** napi-rs rejects with its own status code, so the addon prefixes messages with `[code] `. */
export function nativeCaptureError(error: unknown): unknown {
  if (error instanceof Error === false) return error;
  const match = /^\[([a-z][a-z0-9_-]*)\] /.exec(error.message);
  if (match === null) return error;
  const code = match[1];
  const message = error.message.slice(match[0].length);
  const outcome = expectedCodes[code];
  const typed = outcome === undefined ? new Error(message) : new ExpectedOperationError(outcome, message);
  return Object.assign(typed, { code });
}

async function translated<T>(operation: Promise<T>): Promise<T> {
  try { return await operation; }
  catch (error) { throw nativeCaptureError(error); }
}

export async function openNativeIosCapture(udid: string): Promise<NativeCapture> {
  if (process.platform !== "darwin" || process.arch !== "arm64") throw new ExpectedOperationError("unsupported_platform", "Physical iOS mirroring requires an Apple Silicon Mac.");
  if (addon === undefined) {
    // Bundles, and the chunks they split into, sit in dist/ beside the addon.
    const bundled = import.meta.url.endsWith(".mjs");
    const root = bundled ? "./ios-mirror/" : "../../native/vendor/ios-mirror/";
    const url = new URL(`${root}darwin-arm64.node`, import.meta.url);
    const path = fileURLToPath(url);
    if (existsSync(path) === false) throw new Error("The physical iOS capture addon is missing. Run npm run rebuild:ios-mirror and rebuild the plugin.");
    const require = createRequire(import.meta.url);
    const loaded: NativeAddon = require(path);
    addon = loaded;
  }
  const capture = await translated(addon.openDevice(udid));
  return {
    read: () => translated(capture.read()),
    touch: (samples, generation) => translated(capture.touch(samples, generation)),
    requestKeyframe: () => capture.requestKeyframe(),
    close: () => capture.close(),
  };
}
