import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { listAllDevices, type Device } from "./adb.ts";
import { execText, type ExecResult } from "./exec.ts";

export type EmulatorLaunch = {
  serial: string;
  proc: ChildProcess | null;
  ownsProcess: boolean;
  stop: () => void;
};

export type RunningAvd = {
  serial: string;
  avd: string;
  state: string;
};

export type StartEmulatorOpts = {
  avd: string;
  emulatorPath?: string;
  port?: number;
  restartAvd?: boolean;
  bootTimeoutMs?: number;
  /**
   * Emulator `-gpu` mode. Defaults to `host` because the AVD's own `auto`
   * frequently falls back to a software Vulkan compositor (llvmpipe/lavapipe),
   * which caps the guest at a janky ~20fps and makes the stream stutter no
   * matter how good the transport is. `host` uses the real GPU (Metal/Vulkan)
   * for smooth ~60fps rendering. Pass `swiftshader_indirect` for headless hosts
   * without a usable GPU.
   */
  gpu?: string;
};

export type EmulatorResolverDependencies = {
  execText?: typeof execText;
  existsSync?: typeof existsSync;
  env?: NodeJS.ProcessEnv;
  cacheKey?: string;
};

export type EmulatorRuntimeDependencies = EmulatorResolverDependencies & {
  listAllDevices?: typeof listAllDevices;
  spawn?: typeof spawn;
  sleep?: (delayMs: number) => Promise<unknown>;
  now?: () => number;
};

function execSucceeded(result: ExecResult<string>): boolean {
  return result.status === 0 && result.error === null;
}

function execFailure(result: ExecResult<string>): string {
  return (
    result.stderr.trim() ||
    result.error?.message ||
    result.stdout.trim() ||
    "unknown error"
  );
}

let emulatorResolutionCache: {
  key: string;
  resolution: Promise<string>;
} | null = null;

function sdkEmulatorCandidates(env: NodeJS.ProcessEnv): string[] {
  const roots = [
    env.ANDROID_HOME,
    env.ANDROID_SDK_ROOT,
    env.HOME ? join(env.HOME, "Library", "Android", "sdk") : undefined,
  ].filter((v): v is string => Boolean(v));
  return [...new Set(roots)].flatMap((root) => [
    join(root, "emulator", "emulator"),
    join(root, "tools", "emulator"),
  ]);
}

function emulatorEnvironmentKey(env: NodeJS.ProcessEnv): string {
  return [
    env.PATH ?? "",
    env.ANDROID_HOME ?? "",
    env.ANDROID_SDK_ROOT ?? "",
    env.HOME ?? "",
  ].join("\0");
}

export function clearEmulatorResolutionCache(): void {
  emulatorResolutionCache = null;
}

export async function resolveEmulator(
  explicit?: string,
  dependencies: EmulatorResolverDependencies = {},
): Promise<string> {
  if (explicit) return explicit;

  const env = dependencies.env ?? process.env;
  const cacheKey = dependencies.cacheKey ?? emulatorEnvironmentKey(env);
  if (emulatorResolutionCache?.key === cacheKey) {
    return emulatorResolutionCache.resolution;
  }

  const runExec = dependencies.execText ?? execText;
  const pathExists = dependencies.existsSync ?? existsSync;
  const resolution = (async () => {
    const pathProbe = await runExec("emulator", ["-version"], {
      timeout: 5_000,
      maxBuffer: 64 * 1024,
    });
    if (
      (pathProbe.status === 0 && !pathProbe.error) ||
      pathProbe.error?.message.includes("EPIPE")
    ) {
      return "emulator";
    }

    for (const candidate of sdkEmulatorCandidates(env)) {
      if (pathExists(candidate)) return candidate;
    }

    throw new Error(
      "Could not find Android Emulator. Put `emulator` on PATH or set ANDROID_HOME / ANDROID_SDK_ROOT.",
      { cause: pathProbe.error ?? undefined },
    );
  })();
  emulatorResolutionCache = { key: cacheKey, resolution };
  try {
    return await resolution;
  } catch (error) {
    if (emulatorResolutionCache?.resolution === resolution) {
      emulatorResolutionCache = null;
    }
    throw error;
  }
}

