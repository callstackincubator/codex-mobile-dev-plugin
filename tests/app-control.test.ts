import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseIosUrlSchemes, parseSimulatorApps } from "../src/server/app-control/simulator.ts";
import { androidPermissionStates, parseAndroidAppLinks, parseAndroidBadging, parseAndroidRuntimePermissions, parseLauncherActivity, pickAndroidIconFile } from "../src/server/app-control/android.ts";
import { listApps } from "../src/server/app-control/driver.ts";
import type { AppDriver } from "../src/server/app-control/driver.ts";
import { createDrivers } from "../src/server/app-control/tools.ts";
import type { CommandRunner } from "../src/server/app-control/commands.ts";
import { expectedOutcome } from "../src/shared/error-reporting.ts";

const ios = { platform: "ios", deviceId: "B5C969F6-58A4-4C31-AB12-FB9E56D681DE" } as const;
const android = { platform: "android", deviceId: "emulator-5554" } as const;
const dumpsys = `Packages:
    requested permissions:
      android.permission.CAMERA
    install permissions:
      android.permission.INTERNET: granted=true
    User 0: ceDataInode=1
      runtime permissions:
        android.permission.CAMERA: granted=false, flags=[ USER_SET|USER_FIXED|USER_SENSITIVE_WHEN_GRANTED]
        android.permission.ACCESS_FINE_LOCATION: granted=true, flags=[ USER_SET]
        android.permission.ACCESS_COARSE_LOCATION: granted=false, flags=[ ]
        android.permission.RECORD_AUDIO: granted=false, flags=[ USER_SENSITIVE_WHEN_GRANTED]
      enabledComponents:
    User 10: ceDataInode=2
      runtime permissions:
        android.permission.CAMERA: granted=true, flags=[ ]
`;

function failure(stderr: string, code = 1) { return Object.assign(new Error(`Command failed: ${stderr}`), { code, stderr, stdout: "" }); }
function fixture(respond: (file: string, args: string[], input?: string) => string | Error = () => "") {
  const calls: { file: string; args: string[]; input?: string }[] = [];
  const run: CommandRunner = async (file, args, options) => {
    calls.push({ file, args, ...(options.input === undefined ? {} : { input: options.input }) });
    const result = respond(file, args, options.input);
    if (result instanceof Error) throw result;
    return result;
  };
  const drivers = createDrivers({ run, readBinary: async () => Buffer.alloc(0), adb: async () => "adb", aapt2: async () => null });
  return { simulator: drivers(ios), emulator: drivers(android), calls };
}

test("simulator listings keep user apps with display names", () => {
  const apps = parseSimulatorApps(JSON.stringify({
    "com.apple.mobilesafari": { ApplicationType: "System", CFBundleIdentifier: "com.apple.mobilesafari" },
    "com.acme.shop": { ApplicationType: "User", CFBundleIdentifier: "com.acme.shop", CFBundleDisplayName: "Acme Shop", CFBundleName: "Shop" },
    "dev.zeta": { ApplicationType: "User", CFBundleName: "Zeta", Path: "/apps/Zeta.app" },
  }));
  assert.deepEqual(apps, [{ bundleId: "com.acme.shop", name: "Acme Shop", path: "" }, { bundleId: "dev.zeta", name: "Zeta", path: "/apps/Zeta.app" }]);
});

test("app lists lead with the foreground app, then the newest running installed apps", async () => {
  const driver = {
    installed: async () => [{ bundleId: "com.acme", name: "Acme" }, { bundleId: "com.other", name: "Other" }, { bundleId: "dev.idle", name: "Idle" }],
    activity: async () => ({ foreground: "com.acme", running: [{ bundleId: "com.acme", pid: 100 }, { bundleId: "com.apple.system", pid: 400 }, { bundleId: "com.other", pid: 300 }] }),
  } as unknown as AppDriver;
  assert.deepEqual(await listApps(driver), {
    apps: [{ bundleId: "com.acme", name: "Acme" }, { bundleId: "com.other", name: "Other" }, { bundleId: "dev.idle", name: "Idle" }],
    foregroundBundleId: "com.acme", runningBundleIds: ["com.acme", "com.other"],
  });
  const undetected = { ...driver, activity: async () => ({ ...await driver.activity(), foreground: null }) } as AppDriver;
  assert.deepEqual((await listApps(undetected)).runningBundleIds, ["com.other", "com.acme"], "without a foreground app the newest running app leads");
});

