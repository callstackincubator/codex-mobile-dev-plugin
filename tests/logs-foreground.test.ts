import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import type { App } from "@modelcontextprotocol/ext-apps";
import type { ForegroundApp } from "../src/shared/device-apps.ts";
import type { LogOptions, LogEntry, MetroTarget } from "../src/shared/logs.ts";
import type { PanelContext } from "../src/ui/model-context.ts";
import { LogsPanel } from "../src/ui/logs-panel.ts";
import { createDeviceApps } from "./device-apps-fixtures.ts";
import { UDID, OTHER_UDID } from "./fixtures.ts";

const ios = { udid: UDID, name: "iPhone", state: "Booted", runtime: "iOS", platform: "ios" as const };
const android = { udid: "emulator-5554", name: "Pixel", state: "Booted", runtime: "Android", platform: "android" as const };
const first: ForegroundApp = { bundleId: "com.example.first", pid: 123 };
const second: ForegroundApp = { bundleId: "com.example.second", pid: 456 };
const record: LogEntry = { sequence: 1, timestamp: "2026-10-02T12:00:00Z", source: "native", origin: "ios", level: "info", message: "fixture", pid: 123 };

function fixture(t: TestContext) {
  let foregroundApp: ForegroundApp | null = first;
  let failure = false;
  let targets: MetroTarget[] = [];
  const opened: LogOptions[] = [];
  const closed: string[] = [];
  const readings: { signal: AbortSignal; resolve: (entries: LogEntry[]) => void }[] = [];
  const app = {
    async callServerTool(input: { name: string; arguments: { options?: LogOptions; sessionId?: string } }) {
      if (input.name === "mobile_performance_sources") {
        if (failure) throw new Error("fixture discovery failure");
        return { content: [], structuredContent: { apps: [], foregroundApp } };
      }
      if (input.name === "mobile_log_sources") return { content: [], structuredContent: { android: [], metro: targets, errors: [] } };
      if (input.name === "mobile_logs_session") {
        assert.ok(input.arguments.options);
        opened.push(input.arguments.options);
        const sessionId = `session-${opened.length}`;
        return { content: [], _meta: { sessionId, logsUri: `logs://mobile-dev/${sessionId}/batch?after=0` } };
      }
      if (input.name === "mobile_logs_close") {
        assert.ok(input.arguments.sessionId);
        closed.push(input.arguments.sessionId);
        return { content: [] };
      }
      if (input.name === "mobile_logs_keep_alive") return { content: [] };
      throw new Error(`Unexpected tool: ${input.name}`);
    },
    readServerResource(input: { uri: string }, options: { signal: AbortSignal }) {
      return new Promise((resolve, reject) => {
        const abort = () => reject(new Error("Read cancelled"));
        options.signal.addEventListener("abort", abort, { once: true });
        readings.push({ signal: options.signal, resolve(entries) {
          options.signal.removeEventListener("abort", abort);
          const text = JSON.stringify({ entries, cursor: 1, dropped: 0, statuses: [] });
          resolve({ contents: [{ uri: input.uri, mimeType: "application/json", text }] });
        } });
      });
    },
  };
  const client = app as unknown as App;
  const deviceApps = createDeviceApps(client);
  const panel = new LogsPanel(client, { canAttach: true } as PanelContext, deviceApps);
  t.after(async () => { await panel.dispose(); deviceApps.dispose(); });
  const refresh = async (value: ForegroundApp | null) => {
    foregroundApp = value;
    await deviceApps.refresh();
    await setImmediate();
  };
  return { panel, deviceApps, opened, closed, readings, refresh,
    setForeground(value: ForegroundApp | null) { foregroundApp = value; },
    setFailure(value: boolean) { failure = value; }, setTargets(value: MetroTarget[]) { targets = value; } };
}

