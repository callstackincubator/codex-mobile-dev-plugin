import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export async function createLaunchShell(directory, executable) {
  const nodeDirectory = dirname(executable);
  const escaped = nodeDirectory.replaceAll("'", "'\\''");
  const path = join(directory, "configured shell");
  const script = `#!/bin/sh\nexport PATH='${escaped}':/usr/bin:/bin:/usr/sbin:/sbin\nexec /bin/zsh -f "$@"\n`;
  await writeFile(path, script, { mode: 0o755 });
  return path;
}
