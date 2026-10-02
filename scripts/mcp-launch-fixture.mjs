import { mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";

export async function createLaunchHome(directory, executable) {
  const fixtureHome = join(directory, "Codex home");
  const runtimeDirectory = join(fixtureHome, ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin");
  await mkdir(runtimeDirectory, { recursive: true });
  const runtime = join(runtimeDirectory, "node");
  await symlink(executable, runtime);
  return fixtureHome;
}
