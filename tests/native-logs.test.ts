import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startNativeLogs } from "../src/server/native-logs.ts";
import type { LogRecord } from "../src/shared/logs.ts";
import { UDID } from "./fixtures.ts";

test("simulator foreground logs select the PID upstream and retain only that process", { skip: process.platform !== "darwin" }, async t => {
  const directory = await mkdtemp(join(tmpdir(), "mobile-dev-log-pid-"));
  const commands = join(directory, "commands");
  const script = `#!${process.execPath}
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(commands)}, JSON.stringify(process.argv.slice(2)));
for (const processID of [456, 123]) console.log(JSON.stringify({ eventMessage: 'fixture', processID, process: 'Example' }));
setInterval(() => {}, 1000);
`;
  const command = join(directory, "xcrun");
  await writeFile(command, script, { mode: 0o755 });
  const previousPath = process.env.PATH;
  process.env.PATH = `${directory}:${previousPath ?? ""}`;
  const entries: LogRecord[] = [];
  let accepted!: () => void;
  const ready = new Promise<void>(resolve => { accepted = resolve; });
  const stop = startNativeLogs({ platform: "ios", deviceId: UDID, pid: 123 }, {
    log(log) { entries.push(log); accepted(); }, status() {},
  });
  t.after(async () => {
    await stop();
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    await rm(directory, { recursive: true, force: true });
  });
  await ready;
  await stop();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].pid, 123);
  const text = await readFile(commands, "utf8");
  const args = JSON.parse(text);
  assert.deepEqual(args, ["simctl", "spawn", UDID, "log", "stream", "--style", "ndjson", "--level", "debug", "--process", "123"]);
});

test("Android waits for the chosen package and follows its new PID after a restart", async t => {
  const root = await mkdtemp(join(tmpdir(), "mobile-dev-adb-fixture-"));
  const state = join(root, "pid"); const commands = join(root, "commands");
  await mkdir(join(root, "platform-tools")); await writeFile(state, "");
  const script = `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args.includes('pidof')) {
  const pid = fs.readFileSync(${JSON.stringify(state)}, 'utf8');
  if (!pid) process.exit(1);
  process.stdout.write(pid);
} else if (args.includes('logcat')) {
  fs.appendFileSync(${JSON.stringify(commands)}, JSON.stringify(args) + String.fromCharCode(10));
  const pid = args.find(arg => arg.startsWith('--pid=')).slice(6);
  process.stdout.write('09-30 14:00:00.123  ' + pid + '  10 I ReactNativeJS: from ' + pid + String.fromCharCode(10));
  setInterval(() => {}, 1000);
} else process.exit(1);
`;
  await writeFile(join(root, "platform-tools/adb"), script, { mode: 0o755 });
  const previousHome = process.env.ANDROID_HOME; const previousRoot = process.env.ANDROID_SDK_ROOT;
  process.env.ANDROID_HOME = root; process.env.ANDROID_SDK_ROOT = root;
  let stop: (() => Promise<void>) | undefined;
  t.after(async () => {
    await stop?.();
    if (previousHome === undefined) delete process.env.ANDROID_HOME; else process.env.ANDROID_HOME = previousHome;
    if (previousRoot === undefined) delete process.env.ANDROID_SDK_ROOT; else process.env.ANDROID_SDK_ROOT = previousRoot;
    await rm(root, { recursive: true, force: true });
  });
  const entries: LogRecord[] = [];
  let waiting!: () => void; let received!: () => void;
  const notRunning = new Promise<void>(resolve => { waiting = resolve; });
  let arrived = new Promise<void>(resolve => { received = resolve; });
  stop = startNativeLogs({ platform: "android", deviceId: "emulator-5554", packageName: "com.example.app" }, {
    log(log) { entries.push(log); received(); },
    status(status) { if (status.message?.includes("Waiting for")) waiting(); },
  });
  await notRunning;
  await assert.rejects(readFile(commands), /ENOENT/);
  await writeFile(state, "123 999"); await arrived;
  assert.equal(entries[0].pid, 123); assert.equal(entries[0].process, "com.example.app");
  assert.equal(entries[0].deviceId, "emulator-5554");
  arrived = new Promise<void>(resolve => { received = resolve; });
  await writeFile(state, "456"); await arrived;
  assert.equal(entries[1].pid, 456);
  await stop();
  const calls = (await readFile(commands, "utf8")).trim().split("\n").map(line => JSON.parse(line));
  assert.equal(calls.length, 2); assert.ok(calls[0].includes("--pid=123")); assert.ok(calls[1].includes("--pid=456"));
});
