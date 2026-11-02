// Host-side dialogs for the profile and source folder. A panel frame only sees a `File` with no path, and
// sending the profile's bytes over MCP would put tens of megabytes on the bridge.

import { execFile } from "node:child_process";
import { platform } from "node:os";

// Past this the user has walked away; a lingering dialog process is worse than a refusal the panel can retry.
const PICKER_TIMEOUT_MS = 5 * 60 * 1000;

export class ProfilePickerError extends Error {
  constructor(message: string) { super(message); this.name = "ProfilePickerError"; }
}

/** Nothing chosen is the ordinary outcome of pressing Cancel, not a failure. */
export type Picked = { picked: true; path: string } | { picked: false };
export type PickedProfile = Picked;

const APPLESCRIPT = `set chosen to choose file with prompt "Choose a CPU or React profile" of type {"public.json", "json"}
POSIX path of chosen`;

const APPLESCRIPT_FOLDER = `set chosen to choose folder with prompt "Choose the project this profile belongs to"
POSIX path of chosen`;

const POWERSHELL = `Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Filter = 'Profiles (*.json;*.cpuprofile)|*.json;*.cpuprofile|All files (*.*)|*.*'
$dialog.Title = 'Choose a CPU or React profile'
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.FileName }`;

const POWERSHELL_FOLDER = `Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Choose the project this profile belongs to'
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath }`;

function command(): { file: string; args: string[] } {
  switch (platform()) {
    case "darwin": return { file: "osascript", args: ["-e", APPLESCRIPT] };
    case "win32": return { file: "powershell", args: ["-NoProfile", "-STA", "-Command", POWERSHELL] };
    // zenity ships with GNOME; kdialog is the KDE equivalent and is tried next.
    default: return { file: "zenity", args: ["--file-selection", "--title=Choose a CPU or React profile", "--file-filter=Profiles | *.json *.cpuprofile"] };
  }
}

function folderCommand(): { file: string; args: string[] } {
  switch (platform()) {
    case "darwin": return { file: "osascript", args: ["-e", APPLESCRIPT_FOLDER] };
    case "win32": return { file: "powershell", args: ["-NoProfile", "-STA", "-Command", POWERSHELL_FOLDER] };
    default: return { file: "zenity", args: ["--file-selection", "--directory", "--title=Choose the project this profile belongs to"] };
  }
}

function run(file: string, args: string[]) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    execFile(file, args, { timeout: PICKER_TIMEOUT_MS, maxBuffer: 64 * 1024 }, (error, stdout, stderr) => {
      // A non-zero exit is how every one of these dialogs reports Cancel, so it
      // is read rather than thrown; only a missing binary is a real failure.
      const code = error && typeof error === "object" && "code" in error ? error.code : 0;
      if (typeof code === "string") { reject(error); return; }
      resolve({ code: typeof code === "number" ? code : 0, stdout, stderr });
    });
  });
}

/** Cancel returns `{ picked: false }`; only a dialog that could not be opened throws. */
async function pick(chooser: () => { file: string; args: string[] }, fallback: string[]): Promise<Picked> {
  const { file, args } = chooser();
  let result;
  try { result = await run(file, args); }
  catch (error) {
    if (platform() === "linux" && error instanceof Error && "code" in error && error.code === "ENOENT") {
      try { result = await run("kdialog", fallback); }
      catch { throw new ProfilePickerError("No file dialog is available on this host. Install zenity or kdialog, or ask the agent to work by path."); }
    } else {
      throw new ProfilePickerError("This host could not open a file dialog. Ask the agent to work by path instead.");
    }
  }
  const path = result.stdout.trim();
  if (result.code !== 0 || path === "") return { picked: false };
  return { picked: true, path };
}

export const pickProfileFile = () => pick(command, ["--getopenfilename", ".", "*.json *.cpuprofile"]);

export const pickProjectFolder = () => pick(folderCommand, ["--getexistingdirectory", "."]);
