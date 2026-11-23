import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { ResourceSavingDevice, ResourceSavingState } from "@mobile-dev/shared/resource-saving.ts";
import { adbPath } from "./native-logs.ts";
import { isMissingFile, MissingRuntimeError } from "./install-integrity.ts";
import { panelRuntimePath } from "./panel-runtime.ts";
import { captureServerError, recordResourceSaving } from "./telemetry.ts";

const execute = promisify(execFile);
const home = homedir();
const directory = join(home, "Library/Application Support/mobile-dev/resource-saving");
const preferenceSchema = z.object({ enabled: z.boolean() });
const androidStateSchema = z.object({ disabled_packages: z.array(z.string()), settings: z.record(z.string(), z.string().nullable()) });
export const IOS_RESOURCE_SAVING_EXCEPT = "store,web,pim,photos,connectivity,telemetry";
export const ANDROID_RESOURCE_SAVING_SKIP = "animations,bglimit,sync,location,setup,bluetooth";
const androidKeep = [
  "com.android.traceur", "com.google.android.apps.photos", "com.android.gallery3d", "com.google.android.apps.maps",
  "com.android.camera2", "com.android.cameraextensions", "com.google.android.contacts", "com.android.contacts",
  "com.google.android.marvin.talkback", "com.google.android.apps.accessibility.voiceaccess", "com.google.android.tts",
];

type Run = (file: string, args: string[], options: { timeout: number; maxBuffer: number; encoding: "utf8"; env?: NodeJS.ProcessEnv; signal?: AbortSignal }) => Promise<{ stdout: string }>;
type Options = { directory?: string; run?: Run; executable?: (platform: "ios" | "android") => Promise<string>; adb?: () => Promise<string> };

async function executable(platform: "ios" | "android") {
  const name = platform === "ios" ? "simslim" : "avdslim";
  const path = await panelRuntimePath(`resource-saving/${name}`);
  try { await access(path, constants.X_OK); }
  catch (error) {
    if (isMissingFile(error)) throw new MissingRuntimeError("resource-saving");
    throw error;
  }
  return path;
}

export class ResourceSaving {
  readonly directory: string;
  private readonly run: Run;
  private readonly locate: typeof executable;
  private readonly adb: () => Promise<string>;
  private readonly applied = new Map<string, boolean>();
  private readonly pending = new Map<string, Promise<void>>();

  constructor(options: Options = {}) {
    this.directory = options.directory ?? directory;
    this.run = options.run ?? execute;
    this.locate = options.executable ?? executable;
    this.adb = options.adb ?? adbPath;
  }

  private filename(device: Pick<ResourceSavingDevice, "platform" | "key">) {
    const hash = createHash("sha256");
    hash.update(`${device.platform}:${device.key}`);
    const key = hash.digest("hex");
    return join(this.directory, `${key}.json`);
  }

  async enabled(device: Pick<ResourceSavingDevice, "platform" | "key">): Promise<boolean> {
    const path = this.filename(device);
    let text: string;
    try { text = await readFile(path, "utf8"); }
    catch (error) {
      if (isMissingFile(error)) return true;
      throw error;
    }
    const parsed: unknown = JSON.parse(text);
    const preference = preferenceSchema.parse(parsed);
    return preference.enabled;
  }

  async state(device: ResourceSavingDevice): Promise<ResourceSavingState> {
    const enabled = await this.enabled(device);
    const key = this.filename(device);
    const running = device.state === "Booted";
    return { enabled, running, restartRequired: running && this.applied.get(key) !== enabled };
  }

