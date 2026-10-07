import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ExpectedOperationError } from "../shared/error-reporting.ts";
import type { IosVideoBatch } from "../shared/ios-video.ts";

export type NativeConfiguration = { revision: number; width: number; height: number; codec: string; description: Buffer };
export type NativeBatch = { generation: number; frames: { data: Buffer; timestamp: number; key: boolean }[]; configuration?: NativeConfiguration; dropped: number };
export type NativeTouchSample = { phase: number; x: number; y: number; width: number; height: number };
export type NativeCapture = { read(): Promise<NativeBatch>; touch(samples: NativeTouchSample[], generation: number): Promise<void>; requestKeyframe(): void; close(): Promise<void> };
export type IosCapture = { read(): Promise<IosVideoBatch>; touch(samples: NativeTouchSample[], generation: number): Promise<void>; reset(): Promise<void>; close(): Promise<void> };
type NativeAddon = { openDevice(udid: string): Promise<NativeCapture> };
let addon: NativeAddon | undefined;

export async function openNativeIosCapture(udid: string): Promise<NativeCapture> {
  if (process.platform !== "darwin" || process.arch !== "arm64") throw new ExpectedOperationError("unsupported_platform", "Physical iOS mirroring requires an Apple Silicon Mac.");
  if (addon === undefined) {
    const bundled = import.meta.url.endsWith("/ios-mirror-service.mjs");
    const root = bundled ? "./ios-mirror/" : "../../vendor/ios-mirror/";
    const url = new URL(`${root}darwin-arm64.node`, import.meta.url);
    const path = fileURLToPath(url);
    if (existsSync(path) === false) throw new Error("The physical iOS capture addon is missing. Run npm run rebuild:ios-mirror and rebuild the plugin.");
    const require = createRequire(import.meta.url);
    const loaded: NativeAddon = require(path);
    addon = loaded;
  }
  return addon.openDevice(udid);
}
