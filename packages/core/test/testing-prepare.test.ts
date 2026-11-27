import test from "node:test";
import assert from "node:assert/strict";
import { abiCompatible, androidInstallError, androidScreenBlock, apkAbis, createLaneExecutor, parsePmPaths, splitNameAbis, physicalIosError, systemDeviceOps } from "../src/testing-prepare.ts";
import type { DeviceOps } from "../src/testing-prepare.ts";
import { MatrixRegistry, startMatrix } from "../src/testing-matrix.ts";
import type { LaneState, MatrixDevice } from "../src/testing-matrix.ts";

/** A fake machine: which devices are booted and which have the app, with a log of what was done to them. */
function machine(state: Record<string, { booted: boolean; apps: string[] }>) {
  const log: string[] = [];
  const ops: DeviceOps = {
    async isBooted(_p, id) { if (!state[id]) throw new Error("gone"); return state[id]!.booted; },
    async boot(_p, id) { log.push(`boot ${id}`); state[id]!.booted = true; return id.startsWith("avd:") ? `emulator-${id.slice(4)}` : id; },
    async hasApp(_p, id, app) { return state[id]?.booted === true && state[id]!.apps.includes(app); },
    async copyApp(_p, from, to, app) { log.push(`copy ${from}->${to}`); state[to]!.apps.push(app); },
    async launch(_p, id) { log.push(`launch ${id}`); },
  };
  return { ops, log, state };
}

async function run(devices: MatrixDevice[], ops: DeviceOps, apps = { ios: "com.app", android: "com.app" }) {
  const seen = new Map<string, LaneState[]>();
  const executor = createLaneExecutor({ ops, apps, runTest: async (lane, deviceId) => { log.push(`run ${deviceId}`); return { status: "passed", exitCode: 0, steps: [] }; } });
  const log: string[] = [];
  const registry = new MatrixRegistry();
  const { run: matrix, done } = startMatrix(registry, { testPath: "t", devices }, executor);
  await done;
  void seen;
  return { matrix, log };
}

const ios = (...ids: string[]): MatrixDevice[] => ids.map(deviceId => ({ deviceId, platform: "ios" }));

test("an off simulator is booted before its lane runs", async () => {
  const { ops, log: ops_log } = machine({ A: { booted: false, apps: ["com.app"] } });
  const { matrix, log } = await run(ios("A"), ops);
  assert.equal(matrix.lanes[0]!.state, "passed");
  assert.deepEqual(ops_log, ["boot A", "launch A"]);
  assert.deepEqual(log, ["run A"]);
});

test("a device without the app gets it copied from another device that has it", async () => {
  const { ops, log: ops_log } = machine({ A: { booted: true, apps: ["com.app"] }, B: { booted: true, apps: [] } });
  const { matrix } = await run(ios("A", "B"), ops);
  assert.deepEqual(matrix.lanes.map(lane => lane.state), ["passed", "passed"]);
  assert.ok(ops_log.includes("copy A->B"));
  assert.ok(ops_log.indexOf("copy A->B") < ops_log.indexOf("launch B"), "installed before launch");
});

test("a lone device without the app gets it copied from a booted device outside the run", async () => {
  const { ops, log } = machine({ PRO: { booted: true, apps: ["com.app"] }, AIR: { booted: true, apps: [] }, OFF: { booted: false, apps: ["com.app"] } });
  ops.bootedDevices = async () => [{ deviceId: "AIR", name: "iPhone Air" }, { deviceId: "OFF", name: "Off" }, { deviceId: "PRO", name: "iPhone 17 Pro" }];
  const { matrix } = await run(ios("AIR"), ops);
  assert.equal(matrix.lanes[0]!.state, "passed");
  assert.ok(log.includes("copy PRO->AIR"), "the device the app was built on is the source though it was not ticked");
  assert.equal(log.some(line => line.startsWith("boot")), false, "an unticked device is never booted to be a source");
});

test("a device that is off and lacks the app is booted, then installed", async () => {
  const { ops, log } = machine({ A: { booted: true, apps: ["com.app"] }, B: { booted: false, apps: [] } });
  await run(ios("A", "B"), ops);
  assert.ok(log.indexOf("boot B") < log.indexOf("copy A->B"));
});

