import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { promisify } from "node:util";
import { pickProjectFolder } from "./profile-picker.ts";

const execute = promisify(execFile);
const PROMPT = "Choose your React Native project folder";

/**
 * Open a native folder picker on the machine that runs the MCP server.
 *
 * Returns the chosen folder without its trailing slash, or `undefined` when the user cancels.
 */
export async function chooseProjectFolder(): Promise<string | undefined> {
  if (process.platform === "win32") {
    const folder = await pickProjectFolder();
    return folder.picked ? folder.path : undefined;
  }
  if (process.platform !== "darwin") throw new Error("Choosing a folder needs macOS.");
  const { stdout } = await execute("/usr/bin/osascript", ["-e", `on run argv
  try
    tell application "System Events" to activate
  end try
  try
    return POSIX path of (choose folder with prompt (item 1 of argv))
  on error number -128
    return ""
  end try
end run`, PROMPT], { timeout: 300_000, maxBuffer: 8192 });
  const raw = stdout.trim();
  const path = raw.length > 1 ? raw.replace(/\/+$/, "") : raw;
  if (!path) return undefined;
  if (!isAbsolute(path)) throw new Error("The folder picker returned an unusable path.");
  if (!(await stat(path).then(entry => entry.isDirectory(), () => false))) throw new Error("The chosen folder is unavailable.");
  return path;
}
