import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { AndroidCrashCollector, crashWatchFor, iosCrashLogPredicate, parseIosAppExit, parseIosCrashLog, parseIosCrashReport, watchIosCrashReports, watchPhysicalIosCrashes } from "../src/server/crash-reports.ts";
import { listIosAppExecutables } from "../src/server/ios-devices.ts";
import { parseLogcat } from "../src/server/log-parsers.ts";
import { formatLogContext, logKey } from "../src/shared/logs.ts";
import type { CrashWatchTarget, LogRecord, StackedLog } from "../src/shared/logs.ts";
import { LogSessions } from "../src/server/log-sessions.ts";
import { compileLogQuery } from "../src/ui/log-query.ts";
import { CrashMonitor } from "../src/ui/crash-monitor.ts";
import type { PanelContext } from "../src/ui/model-context.ts";

const udid = "11111111-2222-3333-4444-555555555555";
function ipsReport(deviceId = udid, overrides: Record<string, unknown> = {}) {
  const header = { app_name: "Example", timestamp: "2026-10-19 12:00:00.00 +0200", bundleID: "com.example.app", bug_type: "309" };
  const body = {
    procName: "Example", pid: 4242, captureTime: "2026-10-19 12:00:01.5000 +0200",
    procPath: `/Users/dev/Library/Developer/CoreSimulator/Devices/${deviceId}/data/Containers/Bundle/Application/ABC/Example.app/Example`,
    bundleInfo: { CFBundleIdentifier: "com.example.app" },
    exception: { type: "EXC_CRASH", signal: "SIGABRT" },
    asi: { CoreFoundation: ["*** Terminating app due to uncaught exception 'NSInvalidArgumentException', reason: 'unrecognized selector'"] },
    faultingThread: 0,
    threads: [{ triggered: true, queue: "com.apple.main-thread", frames: [
      { imageIndex: 0, imageOffset: 16, symbol: "__pthread_kill", symbolLocation: 8 },
      { imageIndex: 1, imageOffset: 32, sourceFile: "ViewController.swift", sourceLine: 12 },
    ] }],
    lastExceptionBacktrace: [{ imageIndex: 1, imageOffset: 8, symbol: "-[ViewController crash]", symbolLocation: 4 }],
    usedImages: [{ name: "libsystem_kernel.dylib", base: 4096 }, { name: "Example", base: 8192 }],
    ...overrides,
  };
  return `${JSON.stringify(header)}\n${JSON.stringify(body, null, 2)}`;
}

test("iOS crash reports become crash records with the faulting thread and exception reason", () => {
  const record = parseIosCrashReport(ipsReport(), udid)!;
  assert.equal(record.kind, "crash");
  assert.equal(record.level, "error");
  assert.equal(record.origin, "ios");
  assert.equal(record.appId, "com.example.app");
  assert.equal(record.process, "Example");
  assert.equal(record.pid, 4242);
  assert.equal(record.timestamp, "2026-10-19T10:00:01.500Z");
  assert.match(record.message, /^Example crashed: EXC_CRASH \(SIGABRT\) · .*NSInvalidArgumentException/);
  assert.match(record.reason!, /^\*\*\* Terminating app due to uncaught exception 'NSInvalidArgumentException'/);
  assert.equal(parseIosCrashReport(ipsReport(udid, { asi: undefined }), udid)!.reason, "EXC_CRASH (SIGABRT)");
  assert.match(record.stack!, /Last exception backtrace:\n0 +Example +-\[ViewController crash\] \+ 4/);
  assert.match(record.stack!, /Thread 0 crashed \(queue com.apple.main-thread\):\n0 +libsystem_kernel.dylib +__pthread_kill \+ 8\n1 +Example +0x2020 \(ViewController.swift:12\)/);
});

test("iOS crash reports from other simulators, the host, or partial writes are ignored", () => {
  assert.equal(parseIosCrashReport(ipsReport("99999999-2222-3333-4444-555555555555"), udid), undefined);
  assert.equal(parseIosCrashReport(ipsReport(udid, { procPath: "/Applications/Blender.app/Contents/MacOS/Blender" }), udid), undefined);
  assert.equal(parseIosCrashReport(ipsReport().slice(0, 300), udid), undefined);
});