test("an Android AVD runs on the serial it booted as", async () => {
  const { ops } = machine({ "avd:Pixel": { booted: false, apps: [] }, "emulator-5554": { booted: true, apps: ["com.app"] }, "emulator-Pixel": { booted: true, apps: [] } });
  const { matrix } = await run([{ deviceId: "emulator-5554", platform: "android" }, { deviceId: "avd:Pixel", platform: "android" }], ops);
  assert.equal(matrix.lanes[1]!.resolvedDeviceId, "emulator-Pixel");
  assert.equal(matrix.lanes[1]!.state, "passed");
});

test("with no device that has the app the lane fails with App not installed", async () => {
  const { ops } = machine({ A: { booted: true, apps: [] }, B: { booted: true, apps: [] } });
  const { matrix } = await run(ios("A", "B"), ops);
  assert.deepEqual(matrix.lanes.map(lane => lane.state), ["error", "error"]);
  assert.match(matrix.lanes[0]!.error ?? "", /App not installed/);
});

test("a connected physical iPhone runs without booting or copying a simulator app", async () => {
  const { ops, log } = machine({ phone: { booted: false, apps: [] } });
  ops.physicalIos = {
    ready: async id => { log.push(`ready ${id}`); },
    hasApp: async () => true,
    launch: async id => { log.push(`physical launch ${id}`); },
  };
  const { matrix } = await run([{ deviceId: "phone", platform: "ios", kind: "physical" }], ops);
  assert.equal(matrix.lanes[0]?.state, "passed");
  assert.deepEqual(log, ["ready phone", "physical launch phone"]);
});

test("a physical iPhone without the app fails with hardware install guidance", async () => {
  const { ops, log } = machine({ phone: { booted: false, apps: [] }, sim: { booted: true, apps: ["com.app"] } });
  ops.physicalIos = { ready: async () => undefined, hasApp: async () => false, launch: async () => undefined };
  const { matrix } = await run([{ deviceId: "phone", platform: "ios", kind: "physical" }, { deviceId: "sim", platform: "ios" }], ops);
  assert.match(matrix.lanes[0]?.error ?? "", /no device build of it was found.*expo run:ios --device/);
  assert.equal(log.some(entry => entry.includes("phone")), false, "simulator copy and boot commands never receive the phone UDID");
});

test("a platform with no app id fails fast, and a source on another platform is never used", async () => {
  const { ops, log } = machine({ A: { booted: true, apps: ["com.app"] }, "emulator-1": { booted: true, apps: [] } });
  const { matrix } = await run([{ deviceId: "A", platform: "ios" }, { deviceId: "emulator-1", platform: "android" }], ops, { ios: "com.app" } as never);
  assert.equal(matrix.lanes[0]!.state, "passed");
  assert.equal(matrix.lanes[1]!.state, "error");
  assert.match(matrix.lanes[1]!.error ?? "", /No Android package/);
  assert.ok(!log.some(entry => entry.startsWith("copy")));
});

test("a lane reports booting and installing as it goes", async () => {
  const { ops } = machine({ A: { booted: true, apps: ["com.app"] }, B: { booted: false, apps: [] } });
  const states: string[] = [];
  const executor = createLaneExecutor({ ops, apps: { ios: "com.app" }, runTest: async () => ({ status: "passed", exitCode: 0, steps: [] }) });
  const { run: matrix } = startMatrix(new MatrixRegistry(), { testPath: "t", devices: [] }, executor);
  const lanes = ios("A", "B").map((device, i) => ({ runId: String(i), deviceId: device.deviceId, deviceName: device.deviceId, platform: "ios" as const, state: "queued" as LaneState, progress: [] }));
  void matrix;
  await executor.prepare(lanes[1]!, lanes, new AbortController().signal, state => states.push(state));
  assert.deepEqual(states, ["booting", "installing"]);
});

test("pm path output becomes the list of APKs, split ones included", () => {
  assert.deepEqual(parsePmPaths("package:/data/app/~~x/com.app-1/base.apk\npackage:/data/app/~~x/com.app-1/split_config.arm64_v8a.apk\n"),
    ["/data/app/~~x/com.app-1/base.apk", "/data/app/~~x/com.app-1/split_config.arm64_v8a.apk"]);
  assert.deepEqual(parsePmPaths("package:/data/app/$(reboot).apk\nnoise"), [], "an unexpected path is refused");
});