test("Android launcher and permission output parse into stable values", () => {
  assert.equal(parseLauncherActivity("priority=0 match=0x108000\ncom.acme/.MainActivity\n", "com.acme"), "com.acme/.MainActivity");
  assert.equal(parseLauncherActivity("No activity found\n", "com.acme"), null);
  assert.equal(parseLauncherActivity("com.other/.Main\n", "com.acme"), null);
  const runtime = parseAndroidRuntimePermissions(dumpsys);
  assert.equal(runtime.size, 4, "only the first user's runtime block is read");
  assert.deepEqual(androidPermissionStates(runtime), [
    { permission: "location", state: "allow" }, { permission: "camera", state: "deny" }, { permission: "microphone", state: "ask" },
  ]);
  assert.throws(() => parseAndroidRuntimePermissions("Unable to find package: com.nope\n"), (error: unknown) => expectedOutcome(error) === "invalid_input");
});

test("iOS simulator actions use simctl", async () => {
  const { simulator, calls } = fixture((file, args) => {
    if (args[1] === "listapps") return "{ }";
    if (file === "plutil") return JSON.stringify({ "com.acme.shop": { ApplicationType: "User", CFBundleIdentifier: "com.acme.shop", CFBundleName: "Shop" } });
    if (args[1] === "terminate") return failure("Simulator device failed to terminate com.acme.shop.\nfound nothing to terminate", 3);
    return "";
  });
  assert.deepEqual(await simulator.installed(), [{ bundleId: "com.acme.shop", name: "Shop" }]);
  assert.equal(calls[1].input, "{ }", "plutil converts the simctl plist from stdin");
  await simulator.launch("com.acme.shop");
  await simulator.stop("com.acme.shop");
  await simulator.openUrl("myapp://checkout?step=2&x='1'");
  const permissions = await simulator.setPermission("com.acme.shop", "photos", "deny");
  assert.deepEqual(permissions.filter(entry => entry.state !== null), [{ permission: "photos", state: "deny" }], "the full list returns with only the changed permission known");
  assert.equal(permissions.length, 7);
  await simulator.push("com.acme.shop", { aps: { alert: "Hi" } });
  assert.deepEqual(calls.slice(2).map(call => call.args), [
    ["simctl", "launch", "--terminate-running-process", ios.deviceId, "com.acme.shop"],
    ["simctl", "terminate", ios.deviceId, "com.acme.shop"],
    ["simctl", "openurl", ios.deviceId, "myapp://checkout?step=2&x='1'"],
    ["simctl", "privacy", ios.deviceId, "revoke", "photos", "com.acme.shop"],
    ["simctl", "push", ios.deviceId, "com.acme.shop", "-"],
  ]);
  assert.equal(calls.at(-1)?.input, '{"aps":{"alert":"Hi"}}');
});

test("Android actions resolve launchers, quote URLs, and only touch requested permissions", async () => {
  const { emulator, calls } = fixture((_file, args) => {
    const command = args[3] ?? "";
    if (command.startsWith("pm list packages")) return "package:com.acme.android\npackage:com.other\n";
    if (command.startsWith("cmd package resolve-activity")) return "priority=0\ncom.acme.android/.MainActivity$Launcher\n";
    if (command.startsWith("dumpsys package")) return dumpsys;
    return "Status: ok\n";
  });
  assert.deepEqual(await emulator.installed(), [{ bundleId: "com.acme.android", name: "com.acme.android" }, { bundleId: "com.other", name: "com.other" }]);
  await emulator.launch("com.acme.android");
  await emulator.openUrl("myapp://checkout?step=2&x='1'");
  await emulator.setPermission("com.acme.android", "location", "ask");
  await emulator.setPermission("com.acme.android", "camera", "allow");
  const shell = calls.map(call => call.args[3]);
  assert.ok(shell.includes("am force-stop com.acme.android && am start -W -n 'com.acme.android/.MainActivity$Launcher'"), "inner-class launchers survive the device shell");
  assert.ok(shell.includes(`am start -W -a android.intent.action.VIEW -d 'myapp://checkout?step=2&x='\\''1'\\'''`));
  assert.ok(shell.includes([
    "pm revoke com.acme.android android.permission.ACCESS_FINE_LOCATION", "pm clear-permission-flags com.acme.android android.permission.ACCESS_FINE_LOCATION user-set user-fixed",
    "pm revoke com.acme.android android.permission.ACCESS_COARSE_LOCATION", "pm clear-permission-flags com.acme.android android.permission.ACCESS_COARSE_LOCATION user-set user-fixed",
  ].join(" && ")));
  assert.ok(shell.includes("pm clear-permission-flags com.acme.android android.permission.CAMERA user-set user-fixed && pm grant com.acme.android android.permission.CAMERA"));
  await assert.rejects(emulator.setPermission("com.acme.android", "contacts", "allow"), /does not request the contacts permission/);
  await assert.rejects(emulator.push("com.acme.android", { aps: {} }), (error: unknown) => expectedOutcome(error) === "unsupported_platform");
});