test("native logs follow foreground app changes and PID restarts through the shared discovery store", async t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { panel, deviceApps, opened, closed, readings, refresh, setForeground } = fixture(t);
  deviceApps.selectDevice(ios);
  panel.setAvailable(true);
  panel.show();
  assert.equal(opened.length, 0);
  assert.equal(panel.getSnapshot().status, "Waiting for foreground app");
  deviceApps.setAvailable(true);
  await refresh(first);
  assert.deepEqual(opened, [{ native: { platform: "ios", deviceId: UDID, pid: 123, hideSystemLogs: true } }]);
  const initialRead = readings[0];
  initialRead.resolve([record]);
  await setImmediate();
  assert.equal(panel.list.getSnapshot().buffered, 1);
  panel.list.search("fixture");
  await refresh(first);
  assert.equal(opened.length, 1, "An unchanged poll does not restart collection.");
  const lateRead = readings.at(-1)!;
  await refresh(second);
  assert.equal(initialRead.signal.aborted, true);
  assert.equal(lateRead.signal.aborted, true);
  assert.deepEqual(closed, ["session-1"]);
  assert.deepEqual(opened[1], { native: { platform: "ios", deviceId: UDID, pid: 456, hideSystemLogs: true } });
  lateRead.resolve([record]);
  await setImmediate();
  assert.equal(panel.list.getSnapshot().buffered, 0, "Late rows from the old app are ignored.");
  assert.equal(panel.list.getSnapshot().query, "fixture");
  await refresh({ ...second, pid: 789 });
  assert.deepEqual(opened[2], { native: { platform: "ios", deviceId: UDID, pid: 789, hideSystemLogs: true } });
  setForeground(first);
  deviceApps.selectDevice({ ...ios, udid: OTHER_UDID });
  await refresh(first);
  assert.deepEqual(opened[3], { native: { platform: "ios", deviceId: OTHER_UDID, pid: 123, hideSystemLogs: true } });
});

test("Android follows the foreground package even when it is outside the monitoring list", async t => {
  const { panel, deviceApps, opened, refresh } = fixture(t);
  deviceApps.selectDevice(android);
  panel.setAvailable(true);
  panel.show();
  deviceApps.setAvailable(true);
  await refresh(first);
  assert.deepEqual(opened[0], { native: { platform: "android", deviceId: android.udid, packageName: first.bundleId } });
  await refresh({ ...second, pid: null });
  assert.deepEqual(opened[1], { native: { platform: "android", deviceId: android.udid, packageName: second.bundleId } });
});

test("system-noise changes reopen iOS streams and survive pause and device changes", async t => {
  const { panel, deviceApps, opened, closed, refresh } = fixture(t);
  deviceApps.selectDevice(ios);
  panel.setAvailable(true);
  panel.show();
  deviceApps.setAvailable(true);
  await refresh(first);
  const initial = panel.getSnapshot();
  assert.equal(initial.hideSystemLogs, true);
  panel.configure({ hideSystemLogs: false });
  await setImmediate();
  assert.deepEqual(closed, ["session-1"]);
  assert.deepEqual(opened[1], { native: { platform: "ios", deviceId: UDID, pid: 123, hideSystemLogs: false } });
  const disabled = panel.getSnapshot();
  assert.equal(disabled.followApp, true);
  panel.configure({ hideSystemLogs: false });
  await setImmediate();
  assert.equal(opened.length, 2, "An unchanged setting does not restart collection.");
  panel.togglePause();
  panel.configure({ hideSystemLogs: true });
  await setImmediate();
  assert.equal(opened.length, 2, "Changing the setting does not resume paused logs.");
  panel.togglePause();
  await setImmediate();
  const resumed = opened.at(-1);
  assert.equal(resumed?.native?.platform, "ios");
  if (resumed?.native?.platform === "ios") assert.equal(resumed.native.hideSystemLogs, true);
  panel.configure({ hideSystemLogs: false });
  await setImmediate();
  const phone = { ...ios, udid: "00008110-000A0B1C2D3E4000", state: "connected", kind: "physical" as const };
  deviceApps.selectDevice(phone);
  await refresh(first);
  const physical = opened.at(-1);
  assert.deepEqual(physical, { native: { platform: "ios", kind: "physical", deviceId: phone.udid, pid: 123, hideSystemLogs: false } });
  deviceApps.selectDevice(android);
  await refresh(first);
  const androidOptions = opened.at(-1);
  assert.deepEqual(androidOptions, { native: { platform: "android", deviceId: android.udid, packageName: first.bundleId } });
});

