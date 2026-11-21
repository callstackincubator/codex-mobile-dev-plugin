import type { TestContext } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

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
  // Both JS and C# accept this switch body. The Windows fixture must be a real executable
  // because production spawns adb.exe directly, without a shell or a script interpreter.
  const cases = Object.entries(replies).map(([command, reply]) =>
    `case "-s emulator-5554 shell ${command}": return "${reply}";`).join("\n");
  if (process.platform === "win32") {
    const source = join(tools, "Adb.cs");
    await writeFile(source, `class Adb {
      static string Reply(string command) { switch (command) { ${cases} default: return null; } }
      static int Main(string[] args) {
        string reply = Reply(string.Join(" ", args));
        if (reply == null) return 1;
        System.Console.WriteLine(reply); return 0;
      }
    }`);
    const compiler = join(process.env.SystemRoot!, "Microsoft.NET/Framework/v4.0.30319/csc.exe");
    execFileSync(compiler, ["/nologo", `/out:${join(tools, "adb.exe")}`, source]);
  } else {
    await writeFile(join(tools, "adb"), `#!${process.execPath}
function reply(command) { switch (command) { ${cases} default: process.exit(1); } }
console.log(reply(process.argv.slice(2).join(" ")));
`, { mode: 0o755 });
  }
}
