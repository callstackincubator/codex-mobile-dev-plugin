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
        return { content: [], structuredContent: { apps: [{ bundleId: first.bundleId, pid: first.pid }, { bundleId: second.bundleId, pid: second.pid }], foregroundApp } };
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

test("foreground switches update the visible query over the same all-process collector", async t => {
  const { panel, deviceApps, opened, closed, readings, refresh, setForeground } = fixture(t);
  deviceApps.selectDevice(ios);
  panel.setAvailable(true);
  panel.show();
  deviceApps.setAvailable(true);
  await refresh(first);
  assert.deepEqual(opened, [{ native: { platform: "ios", deviceId: UDID, hideSystemLogs: true } }]);
  const initial = panel.list.getSnapshot();
  assert.equal(initial.query, 'app:"com.example.first"');
  const reading = readings[0];
  reading.resolve([record, { ...record, pid: 456, message: "second fixture" }]);
  await setImmediate();
  const before = panel.list.getSnapshot();
  assert.equal(before.buffered, 2);
  assert.equal(before.filtered.length, 1);
  panel.search(`${before.query} fixture`);
  await refresh(second);
  const switched = panel.list.getSnapshot();
  assert.equal(switched.query, 'app:"com.example.second" & (fixture)');
  assert.equal(switched.buffered, 2);
  assert.equal(switched.filtered[0].pid, 456);
  assert.equal(opened.length, 1);
  assert.deepEqual(closed, []);
  assert.equal(reading.signal.aborted, false);
  await refresh({ ...second, pid: 789 });
  const restartedApp = panel.list.getSnapshot();
  assert.equal(restartedApp.query, switched.query);
  assert.equal(opened.length, 1);
  const next = readings.at(-1);
  assert.ok(next);
  next.resolve([{ ...record, pid: 789 }]);
  await setImmediate();
  const newPid = panel.list.getSnapshot();
  assert.equal(newPid.filtered.length, 2);
  setForeground(first);
  deviceApps.selectDevice({ ...ios, udid: OTHER_UDID });
  await refresh(first);
  assert.equal(reading.signal.aborted, true);
  assert.equal(opened.length, 2);
  const newDevice = panel.list.getSnapshot();
  assert.equal(newDevice.buffered, 0);
  assert.equal(newDevice.query, 'app:"com.example.first" & (fixture)');
});

test("clearing or editing the app clause stops automatic updates and shows other apps", async t => {
  const { panel, deviceApps, opened, readings, refresh } = fixture(t);
  deviceApps.selectDevice(ios);
  panel.setAvailable(true);
  panel.show();
  deviceApps.setAvailable(true);
  await refresh(first);
  readings[0].resolve([record, { ...record, pid: 456 }]);
  await setImmediate();
  panel.search("");
  const cleared = panel.list.getSnapshot();
  const state = panel.getSnapshot();
  assert.equal(cleared.filtered.length, 2);
  assert.equal(state.followApp, false);
  await refresh(second);
  const unchanged = panel.list.getSnapshot();
  assert.equal(unchanged.query, "");
  assert.equal(opened.length, 1);
  panel.search('app:"com.example.first"');
  await refresh(second);
  const manual = panel.list.getSnapshot();
  assert.equal(manual.query, 'app:"com.example.first"');
  assert.equal(manual.filtered.length, 1);
  panel.configure({ followApp: true });
  const automatic = panel.list.getSnapshot();
  assert.ok(automatic.query.startsWith('app:"com.example.second" & ('));
  assert.equal(opened.length, 1);
});

test("Android app clauses use process identities independently of the monitoring list", async t => {
  const { panel, deviceApps, opened, readings, refresh } = fixture(t);
  deviceApps.selectDevice(android);
  panel.setAvailable(true);
  panel.show();
  deviceApps.setAvailable(true);
  await refresh({ bundleId: "com.android.launcher", pid: 999 });
  assert.deepEqual(opened[0], { native: { platform: "android", deviceId: android.udid } });
  readings[0].resolve([{ ...record, origin: "android", pid: 999 }, { ...record, origin: "android", pid: 123 }]);
  await setImmediate();
  const snapshot = panel.list.getSnapshot();
  assert.equal(snapshot.query, 'app:"com.android.launcher"');
  assert.equal(snapshot.filtered.length, 1);
  assert.equal(snapshot.filtered[0].pid, 999);
  await refresh(first);
  const switched = panel.list.getSnapshot();
  assert.equal(switched.filtered[0].pid, 123);
  assert.equal(opened.length, 1);
});