const phoneUdid = "00008110-001A2B3C4D5E6F70";
const phoneReport = (pid = 4242) => ipsReport(udid, { pid, procPath: "/private/var/containers/Bundle/Application/ABC/Example.app/Example" });

test("physical iPhone crash reports parse without a simulator path", () => {
  const record = parseIosCrashReport(phoneReport())!;
  assert.equal(record.appId, "com.example.app");
  assert.equal(record.process, "Example");
  assert.match(record.stack!, /Thread 0 crashed/);
  assert.equal(parseIosCrashReport(phoneReport(), udid), undefined);
});

test("the simulator crash watcher reports new matching reports once and stops on abort", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mobile-dev-crashes-"));
  const controller = new AbortController();
  const records: LogRecord[] = [];
  try {
    await writeFile(join(directory, "Old-2026-10-19-110000.ips"), ipsReport());
    const old = new Date(Date.now() - 60000);
    await utimes(join(directory, "Old-2026-10-19-110000.ips"), old, old);
    watchIosCrashReports(udid, record => records.push(record), controller.signal, directory);
    await delay(50);
    await writeFile(join(directory, "Other-2026-10-19-120000.ips"), ipsReport("99999999-2222-3333-4444-555555555555"));
    // A partial write retries until the report is complete.
    const path = join(directory, "Example-2026-10-19-120001.ips");
    const text = ipsReport();
    await writeFile(path, text.slice(0, 200));
    await delay(250);
    await writeFile(path, text);
    await writeFile(join(directory, "notes.txt"), "ignored");
    for (let attempt = 0; attempt < 40 && records.length === 0; attempt++) await delay(50);
    await delay(400);
    assert.equal(records.length, 1);
    assert.equal(records[0].appId, "com.example.app");
    controller.abort();
    await writeFile(join(directory, "Example-2026-10-19-120002.ips"), ipsReport());
    await delay(400);
    assert.equal(records.length, 1);
  } finally {
    controller.abort();
    await rm(directory, { recursive: true, force: true });
  }
});

const exitLine = (status: string, app = "host.exp.Exponent") => JSON.stringify({ timestamp: "2026-10-19 19:03:20.088484+0200",
  eventMessage: `Process exited: <FBApplicationProcess: 0x11bb71800; app<${app}>:6993(vA52BCD)> -> <RBSProcessExitContext| specific, status:<RBSProcessExitStatus| ${status}>>` });

test("SpringBoard exit lines report simulator crashes immediately and ignore normal quits", () => {
  assert.deepEqual(parseIosAppExit(exitLine("domain:signal(2) code:SIGABRT(6)")), { appId: "host.exp.Exponent", pid: 6993, signal: "SIGABRT", timestamp: "2026-10-19T17:03:20.088Z" });
  assert.equal(parseIosAppExit(exitLine("domain:signal(2) code:SIGSEGV(11)"))?.signal, "SIGSEGV");
  assert.equal(parseIosAppExit(exitLine("domain:frontboard(10) code:user-quit(0xdeadfa11)")), undefined);
  assert.equal(parseIosAppExit(exitLine("domain:signal(2) code:SIGKILL(9)")), undefined);
  assert.equal(parseIosAppExit("not json"), undefined);
});

