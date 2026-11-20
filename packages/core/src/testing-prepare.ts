import { join } from "node:path";
import { ExpectedOperationError } from "@mobile-dev/shared/error-reporting.ts";
import { udidSchema } from "@mobile-dev/shared/protocol.ts";
import { systemCommands, withTemporaryDirectory } from "./app-control/commands.ts";
import type { Commands } from "./app-control/commands.ts";
import type { DriverFactory } from "./app-control/tools.ts";
import type { ServeEmu } from "./serve-emu.ts";
import type { Simctl } from "./simctl.ts";
import type { Lane, LaneExecutor, MatrixPlatform } from "./testing-matrix.ts";
import type { TestRunProgress, TestRunResult } from "./testing-run.ts";

/** Home screens and system UI, which are never the app to record. */
export const LAUNCHER_APP = /^com\.apple\.springboard$|^com\.android\.systemui$|launcher/i;

/** The per-platform app ids of a matrix request: a project may use different ones on each platform. */
export interface MatrixAppIds { ios?: string; android?: string }

/** What preparing a device needs from the machine; faked in tests. */
export interface DeviceOps {
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
    if (other.runId === lane.runId || other.platform !== lane.platform) continue;
    const candidate = other.resolvedDeviceId ?? other.deviceId;
    if (await usable(candidate)) return candidate;
  }
  const booted = await ops.bootedDevices?.(lane.platform).catch(() => []) ?? [];
  for (const device of booted) if (await usable(device.deviceId)) return device.deviceId;
  return undefined;
}

const APK_PATH = /^\/[\w\-./=+@~]+\.apk$/;

/** Parses `adb shell pm path` output: one `package:<path>` line per APK, split APKs included. */
export function parsePmPaths(output: string): string[] {
  return output.split(/\r?\n/).map(line => line.trim()).filter(line => line.startsWith("package:")).map(line => line.slice("package:".length)).filter(path => APK_PATH.test(path));
}

/** The real thing: `simctl` for iOS simulators, the emulator through `ServeEmu` and `adb` for Android. */
export function systemDeviceOps(deps: { simulators: Simctl; android: ServeEmu; drivers: DriverFactory; commands?: Commands; foreground?: (platform: MatrixPlatform, deviceId: string) => Promise<string | null> }): DeviceOps {
  const commands = deps.commands ?? systemCommands;
  const simctl = (args: string[], timeout = 30_000) => commands.run("xcrun", ["simctl", ...args], { timeout });
  const adb = async (serial: string, args: string[], timeout = 30_000) => commands.run(await commands.adb(), ["-s", serial, ...args], { timeout });
  const ios = (id: string) => { udidSchema.parse(id); return id; };
  return {
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
