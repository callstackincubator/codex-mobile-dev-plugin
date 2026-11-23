import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import type { Status } from "@mobile-dev/shared/protocol.ts";
import { recordAndroidRamProfileBoot } from "./telemetry.ts";

export function parseAvdName(stdout: string | undefined): string | undefined {
  const lines = stdout?.split(/\r?\n/).map(line => line.trim()).filter(Boolean) ?? [];
  if (lines.some(line => line === "KO" || line.startsWith("KO:"))) return;
  return lines.find(line => line !== "OK");
}

type BootOptions = {
  name: string;
  executable: string;
  signal: AbortSignal;
  ready: () => Promise<Status | undefined>;
  resourceSaving?: boolean;
  ramMiB?: number;
};

export async function bootAndroidEmulator(options: BootOptions, launch: typeof spawn = spawn): Promise<Status> {
  options.signal.throwIfAborted();
  if (options.ramMiB === undefined) return launchAndWait(options, launch);
  if (!Number.isSafeInteger(options.ramMiB) || options.ramMiB < 1536 || options.ramMiB > 8192) {
    throw new Error("Android emulator RAM must be an integer between 1536 and 8192 MiB.");
  }
  const started = performance.now();
  let outcome: "booted" | "failed" = "failed";
  try {
    const status = await launchAndWait(options, launch);
    outcome = "booted";
    return status;
  } finally { recordAndroidRamProfileBoot(performance.now() - started, outcome); }
}

async function launchAndWait(options: BootOptions, launch: typeof spawn): Promise<Status> {
  const args = ["-avd", options.name, "-no-window", "-no-boot-anim", "-gpu", "host"];
  // Headless Quick Boot on Windows can leave adb offline or hang shell commands after restore.
  if (process.platform === "win32" || options.resourceSaving !== undefined) args.push("-no-snapshot-load", "-no-snapshot-save");
  if (options.ramMiB !== undefined) args.push("-memory", String(options.ramMiB));
  else if (options.resourceSaving) args.push("-lowram", "-memory", "1536");
  const child = launch(options.executable, args, {
    detached: true, stdio: "ignore", shell: false, windowsHide: true,
  });
  // The failure promise stays resolved after an early exit, including during an adb read.
  const failed = new Promise<Error>(resolve => {
    child.once("error", error => resolve(new Error(`Cannot start Android emulator ${options.name}. ${error.message}`)));
    child.once("exit", (code, signal) => resolve(new Error(`Android emulator ${options.name} exited before booting. code=${code ?? "none"} signal=${signal ?? "none"}. Start this AVD in Android Studio to read its error.`)));
  });
  const launched = new Promise<void>(resolve => child.once("spawn", resolve));
  const controller = new AbortController();
  const signal = AbortSignal.any([options.signal, controller.signal]);
  const stoppedError = () => new Error(options.signal.aborted
    ? "The plugin server closed while the Android emulator was starting."
    : "The Android emulator did not finish booting within two minutes. Refresh its status.");
  let stop!: () => void;
  const stopped = new Promise<Error>(resolve => {
    stop = () => resolve(stoppedError());
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) stop();
  });
  const deadline = setTimeout(() => controller.abort(), 120000);
  try {
    const first = await Promise.race([launched, failed, stopped]);
    if (first instanceof Error) throw first;
    child.unref();
    while (true) {
      const next = await Promise.race([options.ready(), failed, stopped]);
      if (next instanceof Error) throw next;
      if (next) return next;
      const paused = await Promise.race([delay(1000, undefined, { signal }).catch(() => {}), failed, stopped]);
      if (paused instanceof Error) throw paused;
    }
  } finally {
    clearTimeout(deadline);
    signal.removeEventListener("abort", stop);
    controller.abort();
  }
}
