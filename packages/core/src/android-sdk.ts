import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { androidIdSchema } from "@mobile-dev/shared/android-ids.ts";

const execute = promisify(execFile);

// Android SDK locations, in the order the SDK's own tools check them.
export function androidSdkRoots(): string[] {
  return [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, join(homedir(), "Library/Android/sdk")].filter(root => !!root) as string[];
}

export async function adbPath(): Promise<string> {
  for (const root of androidSdkRoots()) {
    const path = join(root, "platform-tools/adb");
    try { await access(path); return path; } catch { /* Try the next SDK, then PATH. */ }
  }
  return "adb";
}

export type AdbDevice = { serial: string; state: "device" | "offline" | "unauthorized"; model?: string };

/** The devices `adb devices -l` lists, with the model's underscores read as spaces. */
export function parseAdbDevices(output: string): AdbDevice[] {
  return output.split(/\r?\n/).flatMap(line => {
    const match = line.match(/^(\S+)\s+(device|offline|unauthorized)(?:\s|$)(.*)/);
    if (!match || androidIdSchema.safeParse(match[1]).success === false) return [];
    const model = match[3].match(/(?:^|\s)model:(\S+)/)?.[1].replace(/_/g, " ");
    return [{ serial: match[1], state: match[2] as AdbDevice["state"], ...(model ? { model } : {}) }];
  });
}

export function adbDevices(adb: string) {
  return execute(adb, ["devices", "-l"], { timeout: 5000, maxBuffer: 1024 * 1024 }).then(({ stdout }) => parseAdbDevices(stdout));
}

export type AndroidDevice = { id: string; name: string };

/** Authorized Android devices, named by model. */
export async function listAndroidDevices(): Promise<AndroidDevice[]> {
  const devices = await adbDevices(await adbPath());
  return devices.flatMap(device => device.state === "device" ? [{ id: device.serial, name: device.model ?? device.serial }] : []);
}