  async set(device: ResourceSavingDevice, enabled: boolean) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const path = this.filename(device);
    const suffix = randomUUID();
    const temporary = `${path}.${suffix}.tmp`;
    const text = JSON.stringify({ enabled });
    try {
      await writeFile(temporary, text, { mode: 0o600 });
      await rename(temporary, path);
    } finally { await rm(temporary, { force: true }); }
    return this.state(device);
  }

  forget(device: Pick<ResourceSavingDevice, "platform" | "key">) {
    const key = this.filename(device);
    this.applied.delete(key);
  }

  async apply(device: ResourceSavingDevice, signal?: AbortSignal, mode?: boolean): Promise<void> {
    const key = this.filename(device);
    const previous = this.pending.get(key);
    const operation = this.applyAfter(previous, device, signal, mode);
    this.pending.set(key, operation);
    try { await operation; }
    finally { if (this.pending.get(key) === operation) this.pending.delete(key); }
  }

  private async applyAfter(previous: Promise<void> | undefined, device: ResourceSavingDevice, signal?: AbortSignal, mode?: boolean) {
    await previous?.catch(() => {});
    const enabled = mode ?? await this.enabled(device);
    const startedAt = performance.now();
    try {
      signal?.throwIfAborted();
      const file = await this.locate(device.platform);
      if (device.platform === "ios") await this.applyIos(file, device.id, enabled, signal);
      else await this.applyAndroid(file, device.id, enabled, signal);
      const key = this.filename(device);
      this.applied.set(key, enabled);
      const duration = performance.now() - startedAt;
      recordResourceSaving(device.platform, enabled, "success", duration);
    } catch (error) {
      const duration = performance.now() - startedAt;
      recordResourceSaving(device.platform, enabled, "failed", duration);
      captureServerError(error, "resource_saving.apply", { reportAs: new Error("Device resource optimization failed."), tags: { device_platform: device.platform }, signal });
      throw error;
    }
  }

  private async applyIos(file: string, id: string, enabled: boolean, signal?: AbortSignal) {
    const options = { timeout: 180000, maxBuffer: 1024 * 1024, encoding: "utf8" as const, signal };
    if (enabled) {
      await this.run(file, ["on", id, "--no-reboot", "--except", IOS_RESOURCE_SAVING_EXCEPT], options);
      await this.run(file, ["verify", id, "--except", IOS_RESOURCE_SAVING_EXCEPT, "--json"], options);
      return;
    }
    const status = await this.run(file, ["status", id, "--json"], options);
    const parsed: unknown = JSON.parse(status.stdout);
    const reading = z.object({ managedDisabled: z.number().int().nonnegative() }).parse(parsed);
    if (reading.managedDisabled > 0) await this.run(file, ["off", id], options);
  }

  private async applyAndroid(file: string, id: string, enabled: boolean, signal?: AbortSignal) {
    const adb = await this.adb();
    const adbDirectory = dirname(adb);
    const sdk = dirname(adbDirectory);
    const cliHome = join(this.directory, "avdslim-home");
    await mkdir(cliHome, { recursive: true, mode: 0o700 });
    const androidHome = process.env.ANDROID_USER_HOME ?? join(home, ".android");
    const adbKeys = process.env.ADB_VENDOR_KEYS ?? join(androidHome, "adbkey");
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: cliHome, ANDROID_USER_HOME: androidHome, ADB_VENDOR_KEYS: adbKeys };
    if (isAbsolute(adb)) {
      env.ANDROID_HOME = sdk;
      env.ANDROID_SDK_ROOT = sdk;
      env.PATH = `${adbDirectory}:${process.env.PATH ?? ""}`;
    }
    const options = { timeout: 120000, maxBuffer: 1024 * 1024, encoding: "utf8" as const, env, signal };
    const readState = async () => {
      const result = await this.run(adb, ["-s", id, "shell", "if [ -f /data/local/tmp/avdslim_state.json ]; then cat /data/local/tmp/avdslim_state.json; else echo null; fi"], options);
      const parsed: unknown = JSON.parse(result.stdout);
      return parsed === null ? null : androidStateSchema.parse(parsed);
    };
    const before = await readState();
    if (enabled === false) {
      // Never invoke avdslim's legacy restore path without an exact settings record.
      if (before !== null) await this.run(file, ["off", id], options);
      const after = await readState();
      if (after !== null) throw new Error("Android resource settings could not be restored.");
      return;
    }
    const disabled = await this.run(adb, ["-s", id, "shell", "pm", "list", "packages", "-d"], options);
    const disabledLines = disabled.stdout.split(/\r?\n/);
    const alreadyDisabled = disabledLines.filter(line => line.startsWith("package:"));
    const keep = new Set(androidKeep);
    for (const line of alreadyDisabled) {
      const name = line.slice("package:".length).trim();
      if (before?.disabled_packages.includes(name) !== true) keep.add(name);
    }
    const args = ["on", id, `--skip=${ANDROID_RESOURCE_SAVING_SKIP}`];
    for (const name of keep) args.push(`--keep=${name}`);
    await this.run(file, args, options);
    const after = await readState();
    if (after === null) throw new Error("Android did not retain its resource optimization record.");
    const result = await this.run(adb, ["-s", id, "shell", "pm", "list", "packages", "-d"], options);
    const lines = result.stdout.split(/\r?\n/);
    const normalized = lines.map(line => line.trim());
    const actual = new Set(normalized);
    for (const name of after.disabled_packages) {
      if (actual.has(`package:${name}`) === false) throw new Error("Android did not apply every requested resource optimization.");
    }
  }
}
