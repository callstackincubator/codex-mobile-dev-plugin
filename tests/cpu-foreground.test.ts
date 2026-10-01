import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { foregroundPhysicalPid } from "../src/server/cpu/foreground.ts";
import { runningPerformanceApps } from "../src/server/cpu/sources.ts";
import type { CpuApp } from "../src/shared/cpu.ts";

const udid = "00008150-001068280AE8C01C";

test("physical foreground selection matches only an eligible app's main process and never reuses the previous result", async () => {
  const apps: CpuApp[] = [{ bundleId: "app.a", pid: 123 }, { bundleId: "app.b", pid: 456 }];
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
    async foreground(deviceId: string, signal?: AbortSignal) {
      assert.equal(deviceId, udid);
      assert.equal(signal, abort.signal);
      return pid;
    },
  };
  const initial = await runningPerformanceApps(udid, abort.signal, "ios", "physical", sources);
  assert.deepEqual(initial, [{ ...apps[0], foreground: false }, { ...apps[1], foreground: true }]);
  for (const current of [39, 999, null]) {
    pid = current;
    const unmatched = await runningPerformanceApps(udid, abort.signal, "ios", "physical", sources);
    const foreground = unmatched.filter(app => app.foreground === true);
    assert.deepEqual(foreground, [], "System UI, extensions and a missing root cannot select an app.");
  }
  assert.deepEqual(apps, [{ bundleId: "app.a", pid: 123 }, { bundleId: "app.b", pid: 456 }]);
  assert.equal(initial[1].foreground, true, "Later discoveries do not mutate earlier responses.");
});

test("foreground detection is physical iOS only and reports device failures", async () => {
  let detections = 0;
  const sources = {
    async apps() { return [{ bundleId: "app.a", pid: 123 }]; },
    async foreground(): Promise<number | null> {
      detections++;
      throw new Error("iPhone accessibility connection closed");
    },
  };
  await runningPerformanceApps("simulator", undefined, "ios", "simulator", sources);
  await runningPerformanceApps("emulator-5554", undefined, "android", undefined, sources);
  assert.equal(detections, 0);
  const physical = runningPerformanceApps(udid, undefined, "ios", "physical", sources);
  await assert.rejects(physical, /accessibility connection closed/);
  assert.equal(detections, 1);
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