test("system ops copy a split APK with install-multiple and an iOS app with get_app_container", async () => {
  const calls: string[][] = [];
  const commands = {
    adb: async () => "adb", aapt2: async () => null,
    run: async (file: string, args: string[]) => {
      calls.push([file, ...args]);
      if (args.includes("pm")) return "package:/data/app/a/base.apk\npackage:/data/app/a/split_x.apk\n";
      if (args.includes("get_app_container")) return "/sim/App.app\n";
      return "";
    },
    readBinary: async () => Buffer.alloc(0),
  };
  const ops = systemDeviceOps({ simulators: {} as never, android: {} as never, drivers: (() => ({})) as never, commands });
  const controller = new AbortController();
  await ops.copyApp("android", "emulator-5554", "emulator-5556", "com.app", controller.signal);
  const install = calls.find(call => call.includes("install-multiple"));
  assert.ok(install, "split APKs install together");
  assert.deepEqual(install!.slice(0, 4), ["adb", "-s", "emulator-5556", "install-multiple"]);
  assert.equal(calls.filter(call => call.includes("pull")).length, 2);
  calls.length = 0;
  await ops.copyApp("ios", "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "com.app", controller.signal);
  assert.deepEqual(calls.at(-1), ["xcrun", "simctl", "install", "22222222-2222-4222-8222-222222222222", "/sim/App.app"]);
});

test("physical app lookup and launch use devicectl, never simctl", async () => {
  const calls: string[][] = [];
  const commands = {
    adb: async () => "adb", aapt2: async () => null, readBinary: async () => Buffer.alloc(0),
    run: async (file: string, args: string[]) => {
      calls.push([file, ...args]);
      return args.includes("apps") ? JSON.stringify({ result: { apps: [{ bundleIdentifier: "com.app" }] } }) : "";
    },
  };
  const ops = systemDeviceOps({ simulators: {} as never, android: {} as never, drivers: (() => ({})) as never, commands });
  assert.equal(await ops.physicalIos!.hasApp("phone", "com.app"), true);
  await ops.physicalIos!.launch("phone", "com.app");
  assert.equal(calls.length, 2);
  assert.ok(calls.every(args => args[0] === "/usr/bin/xcrun" && args[1] === "devicectl" && args.includes("phone")));
});

test("a hardware UDID without physical kind is refused before simulator operations", async () => {
  let simulatorCalls = 0;
  const ops = systemDeviceOps({ simulators: { device: async () => { simulatorCalls++; return { state: "Booted" }; } } as never, android: {} as never, drivers: (() => ({})) as never });
  await assert.rejects(ops.isBooted("ios", "00008150-0000111122223333"), /kind physical/);
  assert.equal(simulatorCalls, 0);
});

test("the system ops list only the booted devices of a platform and read the foreground app through the given reader", async () => {
  const status = (devices: unknown[]) => ({ list: async () => ({ connected: true, managed: false, baseUrl: "", devices }) }) as never;
  const asked: [string, string][] = [];
  const ops = systemDeviceOps({
    simulators: status([{ udid: "A", name: "iPhone", state: "Booted", runtime: "iOS" }, { udid: "B", name: "Off", state: "Shutdown", runtime: "iOS" }]),
    android: status([{ udid: "emulator-5554", name: "Pixel", state: "Booted", runtime: "", platform: "android", kind: "emulator" }, { udid: "avd:x", name: "Cold", state: "Shutdown", runtime: "", platform: "android", kind: "emulator" }]),
    drivers: (() => ({})) as never,
    foreground: async (platform, deviceId) => { asked.push([platform, deviceId]); return "com.example"; },
  });
  assert.deepEqual(await ops.bootedDevices!("ios"), [{ deviceId: "A", name: "iPhone" }]);
  assert.deepEqual(await ops.bootedDevices!("android"), [{ deviceId: "emulator-5554", name: "Pixel" }]);
  assert.equal(await ops.foregroundApp!("android", "emulator-5554"), "com.example");
  assert.deepEqual(asked, [["android", "emulator-5554"]]);
});

test("a physical iPhone without the app gets a device build installed, never a simulator copy", async () => {
  const { ops, log } = machine({ phone: { booted: false, apps: [] }, sim: { booted: true, apps: ["com.app"] } });
  const installs: string[] = [];
  ops.physicalIos = { ready: async () => undefined, hasApp: async () => installs.length > 0, launch: async () => { log.push("launch phone"); }, install: async (id, app) => { installs.push(`${id} ${app}`); return "installed"; } };
  const states: string[] = [];
  const executor = createLaneExecutor({ ops, apps: { ios: "com.app" }, runTest: async () => ({ status: "passed", exitCode: 0, steps: [] }) });
  const { run: matrix, done } = startMatrix(new MatrixRegistry(), { testPath: "t", devices: [{ deviceId: "phone", platform: "ios", kind: "physical" }, { deviceId: "sim", platform: "ios" }] }, {
    ...executor, prepare: (lane, lanes, signal, setState) => executor.prepare(lane, lanes, signal, state => { states.push(`${lane.deviceId}:${state}`); setState(state); }),
  });
  await done;
  assert.equal(matrix.lanes[0]!.state, "passed");
  assert.deepEqual(installs, ["phone com.app"]);
  assert.ok(states.includes("phone:installing"));
  assert.equal(log.some(entry => entry.startsWith("copy")), false);
});

test("a simulator lane never takes a physical lane as the app source", async () => {
  const { ops, log } = machine({ phone: { booted: true, apps: ["com.app"] }, sim: { booted: true, apps: [] } });
  ops.physicalIos = { ready: async () => undefined, hasApp: async () => true, launch: async () => undefined };
  const { matrix } = await run([{ deviceId: "phone", platform: "ios", kind: "physical" }, { deviceId: "sim", platform: "ios" }], ops);
  assert.equal(matrix.lanes[1]!.state, "error");
  assert.equal(log.some(entry => entry.startsWith("copy")), false);
});

test("devicectl failures become instructions", () => {
  const failure = (stderr: string) => physicalIosError(Object.assign(new Error("Command failed"), { stderr }), "Installing the app", "com.app").message;
  assert.match(failure("The device is locked."), /locked\. Unlock it/);
  assert.match(failure("Developer Mode is disabled"), /Developer Mode is off/);
  assert.match(failure("ApplicationVerificationFailed: its profile has not been explicitly trusted by the user"), /VPN & Device Management/);
  assert.match(failure("error: no provisioning profile includes the device (0xe8008015)"), /not provisioned for the device.*expo run:ios --device/);
  assert.match(failure("The app could not be found: not installed"), /com\.app is not installed/);
  assert.doesNotMatch(failure("The device is unlocked and fine but something else broke"), /Unlock it/);
});

/** adb/unzip fake for a physical Android phone: `devices` lists it in `state`, other answers come from `answers`. */
function phoneOps(state: string, answers: Record<string, string>, calls: string[][] = []) {
  const commands = {
    adb: async () => "adb", aapt2: async () => null, readBinary: async () => Buffer.alloc(0),
    run: async (file: string, args: string[]) => {
      calls.push([file, ...args]);
      if (args[0] === "devices") return `List of devices attached\nR5CT1\t${state}\n`;
      const key = args[0] === "-Z1" ? "-Z1" : args.slice(2).join(" ");
      const hit = Object.entries(answers).find(([prefix]) => key.startsWith(prefix));
      if (!hit) return "";
      if (hit[1].startsWith("throw:")) throw Object.assign(new Error("failed"), { stderr: hit[1].slice(6) });
      return hit[1];
    },
  };
  return systemDeviceOps({ simulators: {} as never, android: {} as never, drivers: (() => ({})) as never, commands }).physicalAndroid!;
}

test("physical Android ready maps adb states to what to fix", async () => {
  await assert.rejects(phoneOps("unauthorized", {}).ready("R5CT1"), /USB debugging prompt/);
  await assert.rejects(phoneOps("offline", {}).ready("R5CT1"), /offline/);
  await assert.rejects(phoneOps("device", {}).ready("OTHER"), /no longer connected/);
  await assert.rejects(phoneOps("device", {}).ready("192.168.1.5:5555"), /address changes/);
});

test("physical Android ready refuses a sleeping or locked screen and accepts an unlocked one", async () => {
  await assert.rejects(phoneOps("device", { "shell dumpsys power": "mWakefulness=Asleep" }).ready("R5CT1"), /asleep/);
  await assert.rejects(phoneOps("device", { "shell dumpsys power": "mWakefulness=Awake", "shell dumpsys window": "mShowingLockscreen=true" }).ready("R5CT1"), /locked/);
  await phoneOps("device", { "shell dumpsys power": "mWakefulness=Awake", "shell dumpsys window": "mShowingLockscreen=false" }).ready("R5CT1");
  assert.equal(androidScreenBlock("mWakefulness=Awake", "isStatusBarKeyguard=false"), null);
});

test("physical Android hasApp asks for the current user and launch uses monkey", async () => {
  const calls: string[][] = [];
  const ops = phoneOps("device", { "shell am get-current-user": "10\n", "shell pm path": "package:/data/app/x/base.apk\n" }, calls);
  assert.equal(await ops.hasApp("R5CT1", "com.app"), true);
  assert.ok(calls.at(-1)!.join(" ").includes("pm path --user 10 com.app"));
  await ops.launch("R5CT1", "com.app");
  assert.ok(calls.at(-1)!.join(" ").includes("monkey -p com.app -c android.intent.category.LAUNCHER 1"));
});

test("ABI checks compare the phone's ABIs with the APK's native libraries", () => {
  assert.deepEqual(apkAbis(["classes.dex", "lib/arm64-v8a/liba.so", "lib/x86_64/liba.so"]), ["arm64-v8a", "x86_64"]);
  assert.deepEqual(splitNameAbis(["0-base.apk", "1-split_config.arm64_v8a.apk"]), ["arm64-v8a"]);
  assert.equal(abiCompatible(["arm64-v8a", "armeabi-v7a"], ["x86_64"]), false);
  assert.equal(abiCompatible(["arm64-v8a"], ["x86_64", "arm64-v8a"]), true);
  assert.equal(abiCompatible(["arm64-v8a"], []), true, "pure Java runs anywhere");
});

test("physical Android install copies from a source only when the ABIs match", async () => {
  const calls: string[][] = [];
  const base = { "shell getprop ro.product.cpu.abilist": "arm64-v8a,armeabi-v7a", "shell pm path": "package:/data/app/x/base.apk\n" };
  const ok = phoneOps("device", { ...base, "-Z1": "lib/arm64-v8a/a.so\nclasses.dex" }, calls);
  assert.equal(await ok.installFrom!("R5CT1", "com.app", ["emulator-5554"]), "installed");
  assert.ok(calls.some(call => call.includes("install") && call.includes("R5CT1")));
  const mismatch = phoneOps("device", { ...base, "-Z1": "lib/x86_64/a.so" });
  await assert.rejects(mismatch.installFrom!("R5CT1", "com.app", ["emulator-5554"]), /no native code for this phone/);
  assert.equal(await phoneOps("device", base).installFrom!("R5CT1", "com.app", []), "no_source");
});

test("adb install failures say what to fix, including vendor USB-install blocks", () => {
  const fail = (stderr: string) => androidInstallError(Object.assign(new Error("x"), { stderr }), "Installing the app", "com.app").message;
  assert.match(fail("INSTALL_FAILED_NO_MATCHING_ABIS"), /expo run:android --device/);
  assert.match(fail("INSTALL_FAILED_UPDATE_INCOMPATIBLE"), /Uninstall/);
  assert.match(fail("INSTALL_FAILED_USER_RESTRICTED: Install canceled by user"), /Install via USB/);
});

test("a physical Android lane copies the app from a phone before an emulator and launches it", async () => {
  const log: string[] = [];
  const ops: DeviceOps = {
    ...machine({ "emulator-5554": { booted: true, apps: ["com.app"] } }).ops,
    physicalAndroid: {
      ready: async id => { log.push(`ready ${id}`); },
      hasApp: async id => id === "phoneB" || log.includes("installed"),
      launch: async id => { log.push(`launch ${id}`); },
      installFrom: async (id, _app, sources) => { log.push(`from ${sources.join(",")}`); log.push("installed"); return "installed"; },
    },
  };
  const { matrix } = await run([{ deviceId: "phoneA", platform: "android", kind: "physical" }, { deviceId: "phoneB", platform: "android", kind: "physical" }, { deviceId: "emulator-5554", platform: "android" }], ops);
  assert.equal(matrix.lanes[0]!.state, "passed");
  assert.ok(log.includes("from phoneB,emulator-5554"));
  assert.ok(log.indexOf("installed") < log.indexOf("launch phoneA"));
});

test("a physical Android lane with no source says to build for the phone", async () => {
  const ops: DeviceOps = { ...machine({}).ops, physicalAndroid: { ready: async () => undefined, hasApp: async () => false, launch: async () => undefined, installFrom: async () => "no_source" } };
  const { matrix } = await run([{ deviceId: "phone", platform: "android", kind: "physical" }], ops);
  assert.match(matrix.lanes[0]!.error ?? "", /expo run:android --device/);
});
