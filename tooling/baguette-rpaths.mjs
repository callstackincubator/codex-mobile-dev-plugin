import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);

export async function removeBaguetteToolchainRpaths(executable) {
  const commands = await execute("otool", ["-l", executable], { maxBuffer: 1024 * 1024 });
  const blocks = commands.stdout.split("Load command");
  const paths = new Set();
  for (const block of blocks) {
    if (block.includes("LC_RPATH") === false) continue;
    const match = /^\s+path (.+) \(offset \d+\)$/m.exec(block);
    if (match === null) throw new Error("Baguette has an unreadable runtime search path.");
    const path = match[1];
    if (path.startsWith("/") && path.includes("/Toolchains/")) paths.add(path);
  }
  for (const path of paths) {
    await execute("install_name_tool", ["-delete_rpath", path, executable]);
  }
  if (paths.size > 0) await execute("codesign", ["--force", "--sign", "-", executable]);
}
