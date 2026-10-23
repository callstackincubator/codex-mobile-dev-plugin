import { homedir } from "node:os";
import { join } from "node:path";

// Android SDK locations, in the order the SDK's own tools check them.
export function androidSdkRoots(): string[] {
  return [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, join(homedir(), "Library/Android/sdk")].filter(root => !!root) as string[];
}
