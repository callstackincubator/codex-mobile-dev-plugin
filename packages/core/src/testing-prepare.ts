import { join } from "node:path";
import { ExpectedOperationError } from "@mobile-dev/shared/error-reporting.ts";
import { udidSchema } from "@mobile-dev/shared/protocol.ts";
import { commandError, commandOutput, systemCommands, withTemporaryDirectory } from "./app-control/commands.ts";
import type { Commands } from "./app-control/commands.ts";
import type { DriverFactory } from "./app-control/tools.ts";
import type { ServeEmu } from "./serve-emu.ts";
import type { Simctl } from "./simctl.ts";
import type { Lane, LaneExecutor, MatrixPlatform } from "./testing-matrix.ts";
import type { TestRunProgress, TestRunResult } from "./testing-run.ts";
import { listIosDevices } from "./ios-devices.ts";
import { ensureIosSigning } from "./ios-signing.ts";
import { coreDeviceLaunchCode, coreDeviceLaunchHint } from "./coredevice-errors.ts";
import { findDeviceBuild } from "./ios-device-build.ts";

/** Home screens and system UI, which are never the app to record. */
export const LAUNCHER_APP = /^com\.apple\.springboard$|^com\.android\.systemui$|launcher/i;

/** The per-platform app ids of a matrix request: a project may use different ones on each platform. */
export interface MatrixAppIds { ios?: string; android?: string }

/** What preparing a device needs from the machine; faked in tests. */
export interface PhysicalDeviceOps {
    /** Connected and usable (for Android: adb-authorized, awake, unlocked); throws what to fix. */
    ready(deviceId: string, options?: { projectPath?: string }): Promise<void>;
    hasApp(deviceId: string, appId: string): Promise<boolean>;
    launch(deviceId: string, appId: string): Promise<void>;
    /** Android only: installs the app from the first of `sources` (other devices) that has a compatible build. */
    installFrom?(deviceId: string, appId: string, sources: string[]): Promise<"installed" | "no_source">;
}

export interface DeviceOps {
  physicalAndroid?: PhysicalDeviceOps;
  physicalIos?: {
    /** Paired, connected, Developer Mode on, and a signing team for the runner; throws what to fix. */
    ready(deviceId: string, options?: { projectPath?: string }): Promise<void>;
    hasApp(deviceId: string, appId: string): Promise<boolean>;
    launch(deviceId: string, appId: string): Promise<void>;
    /**
     * Installs a device build of the app that is already on this Mac (never a simulator build).
     * Resolves "no_build" when none matches, so the caller can say how to build one.
     */
    install?(deviceId: string, appId: string, options?: { projectPath?: string }): Promise<"installed" | "no_build">;
  };
  isBooted(platform: MatrixPlatform, deviceId: string): Promise<boolean>;
  /** Boots the device and waits for it to be usable. Returns the id to run on (an Android AVD becomes a serial). */
  boot(platform: MatrixPlatform, deviceId: string, signal: AbortSignal): Promise<string>;
  hasApp(platform: MatrixPlatform, deviceId: string, appId: string): Promise<boolean>;
  /** Installs the app on `to` from the copy already on `from`. */
  copyApp(platform: MatrixPlatform, from: string, to: string, appId: string, signal: AbortSignal): Promise<void>;
  launch(platform: MatrixPlatform, deviceId: string, appId: string): Promise<void>;
  /** The booted devices of a platform, for finding the one the user opened an app on. */
  bootedDevices?(platform: MatrixPlatform): Promise<{ deviceId: string; name: string }[]>;
  /** The bundle id or package of the app in the foreground, or null when none is. */
  foregroundApp?(platform: MatrixPlatform, deviceId: string): Promise<string | null>;
}

export interface LaneExecutorDeps {
  ops: DeviceOps;
  apps: MatrixAppIds;
  /**
   * Project mode: the plugin does not launch the user's app — the runner's own `app.open` starts it.
   * A device that lacks the app gets it copied from another booted device that has it, as in bundled mode.
   */
  projectMode?: boolean;
  /** The project whose build output is searched for a device build to install. */
  projectPath?: string;
  runTest(lane: Lane, deviceId: string, signal: AbortSignal, onProgress: (progress: TestRunProgress) => void): Promise<TestRunResult>;
}