async function listAvdsWithEmulator(
  emulator: string,
  runExec: typeof execText = execText,
): Promise<string[]> {
  const r = await runExec(emulator, ["-list-avds"], {
    timeout: 5_000,
    maxBuffer: 1024 * 1024,
  });
  if (!execSucceeded(r)) {
    throw new Error(
      `emulator -list-avds failed: ${execFailure(r)}`,
      { cause: r.error ?? undefined },
    );
  }
  return r.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function listAvds(
  emulatorPath?: string,
  dependencies: EmulatorResolverDependencies = {},
): Promise<string[]> {
  return listAvdsWithEmulator(
    await resolveEmulator(emulatorPath, dependencies),
    dependencies.execText,
  );
}

function avdName(avd: string): string {
  return avd.startsWith("@") ? avd.slice(1) : avd;
}

function emulatorAvdArg(avd: string): string {
  return avd.startsWith("@") ? avd : `@${avd}`;
}

async function usedEmulatorPorts(
  readDevices: typeof listAllDevices = listAllDevices,
): Promise<Set<number>> {
  const ports = new Set<number>();
  for (const device of await readDevices()) {
    const match = device.serial.match(/^emulator-(\d+)$/);
    if (match) ports.add(Number(match[1]));
  }
  return ports;
}

async function pickEmulatorPort(
  readDevices: typeof listAllDevices = listAllDevices,
): Promise<number> {
  const used = await usedEmulatorPorts(readDevices);
  for (let port = 5554; port <= 5682; port += 2) {
    if (!used.has(port)) return port;
  }
  throw new Error("No available emulator console ports in the 5554-5682 range.");
}

function validateEmulatorPort(port: number): void {
  if (!Number.isInteger(port) || port < 5554 || port > 5682 || port % 2 !== 0) {
    throw new Error("--emulator-port must be an even integer from 5554 through 5682.");
  }
}

function adb(
  serial: string,
  args: string[],
  runExec: typeof execText = execText,
): Promise<ExecResult<string>> {
  return runExec("adb", ["-s", serial, ...args], { timeout: 5_000 });
}

function parseEmuAvdName(stdout: string): string | null {
  return (
    stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && line !== "OK" && !line.startsWith("KO:")) ?? null
  );
}

async function runningAvdName(
  serial: string,
  runExec: typeof execText = execText,
): Promise<string | null> {
  const fromConsole = await adb(serial, ["emu", "avd", "name"], runExec);
  if (execSucceeded(fromConsole)) {
    const name = parseEmuAvdName(fromConsole.stdout);
    if (name) return name;
  }

  const fromProp = await adb(
    serial,
    ["shell", "getprop", "ro.boot.qemu.avd_name"],
    runExec,
  );
  if (execSucceeded(fromProp)) {
    const name = fromProp.stdout.trim();
    if (name) return name;
  }

  return null;
}

export async function resolveRunningAvds(
  devices: readonly Device[],
  runExec: typeof execText = execText,
): Promise<RunningAvd[]> {
  const emulators = devices.filter((device) =>
    /^emulator-\d+$/.test(device.serial),
  );
  const named = await Promise.all(
    emulators.map(async (device) => {
      const avd = await runningAvdName(device.serial, runExec);
      return avd ? { serial: device.serial, avd, state: device.state } : null;
    }),
  );
  return named.filter((entry): entry is RunningAvd => entry !== null);
}

export async function listRunningAvds(
  devices?: readonly Device[],
  dependencies: Pick<EmulatorRuntimeDependencies, "execText" | "listAllDevices"> = {},
): Promise<RunningAvd[]> {
  const snapshot = devices ?? (await (dependencies.listAllDevices ?? listAllDevices)());
  return resolveRunningAvds(snapshot, dependencies.execText);
}

async function findRunningAvd(
  name: string,
  dependencies: Pick<EmulatorRuntimeDependencies, "execText" | "listAllDevices"> = {},
): Promise<RunningAvd | null> {
  return (await listRunningAvds(undefined, dependencies)).find(
    (running) => running.avd === name,
  ) ?? null;
}

