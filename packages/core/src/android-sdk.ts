import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join } from "node:path";

export const missingAdbMessage = "Android SDK Platform-Tools (adb) could not be found. Install Android SDK Platform-Tools in Android Studio’s SDK Manager. For a custom SDK location, set ANDROID_HOME to the SDK folder or add platform-tools to PATH, then restart the host app.";

// Android SDK locations, in the order the SDK's own tools check them.
export function androidSdkRoots(): string[] {
  const defaultRoot = process.platform === "win32"
    ? join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "Android", "Sdk")
    : join(homedir(), process.platform === "darwin" ? "Library/Android/sdk" : "Android/Sdk");
  return [...new Set([process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, defaultRoot].filter((root): root is string => !!root))];
}

export function sdkExecutable(name: string) {
  return process.platform === "win32" ? `${name}.exe` : name;
}

export async function sdkToolPath(name: "adb" | "emulator" | "sqlite3") {
  const executable = sdkExecutable(name);
  for (const root of androidSdkRoots()) {
    const path = join(root, name === "emulator" ? "emulator" : "platform-tools", executable);
    try { await access(path, constants.X_OK); return path; } catch { /* Try the next SDK, then PATH. */ }
  }
  return executable;
}

/** serve-emu and agent-device start SDK tools by name. Preserve PATH when a tool was found there. */
export function androidToolPath(tools: string[], path = process.env.PATH ?? "") {
  const inherited = path ? path.split(delimiter) : [];
  return [...new Set([...tools.filter(isAbsolute).map(tool => dirname(tool)), ...inherited])].join(delimiter);
}