test("unnamed physical iOS foreground processes use an exact visible PID clause", async t => {
  const { panel, deviceApps, opened, readings, refresh } = fixture(t);
  const phone = { ...ios, udid: "00008110-000A0B1C2D3E4000", state: "connected", kind: "physical" as const };
  deviceApps.selectDevice(phone);
  panel.setAvailable(true);
  panel.show();
  deviceApps.setAvailable(true);
  await refresh({ bundleId: null, pid: 999 });
  assert.deepEqual(opened[0], { native: { platform: "ios", kind: "physical", deviceId: phone.udid, hideSystemLogs: true } });
  readings[0].resolve([{ ...record, pid: 999 }, { ...record, pid: 123 }]);
  await setImmediate();
  const snapshot = panel.list.getSnapshot();
  assert.equal(snapshot.query, "pid:999");
  assert.equal(snapshot.filtered.length, 1);
  panel.search("");
  const cleared = panel.list.getSnapshot();
  assert.equal(cleared.filtered.length, 2);
});

test("foreground discovery loss removes the visible clause without restricting collection", async t => {
  const { panel, deviceApps, opened, closed, refresh, setFailure } = fixture(t);
  deviceApps.selectDevice(ios);
  panel.setAvailable(true);
  panel.show();
  deviceApps.setAvailable(true);
  await refresh(first);
  await refresh(null);
  const absent = panel.list.getSnapshot();
  assert.equal(absent.query, "");
  await refresh(second);
  setFailure(true);
  await refresh(second);
  const failed = panel.list.getSnapshot();
  const state = panel.getSnapshot();
  assert.equal(failed.query, "");
  assert.match(state.appDiscoveryError, /discovery failure/);
  setFailure(false);
  await refresh(first);
  const recovered = panel.list.getSnapshot();
  assert.equal(recovered.query, 'app:"com.example.first"');
  assert.equal(opened.length, 1);
  assert.deepEqual(closed, []);
});

test("pause and hidden views retain collection lifecycle and defer query work", async t => {
  const { panel, deviceApps, opened, refresh } = fixture(t);
  deviceApps.selectDevice(ios);
  panel.setAvailable(true);
  panel.show();
  deviceApps.setAvailable(true);
  await refresh(first);
  panel.togglePause();
  await refresh(second);
  assert.equal(opened.length, 1);
  const paused = panel.list.getSnapshot();
  assert.equal(paused.query, 'app:"com.example.second"');
  panel.togglePause();
  await setImmediate();
  assert.equal(opened.length, 2);
  panel.list.append([{ ...record, pid: 456 }], 0);
  panel.hide();
  const cached = panel.list.getSnapshot();
  await refresh(first);
  const hidden = panel.list.getSnapshot();
  assert.equal(hidden, cached);
  panel.show();
  await setImmediate();
  const shown = panel.list.getSnapshot();
  assert.equal(shown.query, 'app:"com.example.first"');
  assert.equal(shown.buffered, 1);
  assert.equal(opened.length, 2);
});

test("system-noise settings still reopen the collector independently of the app query", async t => {
  const { panel, deviceApps, opened, closed, refresh } = fixture(t);
  deviceApps.selectDevice(ios);
  panel.setAvailable(true);
  panel.show();
  deviceApps.setAvailable(true);
  await refresh(first);
  panel.configure({ hideSystemLogs: false });
  await setImmediate();
  assert.deepEqual(closed, ["session-1"]);
  assert.deepEqual(opened[1], { native: { platform: "ios", deviceId: UDID, hideSystemLogs: false } });
  const snapshot = panel.list.getSnapshot();
  assert.equal(snapshot.query, 'app:"com.example.first"');
});

test("an explicit Metro source remains connected while the visible app query filters its records", async t => {
  const { panel, deviceApps, opened, refresh, setTargets } = fixture(t);
  deviceApps.selectDevice(ios);
  panel.setAvailable(true);
  panel.show();
  deviceApps.setAvailable(true);
  await refresh(first);
  setTargets([{ id: "metro-1", appId: "com.example.first", title: "First" }]);
  await panel.discover();
  panel.configure({ target: "metro-1" });
  await setImmediate();
  const before = opened.length;
  await refresh(second);
  const options = opened.at(-1);
  assert.deepEqual(options?.metro, { url: "http://127.0.0.1:8081", targetId: "metro-1" });
  assert.equal(opened.length, before);
  panel.list.append([{ ...record, origin: "metro", source: "js", appId: "com.example.first" }], 0);
  const filtered = panel.list.getSnapshot();
  assert.equal(filtered.filtered.length, 0);
  panel.search("");
  const all = panel.list.getSnapshot();
  assert.equal(all.filtered.length, 1);
});