export async function stopEmulator(
  serial: string,
  runExec: typeof execText = execText,
): Promise<void> {
  const r = await adb(serial, ["emu", "kill"], runExec);
  if (!execSucceeded(r)) {
    throw new Error(`Failed to stop ${serial}: ${execFailure(r)}`);
  }
}

async function waitForEmulatorExit(
  serial: string,
  timeoutMs = 30_000,
  dependencies: Pick<EmulatorRuntimeDependencies, "listAllDevices" | "sleep" | "now"> = {},
): Promise<void> {
  const now = dependencies.now ?? Date.now;
  const pause = dependencies.sleep ?? sleep;
  const readDevices = dependencies.listAllDevices ?? listAllDevices;
  const startedAt = now();
  while (now() - startedAt < timeoutMs) {
    if (!(await readDevices()).some((device) => device.serial === serial)) return;
    await pause(500);
  }
  throw new Error(`Timed out waiting for ${serial} to stop.`);
}

async function waitForBoot(
  serial: string,
  proc: ChildProcess,
  timeoutMs: number,
  dependencies: Pick<EmulatorRuntimeDependencies, "execText" | "sleep" | "now"> = {},
): Promise<void> {
  const now = dependencies.now ?? Date.now;
  const pause = dependencies.sleep ?? sleep;
  const runExec = dependencies.execText ?? execText;
  const startedAt = now();
  while (now() - startedAt < timeoutMs) {
    if (proc.exitCode !== null || proc.signalCode !== null) {
      throw new Error(`emulator exited before boot completed (code ${proc.exitCode ?? "null"})`);
    }

    const state = await adb(serial, ["get-state"], runExec);
    if (execSucceeded(state) && state.stdout.trim() === "device") {
      const boot = await adb(
        serial,
        ["shell", "getprop", "sys.boot_completed"],
        runExec,
      );
      if (execSucceeded(boot) && boot.stdout.trim() === "1") return;
    }

    await pause(1_000);
  }

  throw new Error(`Timed out waiting for ${serial} to boot.`);
}

export async function startEmulator(
  opts: StartEmulatorOpts,
  dependencies: EmulatorRuntimeDependencies = {},
): Promise<EmulatorLaunch> {
  const runExec = dependencies.execText ?? execText;
  const emulator = await resolveEmulator(opts.emulatorPath, dependencies);
  const name = avdName(opts.avd);
  const avds = await listAvdsWithEmulator(emulator, runExec);
  if (!avds.includes(name)) {
    const available = avds.length ? avds.join(", ") : "(none)";
    throw new Error(`Unknown AVD "${name}". Available AVDs: ${available}`);
  }

  const running = await findRunningAvd(name, dependencies);
  if (running) {
    if (!opts.restartAvd) {
      return { serial: running.serial, proc: null, ownsProcess: false, stop: () => {} };
    }
    await stopEmulator(running.serial, runExec);
    await waitForEmulatorExit(running.serial, 30_000, dependencies);
  }

  const port = opts.port ?? (await pickEmulatorPort(dependencies.listAllDevices));
  validateEmulatorPort(port);

  const args = [emulatorAvdArg(name), "-port", String(port)];
  if (opts.gpu) args.push("-gpu", opts.gpu);

  const proc = (dependencies.spawn ?? spawn)(emulator, args, {
    stdio: ["ignore", "inherit", "inherit"],
  });
  const spawnError = new Promise<never>((_, reject) => {
    proc.once("error", reject);
  });
  const serial = `emulator-${port}`;
  let stopped = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    adb(serial, ["emu", "kill"], runExec).catch(() => {});
    try {
      proc.kill("SIGTERM");
    } catch {}
  };

  try {
    await Promise.race([
      waitForBoot(
        serial,
        proc,
        opts.bootTimeoutMs ?? 120_000,
        dependencies,
      ),
      spawnError,
    ]);
    return { serial, proc, ownsProcess: true, stop };
  } catch (err) {
    stop();
    throw err;
  }
}
