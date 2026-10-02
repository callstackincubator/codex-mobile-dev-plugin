import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { foregroundPhysicalPid, parseAndroidForegroundPackage } from "../src/server/device-apps/foreground.ts";
import { readDeviceApps } from "../src/server/device-apps/sources.ts";
import type { DeviceApp } from "../src/shared/device-apps.ts";

const udid = "00008150-001068280AE8C01C";

test("physical foreground selection matches only an eligible app's main process and never reuses the previous result", async () => {
  const apps: DeviceApp[] = [{ bundleId: "app.a", pid: 123 }, { bundleId: "app.b", pid: 456 }];
  const abort = new AbortController();
  let pid: number | null = 456;
  const sources = {
    async apps(deviceId: string, signal?: AbortSignal, platform?: string, kind?: string) {
      assert.equal(deviceId, udid);
      assert.equal(signal, abort.signal);
      assert.equal(platform, "ios");
      assert.equal(kind, "physical");
      return apps;
    },
    async physical(deviceId: string, signal?: AbortSignal) {
      assert.equal(deviceId, udid);
      assert.equal(signal, abort.signal);
      return pid;
    },
    async simulator() { return null; },
    async android() { return null; },
  };
  const initial = await readDeviceApps(udid, abort.signal, "ios", "physical", sources);
  assert.deepEqual(initial.apps, [{ ...apps[0], foreground: false }, { ...apps[1], foreground: true }]);
  for (const current of [39, 999, null]) {
    pid = current;
    const unmatched = await readDeviceApps(udid, abort.signal, "ios", "physical", sources);
    const foreground = unmatched.apps.filter(app => app.foreground === true);
    assert.deepEqual(foreground, [], "System UI, extensions and a missing root cannot select an app.");
  }
  assert.deepEqual(apps, [{ bundleId: "app.a", pid: 123 }, { bundleId: "app.b", pid: 456 }]);
  assert.equal(initial.apps[1].foreground, true, "Later discoveries do not mutate earlier responses.");
});

test("shared app discovery queries the selected platform and preserves identities outside the monitoring list", async () => {
  const detections: string[] = [];
  const sources = {
    async apps() { return [{ bundleId: "app.a", pid: 123 }]; },
    async physical() { detections.push("physical"); return 999; },
    async simulator() { detections.push("simulator"); return 123; },
    async android() { detections.push("android"); return "com.android.launcher"; },
  };
  const simulator = await readDeviceApps("simulator", undefined, "ios", "simulator", sources);
  assert.deepEqual(simulator.foregroundApp, { bundleId: "app.a", pid: 123 });
  assert.equal(simulator.apps[0].foreground, true);
  const android = await readDeviceApps("emulator-5554", undefined, "android", undefined, sources);
  assert.deepEqual(android.foregroundApp, { bundleId: "com.android.launcher", pid: null });
  assert.equal(android.apps[0].foreground, false);
  const physical = await readDeviceApps(udid, undefined, "ios", "physical", sources);
  assert.deepEqual(physical.foregroundApp, { bundleId: null, pid: 999 });
  assert.equal(physical.apps[0].foreground, false);
  assert.deepEqual(detections, ["simulator", "android", "physical"]);
  sources.physical = async () => { throw new Error("iPhone accessibility connection closed"); };
  const failed = readDeviceApps(udid, undefined, "ios", "physical", sources);
  await assert.rejects(failed, /accessibility connection closed/);
});

test("foreground helper accepts a PID or no screen, rejects malformed output and propagates errors", async t => {
  const temporary = tmpdir();
  const prefix = join(temporary, "mobile-dev-foreground-test-");
  const root = await mkdtemp(prefix);
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "helper.cjs");
  const url = pathToFileURL(path);
  const write = async (body: string) => {
    const script = `#!${process.execPath}\nif (process.argv[2] !== 'foreground' || process.argv[3] !== '${udid}') process.exit(2);\n${body}`;
    await writeFile(path, script, { mode: 0o700 });
  };
  await write("process.stdout.write('{\"pid\":23931}\\n');");
  const nitro = await foregroundPhysicalPid(udid, undefined, url);
  assert.equal(nitro, 23931);
  await write("process.stdout.write('{\"pid\":null}\\n');");
  const absent = await foregroundPhysicalPid(udid, undefined, url);
  assert.equal(absent, null);
  for (const output of ['{"pid":0}', '{"pid":"23931"}', '{}', '{"pid":2147483648}']) {
    const literal = JSON.stringify(output);
    await write(`process.stdout.write(${literal});`);
    const malformed = foregroundPhysicalPid(udid, undefined, url);
    await assert.rejects(malformed);
  }
  await write("process.stderr.write('The iPhone disconnected'); process.exit(1);");
  const failure = foregroundPhysicalPid(udid, undefined, url);
  await assert.rejects(failure, /iPhone disconnected/);
  await write("setInterval(() => {}, 1000);");
  const abort = new AbortController();
  const pending = foregroundPhysicalPid(udid, abort.signal, url);
  abort.abort();
  await assert.rejects(pending, /abort/i);
});

test("Android foreground parsing uses the top resumed activity rather than background activities", () => {
  const current = parseAndroidForegroundPackage(`
    mResumedActivity: ActivityRecord{a u0 app.background/.MainActivity t1}
    topResumedActivity=ActivityRecord{b u0 app.foreground/.MainActivity t2}
  `);
  assert.equal(current, "app.foreground");
  const older = parseAndroidForegroundPackage("  mResumedActivity: ActivityRecord{a u0 app.current/app.current.MainActivity t1}");
  assert.equal(older, "app.current");
  const absent = parseAndroidForegroundPackage("  topResumedActivity=null\n  mResumedActivity: ActivityRecord{a u0 app.background/.MainActivity t1}");
  assert.equal(absent, null);
  assert.throws(() => parseAndroidForegroundPackage("Permission Denial"), /did not report/);
  assert.throws(() => parseAndroidForegroundPackage("topResumedActivity=broken"), /unsupported/);
  assert.throws(() => parseAndroidForegroundPackage("topResumedActivity=ActivityRecord{a u0 app.one/.Main t1}\ntopResumedActivity=ActivityRecord{b u0 app.two/.Main t2}"), /multiple foreground apps/);
});
