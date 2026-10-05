import { execFile } from "node:child_process";
import type { ExecFileOptions } from "node:child_process";
import { access, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, delimiter, dirname, isAbsolute, join, relative } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
type RuntimeCommand = (command: string, args: string[], options: ExecFileOptions & { encoding: "utf8"; signal: AbortSignal }) => Promise<{ stdout: string }>;

export async function baguetteEnvironment(executable: string, signal: AbortSignal, run: RuntimeCommand = execute): Promise<NodeJS.ProcessEnv> {
  const deadline = AbortSignal.timeout(5000);
  const discoverySignal = AbortSignal.any([signal, deadline]);
  discoverySignal.throwIfAborted();
  let developer: string;
  try {
    const selection = await run("/usr/bin/xcode-select", ["--print-path"], {
      signal: discoverySignal, encoding: "utf8", maxBuffer: 64 * 1024,
    });
    developer = selection.stdout.trim();
    if (isAbsolute(developer) === false) throw new Error("Invalid developer directory.");
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
    const toolchainRoot = await realpath(developer);
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
      const location = relative(toolchainRoot, physicalLibrary);
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
