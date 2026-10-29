import { execFile } from "node:child_process";
import type { ExecFileOptions } from "node:child_process";
import { access, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, delimiter, dirname, isAbsolute, join, relative } from "node:path";
import { promisify } from "node:util";
import { classifyProcessFailure } from "@mobile-dev/shared/error-diagnostics.ts";
import { bundledFile } from "./bundled-runtime.ts";
import { isMissingFile, MissingRuntimeError } from "./install-integrity.ts";

export const BAGUETTE_RUNTIME_TIMEOUT_MS = 5000;

const execute = promisify(execFile);
type RuntimeCommand = (command: string, args: string[], options: ExecFileOptions & { encoding: "utf8"; signal: AbortSignal }) => Promise<{ stdout: string }>;

export async function baguetteEnvironment(executable: string, signal: AbortSignal, run: RuntimeCommand = execute): Promise<NodeJS.ProcessEnv> {
  const deadline = AbortSignal.timeout(BAGUETTE_RUNTIME_TIMEOUT_MS);
  const discoverySignal = AbortSignal.any([signal, deadline]);
  discoverySignal.throwIfAborted();
  let developer: string;
  try {
    const selection = await run("/usr/bin/xcode-select", ["--print-path"], {
      signal: discoverySignal, encoding: "utf8", maxBuffer: 64 * 1024,
    });
    const selectedDeveloper = selection.stdout.trim();
    if (isAbsolute(selectedDeveloper) === false) throw new Error("Invalid developer directory.");
    developer = await realpath(selectedDeveloper);
    const xcodebuild = join(developer, "usr/bin/xcodebuild");
    await access(xcodebuild, constants.X_OK);
  } catch {
    discoverySignal.throwIfAborted();
    throw new Error("Baguette requires a full Xcode installation. Install Xcode 26 or later and select it in Xcode Settings > Locations > Command Line Tools.");
  }

  const environment: NodeJS.ProcessEnv = { ...process.env, DEVELOPER_DIR: developer };
  // Only the selected toolchain supplies Baguette's additional Swift libraries.
  delete environment.DYLD_LIBRARY_PATH;
  try {
    const commands = await run("/usr/bin/otool", ["-l", executable], {
      env: environment, signal: discoverySignal, encoding: "utf8", maxBuffer: 1024 * 1024,
    });
    const blocks = commands.stdout.split("Load command");
    const required = new Set<string>();
    for (const block of blocks) {
      if (block.includes("cmd LC_LOAD_DYLIB") === false && block.includes("cmd LC_REEXPORT_DYLIB") === false) continue;
      const match = /^\s+name (@rpath\/libswift[^/]+\.dylib) \(offset \d+\)$/m.exec(block);
      if (match === null) continue;
      const name = basename(match[1]);
      required.add(name);
    }
    const scan = await run("/usr/bin/xcrun", [
      "swift-stdlib-tool", "--print", "--scan-executable", executable, "--platform", "macosx",
    ], { env: environment, signal: discoverySignal, encoding: "utf8", maxBuffer: 64 * 1024 });
    const output = scan.stdout.trim();
    const libraries = output.length > 0 ? output.split("\n") : [];
    const directories = new Set<string>();
    const discovered = new Set<string>();
    for (const library of libraries) {
      const physicalLibrary = await realpath(library);
      const location = relative(developer, physicalLibrary);
      if (isAbsolute(library) === false || location.startsWith("Toolchains/") === false) {
        throw new Error("Swift library is outside the selected Xcode toolchain.");
      }
      const directory = dirname(library);
      if (directory.includes(delimiter)) throw new Error("Swift library directory cannot be used as a loader search path.");
      await access(library, constants.R_OK);
      directories.add(directory);
      const name = basename(library);
      discovered.add(name);
    }
    for (const name of required) {
      if (discovered.has(name) === false) throw new Error("The selected toolchain is missing a required Swift library.");
    }
    if (directories.size > 0) {
      const paths = [...directories];
      environment.DYLD_LIBRARY_PATH = paths.join(delimiter);
    }
  } catch {
    discoverySignal.throwIfAborted();
    throw new Error("The selected Xcode cannot supply Baguette's required Swift runtime libraries. Install Xcode 26 or later and select it in Xcode Settings > Locations > Command Line Tools.");
  }
  discoverySignal.throwIfAborted();
  return environment;
}

export type BaguetteRuntime = { executable: string; env: NodeJS.ProcessEnv };
/** Finds Baguette and the environment it runs in; tests replace it. */
export type BaguetteRuntimeReader = (signal: AbortSignal, executable?: string) => Promise<BaguetteRuntime>;
type Toolchain = Pick<NodeJS.ProcessEnv, "DEVELOPER_DIR" | "DYLD_LIBRARY_PATH">;
type Discovery = { executable: string; selection: string; toolchain: Promise<Toolchain> };
let discovery: Discovery | undefined;

/**
 * The bundled Baguette and the selected Xcode's environment for it. Discovery runs once per Xcode
 * selection, which `xcode-select` reads cheaply; a failed discovery or spawn discovers again.
 */
export async function baguetteRuntime(signal: AbortSignal, executable = bundledFile("baguette/Baguette"), run: RuntimeCommand = execute): Promise<BaguetteRuntime> {
  signal.throwIfAborted();
  await access(executable, constants.X_OK).catch(error => {
    if (isMissingFile(error)) throw new MissingRuntimeError("baguette");
    throw new Error("Mobile Dev cannot run its bundled simulator backend. Reinstall Mobile Dev, then restart the app running it.");
  });
  const selectionSignal = AbortSignal.any([signal, AbortSignal.timeout(BAGUETTE_RUNTIME_TIMEOUT_MS)]);
  // A failed read leaves its explanation to the full discovery.
  const selection = await run("/usr/bin/xcode-select", ["--print-path"], { signal: selectionSignal, encoding: "utf8", maxBuffer: 64 * 1024 })
    .then(result => result.stdout.trim(), () => "");
  signal.throwIfAborted();
  let current = discovery;
  if (current === undefined || current.executable !== executable || current.selection !== selection || selection === "") {
    // Callers share the discovery, so one caller's cancellation leaves it running for the others.
    const toolchain = baguetteEnvironment(executable, new AbortController().signal, run)
      .then(({ DEVELOPER_DIR, DYLD_LIBRARY_PATH }) => ({ DEVELOPER_DIR, DYLD_LIBRARY_PATH }));
    const started: Discovery = { executable, selection, toolchain };
    discovery = current = started;
    toolchain.catch(() => { if (discovery === started) discovery = undefined; });
  }
  const { DEVELOPER_DIR, DYLD_LIBRARY_PATH } = await untilAborted(current.toolchain, signal);
  const env: NodeJS.ProcessEnv = { ...process.env, DEVELOPER_DIR };
  delete env.DYLD_LIBRARY_PATH;
  if (DYLD_LIBRARY_PATH !== undefined) env.DYLD_LIBRARY_PATH = DYLD_LIBRARY_PATH;
  return { executable, env };
}

/**
 * Discovers the runtime again after Baguette could not start or load, as a changed toolchain can
 * cause. Without an error, or for a failure to launch or a crash, rather than a command's own failure.
 */
export function forgetBaguetteRuntime(error?: unknown) {
  const { termination } = classifyProcessFailure(error);
  if (error === undefined || termination === "missing_executable" || termination === "signal" || termination === "system_error") discovery = undefined;
}

async function untilAborted<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
  });
  try { return await Promise.race([pending, aborted]); }
  finally { signal.removeEventListener("abort", abort); }
}