/**
 * Boot if off, install if missing, launch, then run.
 *
 * The app is only ever copied from another device of the same matrix that already has it, so no
 * build output is guessed at and nothing outside the matrix is touched. If no device has it the
 * lane fails with a message that says what to do.
 */
export function createLaneExecutor(deps: LaneExecutorDeps): LaneExecutor {
  return {
    async prepare(lane, lanes, signal, setState) {
      const appId = deps.apps[lane.platform];
      if (!appId) throw new ExpectedOperationError("invalid_input", `No ${lane.platform === "ios" ? "iOS bundle id" : "Android package"} was given for this run, so ${lane.deviceName} cannot run it.`);
      let deviceId = lane.deviceId;
      if (lane.kind === "physical" && lane.platform === "android") {
        const physical = deps.ops.physicalAndroid;
        if (!physical?.installFrom) throw new ExpectedOperationError("unsupported_platform", "Physical Android runs are unavailable on this server.");
        await physical.ready(deviceId, { projectPath: deps.projectPath });
        signal.throwIfAborted();
        if (!await physical.hasApp(deviceId, appId)) {
          setState("installing");
          // An APK can be copied between devices, unlike an iOS build. A phone is preferred as the source
          // because its ABIs match; the install is checked against this phone's ABIs.
          const sources = await androidSources(deps.ops, lane, lanes, deviceId, appId);
          const result = await physical.installFrom(deviceId, appId, sources);
          if (result === "no_source") throw new ExpectedOperationError("app_unavailable", `App not installed: ${appId} is not on ${lane.deviceName}, and no other connected device has it to copy. Build and install it on this phone (for an Expo app, \`npx expo run:android --device\`), then run again.`);
        }
        signal.throwIfAborted();
        if (!deps.projectMode) await physical.launch(deviceId, appId);
        return deviceId;
      }
      if (lane.kind === "physical") {
        if (!deps.ops.physicalIos) throw new ExpectedOperationError("unsupported_platform", "Physical iOS runs are unavailable on this server.");
        const physical = deps.ops.physicalIos;
        await physical.ready(deviceId, { projectPath: deps.projectPath });
        signal.throwIfAborted();
        if (!await physical.hasApp(deviceId, appId)) {
          // A simulator build has the wrong slice and no provisioning, and an installed app cannot be
          // pulled back off a phone, so the only source is a device build already on this Mac.
          setState("installing");
          const result = physical.install ? await physical.install(deviceId, appId, { projectPath: deps.projectPath }) : "no_build";
          if (result === "no_build") throw new ExpectedOperationError("app_unavailable", `App not installed: ${appId} is not on ${lane.deviceName}, and no device build of it was found on this Mac. Build it for a physical device (for an Expo app, \`npx expo run:ios --device\`), then run again.`);
        }
        signal.throwIfAborted();
        if (!deps.projectMode) await deps.ops.physicalIos.launch(deviceId, appId);
        return deviceId;
      }
      if (!await deps.ops.isBooted(lane.platform, deviceId)) {
        setState("booting");
        deviceId = await deps.ops.boot(lane.platform, deviceId, signal);
        lane.resolvedDeviceId = deviceId;
      }
      signal.throwIfAborted();
      if (!await deps.ops.hasApp(lane.platform, deviceId, appId)) {
        setState("installing");
        const source = await findSource(deps.ops, lane, lanes, deviceId, appId);
        if (!source) throw new ExpectedOperationError("app_unavailable", `App not installed: ${appId} is not on ${lane.deviceName}, and no other booted device has it to copy. Build and install it once, then run again.`);
        await deps.ops.copyApp(lane.platform, source, deviceId, appId, signal);
      }
      signal.throwIfAborted();
      if (!deps.projectMode) await deps.ops.launch(lane.platform, deviceId, appId);
      return deviceId;
    },
    run: (lane, deviceId, signal, onProgress) => deps.runTest(lane, deviceId, signal, onProgress),
  };
}