test("command failures become readable, expected outcomes where the user can fix them", async () => {
  const { simulator, emulator } = fixture((_file, args) => {
    if (args[1] === "launch") return failure("An error was encountered processing the command (domain=FBSOpenApplicationServiceErrorDomain, code=4):\nSimulator device failed to launch com.nope.", 4);
    if (args[1] === "openurl") return failure("Unable to lookup in current state: Shutdown", 149);
    if (args[1] === "privacy") return failure("Something unexpected", 1);
    if ((args[3] ?? "").includes("am start")) return "Starting: Intent\nError type 3\nError: Activity class {com.acme/.Main} does not exist.\n";
    if ((args[3] ?? "").startsWith("cmd package resolve-activity")) return "com.acme/.Main\n";
    return "";
  });
  await assert.rejects(simulator.launch("com.nope"), (error: unknown) => expectedOutcome(error) === "invalid_input");
  await assert.rejects(simulator.openUrl("myapp://x"), (error: unknown) => expectedOutcome(error) === "device_unavailable");
  await assert.rejects(simulator.setPermission("com.acme", "photos", "allow"), (error: unknown) => {
    assert.equal(expectedOutcome(error), undefined);
    assert.equal((error as Error).message, "Changing the permission failed: Something unexpected");
    return true;
  });
  await assert.rejects(emulator.launch("com.acme"), /Error: Activity class \{com\.acme\/\.Main\} does not exist/);
});

test("tools validate the target, and drivers reject permissions their platform cannot set", async () => {
  const drivers = createDrivers({ run: async () => "", readBinary: async () => Buffer.alloc(0), adb: async () => "adb", aapt2: async () => null });
  assert.throws(() => drivers({ platform: "ios", deviceId: "00008110-001A2B3C4D5E801E" }), (error: unknown) => expectedOutcome(error) === "invalid_input");
  assert.throws(() => drivers({ platform: "android", deviceId: "avd:Pixel_9" }), /running Android device serial/);
  const { simulator, emulator, calls } = fixture(() => "");
  await assert.rejects(simulator.setPermission("com.acme", "camera", "allow"), /iOS simulators do not support the camera permission/);
  await assert.rejects(emulator.setPermission("com.acme", "reminders", "allow"), /Android does not support the reminders permission/);
  assert.equal(calls.length, 0, "unsupported permissions never reach simctl or adb");
});

test("installs require a built bundle of the platform's type", async () => {
  const directory = await mkdtemp(join(tmpdir(), "app-control-"));
  const bundle = join(directory, "Acme.app");
  await mkdir(bundle);
  const { simulator, emulator, calls } = fixture((file, args) => file === "plutil" && args[0] === "-extract" ? "com.acme.shop\n" : "");
  assert.deepEqual(await simulator.install(`${bundle}/`), { bundleId: "com.acme.shop" });
  assert.deepEqual(calls[0].args, ["simctl", "install", ios.deviceId, bundle]);
  await assert.rejects(simulator.install("Acme.app"), (error: unknown) => expectedOutcome(error) === "invalid_input");
  await assert.rejects(emulator.install(bundle), /absolute path of a built \.apk file/);
});

