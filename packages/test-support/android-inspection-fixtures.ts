import type { TestContext } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { sdkExecutable } from "../core/src/android-sdk.ts";
import { systemCommands } from "../core/src/app-control/commands.ts";

export async function fakeInspectionSdk(t: TestContext) {
  const sdk = await mkdtemp(join(tmpdir(), "mobile-dev-inspection-sdk-"));
  const previous = process.env.ANDROID_HOME;
  process.env.ANDROID_HOME = sdk;
  t.after(async () => {
    if (previous === undefined) delete process.env.ANDROID_HOME;
    else process.env.ANDROID_HOME = previous;
    await rm(sdk, { recursive: true, force: true });
  });
  const tools = join(sdk, "platform-tools");
  await mkdir(tools);
  const replies: Record<string, string> = {
    "wm size": "Physical size: 1080x2400",
    "getprop sys.boot_completed": "1",
    "getprop ro.product.model": "sdk_gphone64_arm64",
    "getprop ro.build.version.release": "16",
    "getprop ro.build.version.sdk": "36",
  };
  const adb = join(tools, sdkExecutable("adb"));
  await writeFile(adb, "", { mode: 0o755 });
  t.mock.method(systemCommands, "run", async (file: string, args: string[]) => {
    assert.equal(file, adb);
    assert.deepEqual(args.slice(0, 3), ["-s", "emulator-5554", "shell"]);
    const command = args.slice(3).join(" ");
    assert.ok(Object.hasOwn(replies, command), `Unexpected adb shell command: ${command}`);
    return replies[command] + "\n";
  });
}
