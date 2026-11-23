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
    const options = { timeout: 5000, maxBuffer: 64 * 1024 };
    if (process.platform === "win32") {
      await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-STA", "-Command", `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$image = [System.Drawing.Image]::FromFile($env:MOBILE_DEV_SCREENSHOT_FILE)
try { [System.Windows.Forms.Clipboard]::SetImage($image) } finally { $image.Dispose() }
`], { ...options, windowsHide: true, env: { ...process.env, MOBILE_DEV_SCREENSHOT_FILE: path } });
      return;
    }
    await execute("/usr/bin/osascript", ["-e", `on run argv
set the clipboard to (read (POSIX file (item 1 of argv)) as «class PNGf»)
end run`, path], options);
  } finally { await rm(directory, { recursive: true, force: true }); }
}
