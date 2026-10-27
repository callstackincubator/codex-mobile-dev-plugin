import type { TestContext } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  await writeFile(join(tools, "adb"), `#!${process.execPath}
const args = process.argv.slice(2);
if (args[0] !== "-s" || args[1] !== "emulator-5554" || args[2] !== "shell") process.exit(1);
if (args[3] === "wm" && args[4] === "size") console.log("Physical size: 1080x2400");
else if (args[3] === "getprop") {
  const properties = { "ro.product.model": "sdk_gphone64_arm64", "ro.build.version.release": "16", "ro.build.version.sdk": "36" };
  console.log(properties[args[4]] || "");
} else process.exit(1);
`, { mode: 0o755 });
}