test("the crashed app's own log lines become an early reason and stack", () => {
  assert.match(iosCrashLogPredicate(6993), /^processID == 6993 AND \(eventMessage CONTAINS\[c\] "Terminating app due to uncaught exception" OR /);
  const line = (eventMessage: string) => JSON.stringify({ eventMessage, processID: 6993 });
  const output = ["Filtering the log data using ...",
    line("nw_connection_copy_connected_local_endpoint_block_invoke [C4] Connection has no local endpoint"),
    line("*** Terminating app due to uncaught exception 'RCTFatalException: Unhandled JS Exception: TypeError: undefined is not a function', reason: 'Unhandled JS Exception'\n*** First throw call stack:\n(\n\t0   CoreFoundation  __exceptionPreprocess + 160\n)"),
    line("*** Terminating app due to uncaught exception 'RCTFatalException: Unhandled JS Exception: TypeError: undefined is not a function', reason: 'Unhandled JS Exception'\n*** First throw call stack:\n(\n\t0   CoreFoundation  __exceptionPreprocess + 160\n)"),
  ].join("\n");
  const details = parseIosCrashLog(output)!;
  assert.equal(details.reason, "Terminating app due to uncaught exception 'RCTFatalException: Unhandled JS Exception: TypeError: undefined is not a function', reason: 'Unhandled JS Exception'");
  assert.match(details.stack, /^App log before exit:\n\n\*\*\* Terminating app/);
  assert.equal(details.stack.match(/First throw call stack/g)?.length, 1);
  assert.match(parseIosCrashLog(line("Example/ContentView.swift:12: Fatal error: Index out of range"))!.reason, /Fatal error: Index out of range$/);
  assert.equal(parseIosCrashLog(line("Connection refused")), undefined);
});

const logcat = (line: string) => parseLogcat(`10-19 12:00:00.000  1234  1234 ${line}`)!;

test("Android FATAL EXCEPTION blocks collapse into one crash record", async () => {
  const crashes: LogRecord[] = [];
  const collector = new AndroidCrashCollector(record => crashes.push(record), 20);
  for (const line of [
    "I MainActivity: before",
    "E AndroidRuntime: FATAL EXCEPTION: main",
    "E AndroidRuntime: Process: com.example.app, PID: 1234",
    "E AndroidRuntime: java.lang.IllegalStateException: boom",
    "E AndroidRuntime: \tat com.example.app.MainActivity.onCreate(MainActivity.kt:10)",
    "E AndroidRuntime: Caused by: java.lang.NullPointerException",
  ]) collector.push(logcat(line));
  assert.equal(crashes.length, 0);
  await delay(60);
  assert.equal(crashes.length, 1);
  const [crash] = crashes;
  assert.equal(crash.kind, "crash");
  assert.equal(crash.appId, "com.example.app");
  assert.equal(crash.pid, 1234);
  assert.equal(crash.message, "com.example.app crashed on thread main: java.lang.IllegalStateException: boom");
  assert.equal(crash.reason, "IllegalStateException: boom");
  assert.equal(crash.stack, "java.lang.IllegalStateException: boom\n\tat com.example.app.MainActivity.onCreate(MainActivity.kt:10)\nCaused by: java.lang.NullPointerException");
});

test("Android crash blocks end at the next unrelated line and native fatal signals are reported", () => {
  const crashes: LogRecord[] = [];
  const collector = new AndroidCrashCollector(record => crashes.push(record), 10000);
  collector.push(logcat("E AndroidRuntime: FATAL EXCEPTION: mqt_js"));
  collector.push(logcat("E AndroidRuntime: com.facebook.react.common.JavascriptException: TypeError"));
  collector.push(logcat("I Process: Sending signal. PID: 1234 SIG: 9"));
  assert.equal(crashes.length, 1);
  assert.match(crashes[0].message, /on thread mqt_js: com\.facebook\.react\.common\.JavascriptException/);
  collector.push(logcat("F libc: Fatal signal 11 (SIGSEGV), code 1 (SEGV_MAPERR), fault addr 0x0 in tid 1234 (main), pid 1234 (com.example.app)"));
  assert.equal(crashes.length, 2);
  assert.equal(crashes[1].appId, "com.example.app");
  assert.equal(crashes[1].reason, "SIGSEGV");
  assert.match(crashes[1].message, /^com\.example\.app crashed: SIGSEGV/);
  collector.flush();
  assert.equal(crashes.length, 2);
});

test("crash records have their own chat context, query field, and stacking key", () => {
  const crash = { ...parseIosCrashReport(ipsReport(), udid)!, sequence: 1, count: 1, lastTimestamp: "2026-10-19T10:00:01.500Z" };
  assert.match(formatLogContext(crash), /^Mobile Dev app crash report\./);
  assert.notEqual(logKey(crash), logKey({ ...crash, kind: undefined }));
  assert.equal(compileLogQuery("kind:crash").match(crash, Date.now()), true);
  assert.equal(compileLogQuery("kind:crash").match({ ...crash, kind: undefined }, Date.now()), false);
});

test("crash sessions wait for crash records and close their watcher", async () => {
  let emit: ((crash: LogRecord) => void) | undefined;
  let closed = 0;
  const logs = new LogSessions({ native: () => async () => {}, metro: () => async () => {}, crashes: (target, next) => {
    assert.deepEqual(target, { platform: "android", deviceId: "emulator-5554" });
    emit = next;
    return async () => { closed++; };
  } });
  const id = logs.openCrashes({ platform: "android", deviceId: "emulator-5554" });
  const reading = logs.read(id, 0);
  setTimeout(() => emit!({ timestamp: "2026-10-19T10:00:00Z", level: "error", source: "native", origin: "android", kind: "crash", message: "boom" }), 30);
  const batch = await reading;
  assert.equal(batch.entries[0].message, "boom");
  assert.throws(() => logs.openCrashes({ platform: "android", deviceId: "bad id" } as never));
  await logs.close();
  assert.equal(closed, 1);
});

test("log sessions watch crashes for the same app or process as their native target", async () => {
  const targets: unknown[] = [];
  let emit: ((crash: LogRecord) => void) | undefined;
  const logs = new LogSessions({ native: () => async () => {}, metro: () => async () => {}, crashes: (target, next) => { targets.push(target); emit = next; return async () => {}; } });
  try {
    const id = logs.open({ native: { platform: "android", deviceId: "emulator-5554", packageName: "com.example.app" } });
    assert.deepEqual(targets, [{ platform: "android", deviceId: "emulator-5554" }]);
    const crash = { timestamp: "2026-10-19T10:00:00Z", level: "error", source: "native", origin: "android", kind: "crash", message: "boom" } as const;
    emit!({ ...crash, appId: "com.other.app" });
    emit!({ ...crash, appId: "com.example.app" });
    assert.deepEqual((await logs.read(id, 0, 0)).entries.map(entry => entry.appId), ["com.example.app"]);
    logs.open({ native: { platform: "ios", kind: "physical", deviceId: phoneUdid } });
    assert.deepEqual(targets[1], { platform: "ios", kind: "physical", deviceId: phoneUdid });
  } finally { await logs.close(); }
  const ios = crashWatchFor({ platform: "ios", deviceId: "C6C04008-45B0-431B-9BA8-96BE5BE99C56", process: "Expo Go" })!;
  assert.equal(ios.includes({ timestamp: "", level: "error", source: "native", origin: "ios", message: "", process: "Expo Go" }), true);
  assert.equal(ios.includes({ timestamp: "", level: "error", source: "native", origin: "ios", message: "", process: "Other" }), false);
});

function crashMonitorFixture() {
  const visibility = new EventTarget() as EventTarget & { visibilityState: string };
  visibility.visibilityState = "visible";
  Object.defineProperty(globalThis, "document", { value: visibility, configurable: true });
  let emit: ((crash: LogRecord) => void) | undefined;
  const calls: string[] = [];
  const targets: CrashWatchTarget[] = [];
  const logs = new LogSessions({ native: () => async () => {}, metro: () => async () => {}, crashes: (target, next) => { targets.push(target); emit = next; return async () => {}; } });
  const app = {
    async callServerTool(input: { name: string; arguments: { target?: CrashWatchTarget; sessionId?: string } }) {
      calls.push(input.name);
      if (input.name === "mobile_crashes_session") {
        const id = logs.openCrashes(input.arguments.target!);
        return { content: [], _meta: { sessionId: id, logsUri: `logs://mobile-dev/${id}/batch?after=0` } };
      }
      await logs.closeSession(input.arguments.sessionId!);
      return { content: [] };
    },
    readServerResource(input: { uri: string }, options: { signal: AbortSignal }) {
      const uri = new URL(input.uri);
      return new Promise((resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
        void logs.read(uri.pathname.split("/")[1], Number(uri.searchParams.get("after")), 50)
          .then(batch => resolve({ contents: [{ uri: input.uri, mimeType: "application/json", text: JSON.stringify(batch) }] }), reject);
      });
    },
  };
  const listeners = new Set<() => void>();
  const context = { canAttach: true, canSendMessage: true, attachedKey: undefined as string | undefined, sent: [] as StackedLog[],
    subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
    async attach(log?: StackedLog) { this.attachedKey = log ? logKey(log) : undefined; for (const listener of listeners) listener(); },
    async sendLogToChat(log: StackedLog) { this.sent.push(log); } };
  const monitor = new CrashMonitor();
  monitor.connect(app as never, context as unknown as PanelContext);
  const crash = (message: string, deviceId = "emulator-5554"): LogRecord => ({ timestamp: "2026-10-19T10:00:00Z", level: "error", source: "native", origin: "android", kind: "crash", deviceId, appId: "host.exp.exponent", message, stack: "at main" });
  const until = async (condition: () => boolean) => { for (let attempt = 0; attempt < 100 && !condition(); attempt++) await delay(10); assert.ok(condition()); };
  return { monitor, context, calls, targets, logs, crash, until, emit: (record: LogRecord) => emit!(record), ready: () => emit !== undefined };
}

const emulator = { udid: "emulator-5554", name: "Pixel 9", state: "Booted", runtime: "Android 16", platform: "android", kind: "emulator" } as const;

test("the crash toast shows crashes for the panel device, repeats, attaches, and sends", async () => {
  const { monitor, context, calls, logs, crash, until, emit, ready } = crashMonitorFixture();
  try {
    monitor.configure(emulator, true);
    await until(ready);
    emit({ ...crash("first"), kind: undefined });
    emit(crash("host.exp.exponent crashed: boom"));
    await until(() => monitor.getSnapshot().crash !== undefined);
    assert.equal(monitor.getSnapshot().crash?.message, "host.exp.exponent crashed: boom");
    assert.equal(monitor.getSnapshot().deviceName, "Pixel 9");
    emit(crash("host.exp.exponent crashed: boom"));
    await until(() => monitor.getSnapshot().crash?.count === 2);
    monitor.toggleDetails();
    assert.equal(monitor.getSnapshot().expanded, true);
    await monitor.attach();
    assert.equal(monitor.getSnapshot().attached, true);
    await monitor.sendToChat();
    assert.equal(context.sent.length, 1);
    monitor.dismiss();
    assert.equal(monitor.getSnapshot().crash, undefined);
    // Hiding the panel stops watching and keeps nothing running.
    monitor.configure(emulator, false);
    await until(() => calls.includes("mobile_logs_close"));
  } finally { monitor.dispose(); await logs.close(); }
});

test("an iOS exit crash shows at once, then gains its stack and keeps an early attachment", async () => {
  const { monitor, context, logs, until, emit, ready } = crashMonitorFixture();
  const simulator = { udid: "C6C04008-45B0-431B-9BA8-96BE5BE99C56", name: "iPhone 17", state: "Booted", runtime: "iOS 27", platform: "ios" } as const;
  const base = { timestamp: "2026-10-19T10:00:00Z", level: "error", source: "native", origin: "ios", kind: "crash", deviceId: simulator.udid, appId: "host.exp.Exponent", pid: 6993 } as const;
  try {
    monitor.configure(simulator, true);
    await until(ready);
    emit({ ...base, message: "host.exp.Exponent crashed: SIGABRT" });
    await until(() => monitor.getSnapshot().crash !== undefined);
    assert.equal(monitor.getSnapshot().reportPending, true);
    await monitor.attach();
    emit({ ...base, process: "Expo Go", message: "Expo Go crashed: EXC_CRASH (SIGABRT)", stack: "Thread 0 crashed:" });
    await until(() => monitor.getSnapshot().crash?.stack !== undefined);
    await until(() => monitor.getSnapshot().attached);
    const snapshot = monitor.getSnapshot();
    assert.equal(snapshot.crash?.count, 1);
    assert.equal(snapshot.reportPending, false);
    assert.equal(context.attachedKey, logKey(snapshot.crash!));
    emit({ ...base, message: "host.exp.Exponent crashed: SIGABRT" });
    await delay(80);
    assert.equal(monitor.getSnapshot().crash?.stack, "Thread 0 crashed:");
    emit({ ...base, pid: 7000, message: "host.exp.Exponent crashed: SIGSEGV" });
    await until(() => monitor.getSnapshot().crash?.count === 2);
  } finally { monitor.dispose(); await logs.close(); }
});

test("the crash toast watches connected iPhones and clears when switching devices", async () => {
  const { monitor, calls, targets, logs, crash, until, emit, ready } = crashMonitorFixture();
  const phone = { udid: phoneUdid, name: "iPhone", state: "connected", runtime: "", platform: "ios", kind: "physical" } as never;
  try {
    monitor.configure({ ...(phone as object), state: "disconnected" } as never, true);
    await delay(20);
    assert.deepEqual(calls, []);
    monitor.configure(phone, true);
    await until(ready);
    assert.deepEqual(targets, [{ platform: "ios", kind: "physical", deviceId: phoneUdid }]);
    monitor.configure(emulator, true);
    await until(() => targets.length === 2);
    emit(crash("boom"));
    await until(() => monitor.getSnapshot().crash !== undefined);
    monitor.configure(emulator, false);
    monitor.configure(emulator, true);
    assert.equal(monitor.getSnapshot().crash?.message, "boom");
    monitor.configure({ ...emulator, udid: "emulator-5556" }, true);
    assert.equal(monitor.getSnapshot().crash, undefined);
  } finally { monitor.dispose(); await logs.close(); }
});
// SpringBoard's exit line as the phone's log relay prints it.
const relayExit = (pid: number) => JSON.stringify({ timestamp: "2026-10-19T10:00:00.250000Z", messageType: "Notice", processID: 34, process: "SpringBoard",
  eventMessage: `Process exited: <FBApplicationProcess: 0x1; app<com.example.app>:${pid}(v1A2)> -> <RBSProcessExitContext| specific, voluntary; status:<RBSProcessExitStatus| domain:signal(2) code:SIGABRT(6)>>` });

test("physical iPhone exits show at once, then pick up the report copied off the phone", async () => {
  const controller = new AbortController();
  const records: LogRecord[] = [];
  const polls: number[] = [];
  const script = `console.log('{"ready":true}'); console.log(${JSON.stringify(relayExit(4242))}); setInterval(() => {}, 1000);`;
  const watching = watchPhysicalIosCrashes(phoneUdid, record => records.push(record), controller.signal, {
    exits: async target => { assert.equal(target.process, "SpringBoard"); return { command: process.execPath, args: ["-e", script] }; },
    // The first copy has only another process's report; the next one has this crash's.
    reports: async (_udid, since) => { polls.push(since); return polls.length === 1 ? [{ name: "a.ips", modified: 0, text: phoneReport(1) }] : [{ name: "b.ips", modified: 0, text: phoneReport() }]; },
    executables: async () => new Map([["com.example.app", "Example"]]),
  }, 10);
  try {
    for (let attempt = 0; attempt < 200 && records.length < 2; attempt++) await delay(10);
    assert.equal(records.length, 2);
    assert.deepEqual({ ...records[0], timestamp: undefined }, { timestamp: undefined, level: "error", source: "native", origin: "ios", kind: "crash",
      appId: "com.example.app", pid: 4242, process: "Example", reason: "SIGABRT", message: "Example crashed: SIGABRT" });
    assert.equal(records[0].timestamp, "2026-10-19T10:00:00.250Z");
    assert.equal(polls[0], Date.parse("2026-10-19T10:00:00.250Z") - 5000);
    assert.equal(records[1].pid, 4242);
    assert.match(records[1].stack!, /Thread 0 crashed/);
  } finally { controller.abort(); await watching; }
});

test("installed iPhone apps map bundle IDs to executable names", async () => {
  const stdout = JSON.stringify({ info: { jsonVersion: 5, outcome: "success" }, result: { apps: [
    { bundleIdentifier: "com.example.app", url: "file:///private/var/containers/Bundle/Application/ABC/Pump%20Party.app/" },
    { bundleIdentifier: "com.example.odd", url: "file:///private/var/containers/Bundle/Application/DEF/" },
  ] } });
  const executables = await listIosAppExecutables(phoneUdid, undefined, async (_file, args) => {
    assert.deepEqual(args.slice(0, 6), ["devicectl", "device", "info", "apps", "--device", phoneUdid]);
    return { stdout };
  });
  assert.deepEqual([...executables], [["com.example.app", "Pump Party"]]);
});
