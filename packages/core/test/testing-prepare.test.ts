import test from "node:test";
import assert from "node:assert/strict";
import { createLaneExecutor, parsePmPaths, systemDeviceOps } from "../src/testing-prepare.ts";
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
