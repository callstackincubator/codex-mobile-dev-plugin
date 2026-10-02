import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseIOSLog, parseLogcat, parseMetroEvent } from "../src/server/log-parsers.ts";
import { startNativeLogs } from "../src/server/native-logs.ts";
import { nativeLogTargetSchema } from "../src/shared/logs.ts";
import type { LogRecord, NativeLogTarget } from "../src/shared/logs.ts";
import { UDID } from "./fixtures.ts";

function parse(fields: Record<string, unknown>, hideSystemLogs = true) {
  const line = JSON.stringify({ eventMessage: "fixture", ...fields });
  return parseIOSLog(line, hideSystemLogs);
}

test("default exclusions retain DevSuite's severity thresholds across subsystem families", () => {
  for (const messageType of ["Debug", "Default", "Notice", "Info"]) {
    const record = parse({ messageType, subsystem: "COM.APPLE.CFNetwork" });
    assert.equal(record, undefined, messageType);
  }
  for (const messageType of ["Error", "Fault", "warning", "unknown", undefined]) {
    const record = parse({ messageType, subsystem: "com.apple.network" });
    const label = String(messageType);
    assert.ok(record, label);
  }
  for (const messageType of ["Debug", "Default", "Notice"]) {
    const record = parse({ messageType, subsystem: "com.apple.UIKit" });
    assert.equal(record, undefined, messageType);
  }
  const uikitInfo = parse({ messageType: "Info", subsystem: "com.apple.UIKit" });
  assert.ok(uikitInfo, "DevSuite's default threshold still permits info logs.");
  const appRecord = parse({ messageType: "Debug", subsystem: "com.example.app" });
  assert.ok(appRecord);
  const partialSubsystem = parse({ messageType: "Debug", subsystem: "com.apple.network.extension" });
  assert.equal(partialSubsystem, undefined, "Dot-separated child subsystems inherit their family's threshold.");
  const missingMetadata = parse({ messageType: "Debug" });
  assert.ok(missingMetadata);
  const logType = parse({ logType: "notice", subsystem: "com.apple.CFBundle" });
  assert.equal(logType, undefined);
});

test("observed iOS system families hide routine logs and preserve diagnostics", () => {
  const families = [
    "com.apple.SystemConfiguration", "com.apple.coreaudio", "com.apple.launchservices",
    "com.apple.apsd", "com.apple.symptomsd", "com.apple.RemoteServiceDiscovery",
    "com.apple.locationd", "com.apple.mDNSResponder", "com.apple.xnu.net",
    "com.apple.dt.coredevice", "com.apple.WiFiManager", "com.apple.bluetooth",
    "com.apple.uaps", "com.apple.CoreBrightness", "com.apple.WirelessRadioManager",
    "com.apple.WiFiPolicy", "com.apple.xpc",
  ];
  for (const family of families) {
    for (const subsystem of [family, `${family}.child.nested`]) {
      for (const messageType of ["Debug", "Default", "Notice", "Info"]) {
        const record = parse({ messageType, subsystem });
        assert.equal(record, undefined, `${subsystem}: ${messageType}`);
        const unfiltered = parse({ messageType, subsystem }, false);
        assert.ok(unfiltered, `${subsystem}: filtering disabled`);
      }
      for (const messageType of ["Error", "Fault", "warning", "unknown", undefined]) {
        const record = parse({ messageType, subsystem });
        assert.ok(record, `${subsystem}: ${messageType}`);
      }
    }
  }
});

test("family matching respects dot boundaries, custom subsystems, and severity thresholds", () => {
  for (const subsystem of [
    "com.apple.networking", "com.apple.xpcustom", "com.apple.coreaudioapp",
    "com.apple.xnu.network", "com.example.com.apple.network", "com.example.app",
  ]) {
    const record = parse({ messageType: "Debug", subsystem });
    assert.ok(record, subsystem);
  }
  for (const subsystem of ["COM.APPLE.XPC.TRANSACTION", "com.apple.locationd.Motion", "com.apple.CoreBrightness.AABC.1"]) {
    const record = parse({ messageType: "Info", subsystem });
    assert.equal(record, undefined, subsystem);
  }
  for (const subsystem of ["com.apple.UIKit.child", "com.apple.CFBundle.child"]) {
    const debug = parse({ messageType: "Debug", subsystem });
    assert.equal(debug, undefined, subsystem);
    const info = parse({ messageType: "Info", subsystem });
    assert.ok(info, subsystem);
  }
  const javascript = parse({ messageType: "Debug", category: "JavaScript", subsystem: "com.example.app" });
  assert.equal(javascript?.source, "js");
});

