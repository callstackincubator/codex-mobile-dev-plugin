import { mkdir, symlink } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { spawnSync } from "node:child_process";

export const systemPath = process.platform === "win32"
  ? ["System32", "System32/WindowsPowerShell/v1.0"].map(dir => join(process.env.SystemRoot, dir)).join(";")
  : "/usr/bin:/bin:/usr/sbin:/sbin";

// Node's spawnSync does not resolve batch commands the way Codex does.
export function probeLauncher(command, args, options) {
  if (process.platform === "win32") return spawnSync(process.env.ComSpec, ["/d", "/c", normalize(command), ...args], options);
  return spawnSync(command, args, options);
}

export async function createLaunchHome(directory, executable) {
  const fixtureHome = join(directory, "Codex home");
  const runtimeDirectory = join(fixtureHome, ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin");
  if (process.platform === "win32") {
    // Include the DLLs beside node.exe. Directory junctions work without Developer Mode.
    await mkdir(dirname(runtimeDirectory), { recursive: true });
    await symlink(dirname(executable), runtimeDirectory, "junction");
  } else {
    await mkdir(runtimeDirectory, { recursive: true });
    await symlink(executable, join(runtimeDirectory, "node"));
  }
  return fixtureHome;
}