test("physical iOS uses the screen-owning PID without guessing a process name or monitoring app", async t => {
  const { panel, deviceApps, opened, refresh } = fixture(t);
  const phone = { ...ios, udid: "00008110-000A0B1C2D3E4000", state: "connected", kind: "physical" as const };
  deviceApps.selectDevice(phone);
  panel.setAvailable(true);
  panel.show();
  deviceApps.setAvailable(true);
  await refresh({ bundleId: null, pid: 123 });
  assert.deepEqual(opened[0], { native: { platform: "ios", kind: "physical", deviceId: phone.udid, pid: 123, hideSystemLogs: true } });
  deviceApps.selectDevice({ ...phone, state: "disconnected" });
  await setImmediate();
  assert.equal(opened.length, 1);
  assert.equal(panel.getSnapshot().foregroundApp, null);
});

test("unknown foreground apps and discovery failures stop scoped collection and recover without an all-app stream", async t => {
  const { panel, deviceApps, opened, closed, refresh, setFailure } = fixture(t);
  deviceApps.selectDevice(ios);
  panel.setAvailable(true);
  panel.show();
  deviceApps.setAvailable(true);
  await refresh(first);
  await refresh(null);
  assert.equal(opened.length, 1);
  assert.deepEqual(closed, ["session-1"]);
  assert.equal(panel.getSnapshot().status, "Waiting for foreground app");
  await refresh(second);
  setFailure(true);
  await refresh(second);
  assert.equal(opened.length, 2);
  assert.equal(panel.getSnapshot().foregroundApp, null);
  assert.match(panel.getSnapshot().appDiscoveryError, /discovery failure/);
  setFailure(false);
  await refresh(first);
  assert.equal(opened.length, 3);
});

test("manual filtering, pause, hidden logs, and closed logs preserve their intended lifecycle", async t => {
  const { panel, deviceApps, opened, refresh } = fixture(t);
  deviceApps.selectDevice(ios);
  panel.setAvailable(true);
  panel.show();
  deviceApps.setAvailable(true);
  await refresh(first);
  panel.configure({ followApp: false, process: "Manual" });
  await setImmediate();
  const manualCount = opened.length;
  await refresh(second);
  assert.equal(opened.length, manualCount);
  assert.deepEqual(opened.at(-1), { native: { platform: "ios", deviceId: UDID, process: "Manual", hideSystemLogs: true } });
  panel.configure({ followApp: true });
  await setImmediate();
  panel.togglePause();
  const pausedCount = opened.length;
  await refresh(first);
  assert.equal(opened.length, pausedCount);
  panel.togglePause();
  await setImmediate();
  assert.deepEqual(opened.at(-1), { native: { platform: "ios", deviceId: UDID, pid: 123, hideSystemLogs: true } });
  panel.list.append([record], 0);
  panel.hide();
  const cached = panel.list.getSnapshot();
  const hiddenCount = opened.length;
  await refresh(second);
  assert.equal(panel.list.getSnapshot(), cached, "Hidden logs do not process or filter rows.");
  assert.equal(opened.length, hiddenCount);
  panel.show();
  await setImmediate();
  assert.equal(panel.list.getSnapshot().buffered, 0);
  assert.deepEqual(opened.at(-1), { native: { platform: "ios", deviceId: UDID, pid: 456, hideSystemLogs: true } });
  panel.list.append([record], 0);
  panel.toggle();
  await refresh(null);
  panel.show();
  await setImmediate();
  assert.equal(panel.list.getSnapshot().buffered, 0, "Reopening with no foreground app clears old rows.");
  assert.equal(panel.getSnapshot().status, "Waiting for foreground app");
});

test("explicit Metro targets join automatic logs only when their app matches the foreground app", async t => {
  const { panel, deviceApps, opened, refresh, setTargets } = fixture(t);
  deviceApps.selectDevice(ios);
  panel.setAvailable(true);
  panel.show();
  deviceApps.setAvailable(true);
  await refresh(first);
  setTargets([{ id: "metro-1", appId: first.bundleId!, title: "First" }]);
  await panel.discover();
  panel.configure({ target: "metro-1" });
  await setImmediate();
  assert.deepEqual(opened.at(-1)?.metro, { url: "http://127.0.0.1:8081", targetId: "metro-1" });
  await refresh(second);
  assert.equal(opened.at(-1)?.metro, undefined, "Logs from another app are excluded.");
  await refresh(first);
  assert.deepEqual(opened.at(-1)?.metro, { url: "http://127.0.0.1:8081", targetId: "metro-1" });
});