test("framework rules match sender image paths without hiding errors or changing path case", () => {
  const cases = [
    { path: "UIKitCore.framework/UIKitCore", threshold: "Default" },
    { path: "RunningBoardServices", threshold: "Info" },
    { path: "Security.framework/Security", threshold: "Info" },
    { path: "CoreFoundation.framework/CoreFoundation", threshold: "Notice" },
    { path: "lib/libMobileGestalt.dylib", threshold: "Default" },
    { path: "libsystem_containermanager.dylib", threshold: "Default" },
    { path: "CoreAnalytics.framework/CoreAnalytics", threshold: "Default" },
  ];
  for (const { path, threshold } of cases) {
    const senderImagePath = `/System/Library/${path}`;
    const hidden = parse({ messageType: threshold, senderImagePath });
    assert.equal(hidden, undefined, path);
    for (const messageType of ["Error", "Fault"]) {
      const record = parse({ messageType, senderImagePath });
      assert.ok(record, `${path}: ${messageType}`);
    }
    const unfiltered = parse({ messageType: threshold, senderImagePath }, false);
    assert.ok(unfiltered, path);
  }
  const info = parse({ messageType: "Info", senderImagePath: "/System/Library/UIKitCore.framework/UIKitCore" });
  assert.ok(info);
  const differentCase = parse({ messageType: "Debug", senderImagePath: "/system/library/uikitcore.framework/uikitcore" });
  assert.ok(differentCase);
  const processImage = parse({ messageType: "Debug", processImagePath: "/System/Library/UIKitCore.framework/UIKitCore" });
  assert.ok(processImage, "The process image is not the sender image.");
});

test("the optional setting is iOS-only and disabling it retains raw system logs", () => {
  for (const kind of ["simulator", "physical"] as const) {
    const deviceId = kind === "physical" ? "00008110-000A0B1C2D3E4000" : UDID;
    for (const hideSystemLogs of [undefined, true, false]) {
      const result = nativeLogTargetSchema.safeParse({ platform: "ios", kind, deviceId, hideSystemLogs });
      assert.equal(result.success, true);
    }
    const invalid = nativeLogTargetSchema.safeParse({ platform: "ios", kind, deviceId, hideSystemLogs: "false" });
    assert.equal(invalid.success, false);
  }
  const androidOption = nativeLogTargetSchema.safeParse({ platform: "android", deviceId: "emulator-5554", hideSystemLogs: false });
  assert.equal(androidOption.success, false);
  const record = parse({ messageType: "Info", subsystem: "com.apple.network" }, false);
  assert.ok(record);
  const android = parseLogcat("09-30 14:00:00.123  1234  5678 I com.apple.network: fixture");
  assert.ok(android);
  const metro = parseMetroEvent({ method: "Runtime.consoleAPICalled", params: { type: "debug", args: [{ value: "com.apple.network" }] } });
  assert.ok(metro);
});

test("simulator and physical streams apply the setting before delivering records", { skip: process.platform !== "darwin", timeout: 10000 }, async t => {
  const records = [
    { eventMessage: "network noise", messageType: "Info", subsystem: "com.apple.network" },
    { eventMessage: "framework noise", messageType: "Notice", senderImagePath: "/System/Library/CoreFoundation.framework/CoreFoundation" },
    { eventMessage: "audio noise", messageType: "Info", subsystem: "com.apple.coreaudio" },
    { eventMessage: "transaction noise", messageType: "Debug", subsystem: "com.apple.xpc.transaction" },
    { eventMessage: "system error", messageType: "Error", subsystem: "com.apple.network" },
    { eventMessage: "audio fault", messageType: "Fault", subsystem: "com.apple.coreaudio.queue" },
    { eventMessage: "done", messageType: "Debug", subsystem: "com.example.app" },
  ];
  const encoded = JSON.stringify(records);
  const code = `console.log('{"ready":true}');
    const records = ${encoded};
    for (const record of records) console.log(JSON.stringify({ processID: 123, process: 'Example', ...record }));
    setInterval(() => {}, 1000);`;
  const temporary = tmpdir();
  const prefix = join(temporary, "mobile-dev-ios-filter-");
  const directory = await mkdtemp(prefix);
  const xcrun = join(directory, "xcrun");
  await writeFile(xcrun, `#!${process.execPath}\n${code}`, { mode: 0o755 });
  const previousPath = process.env.PATH;
  process.env.PATH = `${directory}:${previousPath ?? ""}`;
  t.after(async () => {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    await rm(directory, { recursive: true, force: true });
  });
  for (const kind of ["simulator", "physical"] as const) {
    for (const hideSystemLogs of [undefined, true, false]) {
      await t.test(`${kind}, hideSystemLogs=${hideSystemLogs}`, async subtest => {
        const entries: LogRecord[] = [];
        let accepted!: () => void;
        const ready = new Promise<void>(resolve => { accepted = resolve; });
        const deviceId = kind === "physical" ? "00008110-000A0B1C2D3E4000" : UDID;
        const target: NativeLogTarget = { platform: "ios", kind, deviceId, pid: 123, hideSystemLogs };
        const stop = startNativeLogs(target, {
          log(record) { entries.push(record); if (record.message === "done") accepted(); }, status() {},
        }, async () => ({ command: process.execPath, args: ["-e", code] }));
        subtest.after(stop);
        await ready;
        await stop();
        const messages = entries.map(record => record.message);
        const expected = hideSystemLogs === false
          ? ["network noise", "framework noise", "audio noise", "transaction noise", "system error", "audio fault", "done"]
          : ["system error", "audio fault", "done"];
        assert.deepEqual(messages, expected);
      });
    }
  }
});