/** The first other device of the same platform in the matrix that has the app installed. */
/**
 * A device to copy the app from: another device in this run first, then any other booted device of
 * the platform. The app is often installed only on the device it was built for, which need not be
 * one the user ticked; copying reads its app container and leaves that device as it is.
 */
async function findSource(ops: DeviceOps, lane: Lane, lanes: readonly Lane[], own: string, appId: string): Promise<string | undefined> {
  const tried = new Set([own]);
  // A device that is off, offline or going away cannot be a source; that is not an error here.
  const usable = async (candidate: string) => {
    if (tried.has(candidate)) return false;
    tried.add(candidate);
    try { return await ops.isBooted(lane.platform, candidate) && await ops.hasApp(lane.platform, candidate, appId); } catch { return false; }
  };
  for (const other of lanes) {
    // A phone is never a source: a copy would need its container, which a phone does not give out.
    if (other.runId === lane.runId || other.platform !== lane.platform || other.kind === "physical") continue;
    const candidate = other.resolvedDeviceId ?? other.deviceId;
    if (await usable(candidate)) return candidate;
  }
  const booted = await ops.bootedDevices?.(lane.platform).catch(() => []) ?? [];
  for (const device of booted) if (await usable(device.deviceId)) return device.deviceId;
  return undefined;
}

/** Devices an Android phone may take the app from: phones of this run, other devices of it, then any booted emulator. */
async function androidSources(ops: DeviceOps, lane: Lane, lanes: readonly Lane[], own: string, appId: string): Promise<string[]> {
  const found: string[] = [];
  const usable = async (candidate: string, physical: boolean) => {
    if (candidate === own || found.includes(candidate)) return;
    try {
      const has = physical ? ops.physicalAndroid && await ops.physicalAndroid.hasApp(candidate, appId) : await ops.isBooted("android", candidate) && await ops.hasApp("android", candidate, appId);
      if (has) found.push(candidate);
    } catch { /* offline or going away: not a source */ }
  };
  const others = lanes.filter(other => other.runId !== lane.runId && other.platform === "android");
  for (const other of others.filter(entry => entry.kind === "physical")) await usable(other.resolvedDeviceId ?? other.deviceId, true);
  for (const other of others.filter(entry => entry.kind !== "physical")) await usable(other.resolvedDeviceId ?? other.deviceId, false);
  for (const device of await ops.bootedDevices?.("android").catch(() => []) ?? []) await usable(device.deviceId, false);
  return found;
}

/** Whether devicectl reports Developer Mode off. An unreadable answer is not a refusal: the runner says so itself. */
async function developerModeDisabledWith(run: Commands["run"], deviceId: string): Promise<boolean> {
  try {
    const output = await run("/usr/bin/xcrun", ["devicectl", "device", "info", "details", "--device", deviceId, "--quiet", "--timeout", "10", "--json-output", "-"], { timeout: 15_000 });
    const status = (JSON.parse(output) as { result?: { deviceProperties?: { developerModeStatus?: string } } }).result?.deviceProperties?.developerModeStatus;
    return typeof status === "string" && status.toLowerCase() === "disabled";
  } catch { return false; }
}

/**
 * devicectl's failures as something to act on. The raw text names no fix, and "not installed" and
 * "locked" are the two a tester meets first. Anything unrecognised keeps devicectl's own lines.
 */
