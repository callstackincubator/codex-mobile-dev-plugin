import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

export async function copyPNGToClipboard(bytes: Buffer): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "mobile-dev-screenshot-"));
  try {
    const path = join(directory, "screenshot.png");
    await writeFile(path, bytes, { mode: 0o600 });
    await execute("/usr/bin/osascript", ["-e", `on run argv
set the clipboard to (read (POSIX file (item 1 of argv)) as «class PNGf»)
end run`, path], { timeout: 5000, maxBuffer: 64 * 1024 });
  } finally { await rm(directory, { recursive: true, force: true }); }
}