test("app link suggestions keep the app's own schemes and drop SDK redirects", async () => {
  assert.deepEqual(parseIosUrlSchemes(JSON.stringify([
    { CFBundleURLName: "com.acme.shop", CFBundleURLSchemes: ["com.acme.shop", "acme", "fb1696089354000816", "expauth"] },
    { CFBundleURLSchemes: ["com.googleusercontent.apps.603386649315-abc", "exp+acme-shop"] },
  ])), ["acme://", "com.acme.shop://", "exp+acme-shop://"]);
  assert.deepEqual(parseIosUrlSchemes("{}"), []);
  const dumpsys = `Activity Resolver Table:
  Schemes:
      acme:
        f06257 com.acme/.MainActivity filter a9a9144
          Action: "android.intent.action.VIEW"
          Category: "android.intent.category.DEFAULT"
          Category: "android.intent.category.BROWSABLE"
          Scheme: "acme"
      stripe:
        72eccf3 com.acme/com.stripe.android.RedirectActivity filter 8517db0
          Action: "android.intent.action.VIEW"
          Category: "android.intent.category.BROWSABLE"
          Scheme: "acmepay"
      http:
        dc9d03 com.acme/com.acme.LinkActivity filter 6b24ab9
          Action: "android.intent.action.VIEW"
          Category: "android.intent.category.BROWSABLE"
          Scheme: "https"
          Scheme: "http"
          Authority: "acme.dev": -1
          Path: "PatternMatcher{PREFIX: /p}"
      https:
        dc9d03 com.acme/com.acme.LinkActivity filter 6b24ab9
          Action: "android.intent.action.VIEW"
          Scheme: "https"
      launcher:
        11aa22 com.acme/.MainActivity filter 33bb44
          Action: "android.intent.action.MAIN"
          Scheme: "internal"

Receiver Resolver Table:
      acme:
        44cc55 com.acme/.Receiver filter 55dd66
          Action: "android.intent.action.VIEW"
          Category: "android.intent.category.BROWSABLE"
          Scheme: "receiver"
`;
  assert.deepEqual(parseAndroidAppLinks(dumpsys, "com.acme"), ["acme://", "https://acme.dev/p"]);
  const { simulator, calls } = fixture((file, args) => {
    if (args[1] === "get_app_container") return "/tmp/Acme.app\n";
    if (file === "plutil") return JSON.stringify([{ CFBundleURLSchemes: ["acme"] }]);
    return "";
  });
  assert.deepEqual(await simulator.links("com.acme.shop"), ["acme://"]);
  assert.deepEqual(calls.map(call => call.args.at(-1)), ["app", "/tmp/Acme.app/Info.plist"]);
});

test("Android icons resolve adaptive launcher icons to their sharpest raster version", () => {
  assert.deepEqual(parseAndroidBadging("package: name='com.acme'\napplication-label:'Acme Shop'\napplication: label='Acme Shop' icon='res/mipmap-anydpi-v26/ic_launcher.xml'\n"),
    { icon: "res/mipmap-anydpi-v26/ic_launcher.xml", label: "Acme Shop" });
  assert.deepEqual(parseAndroidBadging("package: name='com.acme'\n"), { icon: null, label: null });
  const resources = `Package name=com.acme id=7f
  type mipmap id=10 entryCount=2
    resource 0x7f100000 mipmap/ic_launcher
      (mdpi) (file) res/mipmap-mdpi-v4/ic_launcher.webp type=PNG
      (xxxhdpi) (file) res/mipmap-xxxhdpi-v4/ic_launcher.webp type=PNG
      (xhdpi) (file) res/mipmap-xhdpi-v4/ic_launcher.webp type=PNG
      (anydpi-v26) (file) res/mipmap-anydpi-v26/ic_launcher.xml type=XML
    resource 0x7f100001 mipmap/ic_launcher_round
      (xxxhdpi) (file) res/mipmap-xxxhdpi-v4/ic_launcher_round.webp type=PNG
  type plurals id=11 entryCount=1
`;
  assert.equal(pickAndroidIconFile(resources, "res/mipmap-anydpi-v26/ic_launcher.xml"), "res/mipmap-xxxhdpi-v4/ic_launcher.webp");
  assert.equal(pickAndroidIconFile(resources, "res/legacy.png"), "res/legacy.png", "an unlisted raster icon is used directly");
  assert.equal(pickAndroidIconFile(resources, "res/vector.xml"), null);
});