export function physicalIosError(error: unknown, action: string, appId?: string): Error {
  if (error instanceof ExpectedOperationError) return error;
  const output = commandOutput(error);
  if (/\blocked\b|passcode|DeviceLocked/i.test(output))
    return new ExpectedOperationError("device_unavailable", `${action} failed: the device is locked. Unlock it and keep the screen on, then try again.`);
  if (/Developer Mode/i.test(output))
    return new ExpectedOperationError("device_unavailable", `${action} failed: Developer Mode is off. Turn it on in Settings → Privacy & Security → Developer Mode, restart the phone, then try again.`);
  if (/not been explicitly trusted|profile has not been|invalid code signature|untrusted developer|0xe8008018/i.test(output))
    return new ExpectedOperationError("device_unavailable", `${action} failed: the developer profile is not trusted on the device. Trust it in Settings → General → VPN & Device Management, then try again.`);
  if (/provisioning profile|not provisioned|entitlement|0xe8008015|0xe800801f|doesn't include|not.*included in the profile/i.test(output))
    return new ExpectedOperationError("app_unavailable", `${action} failed: this build is not provisioned for the device${appId ? ` (${appId})` : ""}. Rebuild it with automatic signing while the device is connected (for an Expo app, \`npx expo run:ios --device\`).`);
  if (/not installed|could not be found|no such app|ApplicationNotFound|is not an installed/i.test(output))
    return new ExpectedOperationError("app_unavailable", `${action} failed: ${appId ?? "the app"} is not installed on the device. Build and install it (for an Expo app, \`npx expo run:ios --device\`), then try again.`);
  if (/no devices matched|device not found|unavailable|not connected|tunnel/i.test(output))
    return new ExpectedOperationError("device_unavailable", `${action} failed: the device is not reachable. Reconnect it, unlock it, and refresh Devices.`);
  const launch = coreDeviceLaunchCode(output);
  if (launch === "10002") return new ExpectedOperationError("device_unavailable", `${action} failed: ${coreDeviceLaunchHint(launch, appId)}`);
  const failure = commandError(error, action, "devicectl");
  // A launch that raced the app's own shutdown is retried by the user, so it stays a reported failure with its real explanation.
  if (launch === "10004" && !(failure instanceof ExpectedOperationError)) failure.message = `${failure.message} ${coreDeviceLaunchHint(launch, appId)}`;
  return failure;
}

const APK_PATH = /^\/[\w\-./=+@~]+\.apk$/;

/** Parses `adb shell pm path` output: one `package:<path>` line per APK, split APKs included. */
export function parsePmPaths(output: string): string[] {
  return output.split(/\r?\n/).map(line => line.trim()).filter(line => line.startsWith("package:")).map(line => line.slice("package:".length)).filter(path => APK_PATH.test(path));
}

/** The CPU ABIs a set of APK entries ships native code for; empty when the APK is pure Java. */
export function apkAbis(entries: string[]): string[] {
  const abis = new Set<string>();
  for (const entry of entries) {
    const lib = /^lib\/([^/]+)\//.exec(entry);
    if (lib) abis.add(lib[1]!);
  }
  return [...abis];
}

/** ABIs named by split APK file names such as `split_config.arm64_v8a.apk`. */
export function splitNameAbis(fileNames: string[]): string[] {
  const names = ["arm64_v8a", "armeabi_v7a", "x86_64", "x86", "armeabi", "mips64", "mips"];
  const abis = new Set<string>();
  for (const file of fileNames) {
    const match = /config\.([a-z0-9_]+)\.apk$/i.exec(file);
    if (match && names.includes(match[1]!)) abis.add(match[1]!.replace(/_/g, "-"));
  }
  return [...abis];
}

/** Whether the device can run an APK that ships `apk` ABIs. An APK with no native code runs anywhere. */
export function abiCompatible(device: string[], apk: string[]): boolean {
  return apk.length === 0 || apk.some(abi => device.includes(abi));
}

/** Parses `dumpsys window`/`power` into why the screen is not usable, or null when it is awake and unlocked. */
export function androidScreenBlock(power: string, window: string): "asleep" | "locked" | null {
  if (/mWakefulness=(Asleep|Dozing)/.test(power)) return "asleep";
  if (/(?:mShowingLockscreen|isStatusBarKeyguard|mKeyguardShowing|showingLockscreen)=true|mDreamingLockscreen=true/.test(window)) return "locked";
  return null;
}

/**
 * `adb install` and agent-device helper-APK failures as something to act on. Vendor settings
 * (Xiaomi "Install via USB", Samsung Auto Blocker) refuse USB installs with generic codes.
 */
export function androidInstallError(error: unknown, action: string, appId?: string): Error {
  if (error instanceof ExpectedOperationError) return error;
  const output = commandOutput(error);
  if (/INSTALL_FAILED_NO_MATCHING_ABIS/.test(output))
    return new ExpectedOperationError("app_unavailable", `${action} failed: this build has no native code for the phone's CPU. Build and install it on this phone (for an Expo app, \`npx expo run:android --device\`).`);
  if (/UPDATE_INCOMPATIBLE|INSTALL_FAILED_VERSION_DOWNGRADE|signatures do not match/i.test(output))
    return new ExpectedOperationError("app_unavailable", `${action} failed: a different build of ${appId ?? "the app"} is already on the phone. Uninstall it, or build and install it on this phone (for an Expo app, \`npx expo run:android --device\`).`);
  if (/INSTALL_FAILED_USER_RESTRICTED|INSTALL_FAILED_ABORTED|Install canceled|Auto Blocker|Install via USB|USER_RESTRICTED/i.test(output))
    return new ExpectedOperationError("device_unavailable", `${action} failed: the phone blocks installs over USB. Turn on "Install via USB" (Xiaomi, in Developer options), turn off Auto Blocker (Samsung), or accept the prompt on the phone, then try again.`);
  if (/INSUFFICIENT_STORAGE/.test(output))
    return new ExpectedOperationError("device_unavailable", `${action} failed: the phone is out of storage.`);
  if (/unauthorized/i.test(output))
    return new ExpectedOperationError("device_unavailable", `${action} failed: the phone has not authorized this Mac. Unlock it and accept the USB debugging prompt.`);
  if (/offline|device .* not found|no devices/i.test(output))
    return new ExpectedOperationError("device_unavailable", `${action} failed: the phone is not reachable. Reconnect it, unlock it, and refresh Devices.`);
  return commandError(error, action, "adb");
}

/** The real thing: `simctl` for iOS simulators, the emulator through `ServeEmu` and `adb` for Android. */
export function systemDeviceOps(deps: { simulators: Simctl; android: ServeEmu; drivers: DriverFactory; commands?: Commands; foreground?: (platform: MatrixPlatform, deviceId: string) => Promise<string | null> }): DeviceOps {
  const commands = deps.commands ?? systemCommands;
  const simctl = (args: string[], timeout = 30_000) => commands.run("xcrun", ["simctl", ...args], { timeout });
  const adb = async (serial: string, args: string[], timeout = 30_000) => commands.run(await commands.adb(), ["-s", serial, ...args], { timeout });
  const ios = (id: string) => {
    if (!udidSchema.safeParse(id).success) throw new ExpectedOperationError("invalid_input", "Use an iOS simulator UDID here. For a connected iPhone or iPad, select kind physical from device discovery.");
    return id;
  };
  const wireless = (serial: string) => /:\d+$|\._adb(?:-tls-connect)?\._tcp\.?$/.test(serial);
  const adbShell = async (serial: string, args: string[], timeout = 10_000) => adb(serial, ["shell", ...args], timeout);
  return {
    physicalAndroid: {
      async ready(deviceId) {
        const listing = await commands.run(await commands.adb(), ["devices"], { timeout: 10_000 }).catch(error => { throw androidInstallError(error, "Reading the connected Android devices"); });
        const state = listing.split(/\r?\n/).map(line => line.trim().split(/\s+/)).find(parts => parts[0] === deviceId)?.[1];
        if (!state) throw new ExpectedOperationError("device_unavailable", wireless(deviceId)
          ? "This wireless Android device is no longer connected; its address changes when it reconnects. Reconnect it and refresh Devices to pick it again."
          : "The Android phone is no longer connected. Reconnect it with USB debugging on and refresh Devices.");
        if (state === "unauthorized") throw new ExpectedOperationError("device_unavailable", "The Android phone has not authorized this Mac. Unlock it and accept the USB debugging prompt, then try again.");
        if (state === "offline") throw new ExpectedOperationError("device_unavailable", "The Android phone is offline. Reconnect the cable, or toggle USB debugging, then refresh Devices.");
        if (state !== "device") throw new ExpectedOperationError("device_unavailable", `The Android phone is ${state}. Reconnect it and refresh Devices.`);
        const [power, window] = await Promise.all([adbShell(deviceId, ["dumpsys", "power"]), adbShell(deviceId, ["dumpsys", "window"], 15_000)].map(read => read.catch(() => "")));
        const block = androidScreenBlock(power!, window!);
        if (block) throw new ExpectedOperationError("device_unavailable", `The Android phone is ${block === "asleep" ? "asleep" : "locked"}. Unlock it and keep the screen on (Developer options → Stay awake), then try again.`);
      },
      async hasApp(deviceId, appId) {
        const user = (await adbShell(deviceId, ["am", "get-current-user"]).catch(() => "0")).trim();
        const args = /^\d+$/.test(user) ? ["--user", user] : [];
        try { return parsePmPaths(await adbShell(deviceId, ["pm", "path", ...args, appId])).length > 0; } catch { return false; }
      },
      async launch(deviceId, appId) {
        try { await adbShell(deviceId, ["monkey", "-p", appId, "-c", "android.intent.category.LAUNCHER", "1"], 30_000); }
        catch (error) { throw androidInstallError(error, "Opening the app", appId); }
      },
      async installFrom(deviceId, appId, sources) {
        const abis = (await adbShell(deviceId, ["getprop", "ro.product.cpu.abilist"]).catch(() => "")).trim().split(",").filter(Boolean);
        let mismatch = false;
        for (const source of sources) {
          const remotes = parsePmPaths(await adbShell(source, ["pm", "path", appId]).catch(() => ""));
          if (remotes.length === 0) continue;
          let installed = false;
          await withTemporaryDirectory(async directory => {
            const files: string[] = [];
            for (const [index, remote] of remotes.entries()) {
              const local = join(directory, `${index}-${remote.split("/").at(-1)}`);
              await adb(source, ["pull", remote, local], 120_000);
              files.push(local);
            }
            const entries: string[] = [];
            for (const file of files) entries.push(...(await commands.run("unzip", ["-Z1", file], { timeout: 30_000 }).catch(() => "")).split(/\r?\n/));
            const shipped = [...apkAbis(entries), ...splitNameAbis(files)];
            if (abis.length > 0 && !abiCompatible(abis, shipped)) { mismatch = true; return; }
            try { await adb(deviceId, files.length === 1 ? ["install", "-r", files[0]!] : ["install-multiple", "-r", ...files], 300_000); }
            catch (error) { throw androidInstallError(error, "Installing the app", appId); }
            installed = true;
          });
          if (installed) return "installed";
        }
        if (mismatch) throw new ExpectedOperationError("app_unavailable", `${appId} on the other devices has no native code for this phone's CPU (${abis.join(", ")}). Build and install it on this phone (for an Expo app, \`npx expo run:android --device\`).`);
        return "no_source";
      },
    },
    physicalIos: {
      async ready(deviceId, options) {
        const device = (await listIosDevices()).find(entry => entry.udid === deviceId);
        if (!device) throw new ExpectedOperationError("device_unavailable", "The iPhone or iPad is no longer in device discovery. Reconnect it and refresh Devices.");
        if (device.state !== "connected" || device.pairingState !== "paired") throw new ExpectedOperationError("device_unavailable", `${device.name} is not connected and paired. Reconnect and trust this Mac, then refresh Devices.`);
        // Developer Mode is what lets the test runner start; a phone without it fails minutes later with a signing-like error.
        if (await developerModeDisabledWith(commands.run, deviceId)) throw new ExpectedOperationError("device_unavailable", `Developer Mode is off on ${device.name}. Turn it on in Settings → Privacy & Security → Developer Mode, restart the phone, then try again.`);
        await ensureIosSigning({ projectPath: options?.projectPath });
      },
      async hasApp(deviceId, appId) {
        try {
          const output = await commands.run("/usr/bin/xcrun", ["devicectl", "device", "info", "apps", "--device", deviceId, "--include-all-apps", "--quiet", "--timeout", "10", "--omit-deprecated-fields-in-json", "--json-output", "-"], { timeout: 15_000 });
          const parsed = JSON.parse(output) as { result?: { apps?: { bundleIdentifier?: string }[] } };
          return parsed.result?.apps?.some(app => app.bundleIdentifier === appId) ?? false;
        } catch (error) { throw physicalIosError(error, "Reading the apps on the device"); }
      },
      async launch(deviceId, appId) {
        try { await commands.run("/usr/bin/xcrun", ["devicectl", "device", "process", "launch", "--device", deviceId, appId], { timeout: 30_000 }); }
        catch (error) { throw physicalIosError(error, "Opening the app", appId); }
      },
      async install(deviceId, appId, options) {
        const build = await findDeviceBuild(appId, commands, options?.projectPath);
        if (!build) return "no_build";
        try { await commands.run("/usr/bin/xcrun", ["devicectl", "device", "install", "app", "--device", deviceId, build], { timeout: 300_000 }); }
        catch (error) { throw physicalIosError(error, "Installing the app", appId); }
        return "installed";
      },
    },
    async isBooted(platform, deviceId) {
      if (platform === "ios") return (await deps.simulators.device(ios(deviceId))).state === "Booted";
      return (await deps.android.device(deviceId)).state === "Booted";
    },
    async boot(platform, deviceId, signal) {
      if (platform === "ios") {
        const udid = ios(deviceId);
        await simctl(["boot", udid]).catch(error => {
          // Another lane or the user may have started it between the check and here.
          if (!/current state: Booted|already booted/i.test(String((error as { stderr?: string })?.stderr ?? error))) throw error;
        });
        signal.throwIfAborted();
        // `-b` waits for the boot to finish, not just for the device to exist.
        await commands.run("xcrun", ["simctl", "bootstatus", udid, "-b"], { timeout: 240_000 });
        return udid;
      }
      const before = await deps.android.device(deviceId);
      const status = await deps.android.boot(deviceId);
      if (!deviceId.startsWith("avd:")) return deviceId;
      const running = status.devices.find(device => device.kind === "emulator" && device.name === before.name && device.state === "Booted");
      if (!running) throw new ExpectedOperationError("device_unavailable", `${before.name} did not come up as a running emulator.`);
      return running.udid;
    },
    async hasApp(platform, deviceId, appId) {
      try {
        if (platform === "ios") { await simctl(["get_app_container", ios(deviceId), appId, "app"]); return true; }
        return parsePmPaths(await adb(deviceId, ["shell", "pm", "path", appId])).length > 0;
      } catch { return false; }
    },
    async copyApp(platform, from, to, appId, signal) {
      if (platform === "ios") {
        const path = (await simctl(["get_app_container", ios(from), appId, "app"])).trim();
        signal.throwIfAborted();
        await simctl(["install", ios(to), path], 300_000);
        return;
      }
      const remotes = parsePmPaths(await adb(from, ["shell", "pm", "path", appId]));
      if (remotes.length === 0) throw new ExpectedOperationError("app_unavailable", `${appId} is not installed on ${from}.`);
      await withTemporaryDirectory(async directory => {
        const files: string[] = [];
        for (const [index, remote] of remotes.entries()) {
          signal.throwIfAborted();
          const local = join(directory, `${index}-${remote.split("/").at(-1)}`);
          await adb(from, ["pull", remote, local], 120_000);
          files.push(local);
        }
        signal.throwIfAborted();
        // Split APKs only install together; a single one takes the plain path.
        await adb(to, files.length === 1 ? ["install", "-r", files[0]!] : ["install-multiple", "-r", ...files], 300_000);
      });
    },
    async launch(platform, deviceId, appId) { await deps.drivers({ platform, deviceId }).launch(appId); },
    async bootedDevices(platform) {
      const status = await (platform === "ios" ? deps.simulators.list() : deps.android.list());
      return status.devices.flatMap(device => "state" in device && device.state === "Booted" && (device.platform ?? platform) === platform ? [{ deviceId: device.udid, name: device.name }] : []);
    },
    foregroundApp: async (platform, deviceId) => deps.foreground ? deps.foreground(platform, deviceId) : null,
  };
}
