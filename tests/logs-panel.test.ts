import test from "node:test";
import type { TestContext } from "node:test";
import { createDeviceApps } from "./device-apps-fixtures.ts";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import type { App } from "@modelcontextprotocol/ext-apps";
import type { PanelContext } from "../src/ui/model-context.ts";
import type { LogOptions, LogRecord } from "../src/shared/logs.ts";
import type { LogSink } from "../src/server/native-logs.ts";
import { LogSessions } from "../src/server/log-sessions.ts";
import { LogsPanel } from "../src/ui/logs-panel.ts";
import type { PhysicalIosDevice } from "../src/shared/ios-devices.ts";

function createPanel(app: App, t: TestContext) {
  const deviceApps = createDeviceApps(app);
  const panel = new LogsPanel(app, { canAttach: true } as PanelContext, deviceApps);
  panel.configure({ followApp: false });
  t.after(() => deviceApps.dispose());
  return { panel, deviceApps };
}

const device = { udid: "emulator-5554", name: "Pixel", state: "Booted", runtime: "Android", platform: "android" as const };
async function waitFor(predicate: () => boolean) {
  const end = Date.now() + 2000;
  while (!predicate()) { assert.ok(Date.now() < end); await new Promise(resolve => setTimeout(resolve, 5)); }
}

test("the selected connected iPhone opens physical logs and a disconnected phone opens none", async t => {
  const phone: PhysicalIosDevice = { udid: "00008110-000A0B1C2D3E4000", coreDeviceId: "11111111-1111-4111-8111-111111111111",
    name: "Test iPhone", model: "iPhone", productType: "iPhone18,1", runtime: "iOS 27.0", state: "connected", platform: "ios", kind: "physical",
    transportType: "localNetwork", pairingState: "paired" };
  const opened: LogOptions[] = [];
  const app = { async callServerTool(input: { name: string; arguments: { options?: LogOptions } }) {
    if (input.name === "mobile_logs_session") {
      assert.ok(input.arguments.options);
      opened.push(input.arguments.options);
    }
    return { content: [] };
  } } as unknown as App;
  const { panel, deviceApps } = createPanel(app, t);
  t.after(() => panel.dispose());
  panel.search("process:Example");
  deviceApps.selectDevice(phone);
  panel.setAvailable(true);
  panel.show();
  await waitFor(() => opened.length === 1);
  assert.deepEqual(opened[0], { native: { platform: "ios", kind: "physical", deviceId: phone.udid, hideSystemLogs: true } });
  deviceApps.selectDevice({ ...phone, state: "disconnected" });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(opened.length, 1);
  assert.equal(panel.getSnapshot().status, "Choose a source");
});

test("pausing closes a log session, and a late session cannot restore a closed panel", async t => {
  const calls: { name: string; arguments: Record<string, unknown> }[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const app = {
    async callServerTool(call: { name: string; arguments: Record<string, unknown> }) {
      calls.push(call);
      if (call.name === "mobile_logs_session") { await gate; return { content: [], _meta: { sessionId: "late", logsUri: "logs://mobile-dev/late" } }; }
      return { content: [] };
    },
    async readServerResource() { throw new Error("A late session must not read resources"); },
  } as unknown as App;
  const { panel, deviceApps } = createPanel(app, t);
  t.after(() => panel.dispose());
  deviceApps.selectDevice(device); panel.setAvailable(true); panel.show();
  await waitFor(() => calls.some(call => call.name === "mobile_logs_session"));
  assert.deepEqual(calls[0].arguments, { options: { native: { platform: "android", deviceId: device.udid } } });
  panel.togglePause(); assert.equal(panel.getSnapshot().status, "Paused");
  panel.toggle(); release();
  await waitFor(() => calls.some(call => call.name === "mobile_logs_close"));
  assert.equal(panel.getSnapshot().open, false);
  assert.equal(panel.getSnapshot().status, "Closed");
});

test("source discovery ignores results for an old Metro URL and preserves explicit none", async t => {
  let release!: () => void;
  let hold = true;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const app = { async callServerTool() {
    if (hold) await gate;
    return { content: [], structuredContent: { android: [{ id: device.udid, name: device.name }], metro: [{ id: "metro-1", title: "App" }], errors: [] } };
  } } as unknown as App;
  const { panel, deviceApps } = createPanel(app, t);
  t.after(() => panel.dispose()); panel.setAvailable(true); panel.configure({ native: "none" });
  const discovering = panel.discover();
  panel.configure({ metroUrl: "http://127.0.0.1:8082" }); release(); await discovering;
  assert.equal(panel.getSnapshot().metro.length, 0);
  assert.equal(panel.getSnapshot().discovering, false);
  hold = false; await panel.discover();
  assert.equal(panel.getSnapshot().native, "none");
  assert.equal(panel.getSnapshot().metro[0].id, "metro-1");
});

test("hiding logs leaves collection in the server and resumes the same cursor with cached UI state", async t => {
  let sink: LogSink | undefined;
  let opens = 0;
  let closes = 0;
  const reads: number[] = [];
  const logs = new LogSessions({ native: (_target, next) => {
    sink = next;
    return async () => { closes++; };
  }, metro: () => async () => {} });
  const app = {
    async callServerTool(input: { name: string; arguments: { options?: LogOptions; sessionId?: string } }) {
      if (input.name === "mobile_logs_session") {
        assert.ok(input.arguments.options);
        const id = logs.open(input.arguments.options);
        opens++;
        return { content: [], _meta: { sessionId: id, logsUri: `logs://mobile-dev/${id}/batch?after=0` } };
      }
      assert.ok(input.arguments.sessionId);
      if (input.name === "mobile_logs_keep_alive") logs.keepAlive(input.arguments.sessionId);
      else await logs.closeSession(input.arguments.sessionId);
      return { content: [] };
    },
    readServerResource(input: { uri: string }, options: { signal: AbortSignal }) {
      const uri = new URL(input.uri);
      const id = uri.pathname.split("/")[1];
      const after = Number(uri.searchParams.get("after"));
      reads.push(after);
      return new Promise((resolve, reject) => {
        const abort = () => reject(new Error("Read cancelled"));
        options.signal.addEventListener("abort", abort, { once: true });
        void logs.read(id, after).then(batch => {
          options.signal.removeEventListener("abort", abort);
          const text = JSON.stringify(batch);
          resolve({ contents: [{ uri: input.uri, mimeType: "application/json", text }] });
        }, error => {
          options.signal.removeEventListener("abort", abort);
          reject(error);
        });
        if (options.signal.aborted) abort();
      });
    },
  } as unknown as App;
  const { panel, deviceApps } = createPanel(app, t);
  t.after(async () => { await panel.dispose(); await logs.close(); });
  deviceApps.selectDevice(device);
  panel.setAvailable(true);
  panel.show();
  await waitFor(() => sink !== undefined);
  const record: LogRecord = { timestamp: "2026-09-30T12:00:00Z", source: "native", origin: "android", level: "info", message: "First message" };
  sink!.log(record);
  await waitFor(() => panel.list.getSnapshot().buffered === 1);
  panel.list.search("message");
  panel.list.select(1);
  panel.list.setFollow(false);
  panel.list.scrollOffset = 145;
  const cached = panel.list.getSnapshot();
  panel.hide();
  const hiddenReads = reads.length;
  sink!.log({ ...record, message: "Second message" });
  sink!.log({ ...record, message: "Third message" });
  await new Promise(resolve => setTimeout(resolve, 110));
  assert.equal(reads.length, hiddenReads, "The hidden UI does not poll or process log batches.");
  assert.equal(panel.list.getSnapshot(), cached);
  assert.equal(panel.list.scrollOffset, 145);
  assert.equal(opens, 1);
  assert.equal(closes, 0);

  panel.show();
  assert.equal(panel.list.getSnapshot(), cached, "Existing rows are available before catching up.");
  await waitFor(() => panel.list.getSnapshot().buffered === 3);
  assert.equal(opens, 1, "Returning to Logs reuses the collector.");
  assert.equal(reads[hiddenReads], 1, "Catch-up starts after the last displayed log.");
  assert.equal(panel.list.getSnapshot().query, "message");
  assert.equal(panel.list.getSnapshot().selected?.sequence, 1);
  assert.deepEqual(panel.list.getSnapshot().filtered.map(log => log.message), ["First message", "Second message", "Third message"]);
  await panel.dispose();
  assert.equal(closes, 1);
});

test("a hidden log panel sends only keep-alives and cancels its hidden timer on teardown", async t => {
  const calls: string[] = [];
  let reads = 0;
  const app = {
    async callServerTool(input: { name: string }) {
      calls.push(input.name);
      return { content: [], _meta: { sessionId: "session", logsUri: "logs://mobile-dev/session/batch?after=0" } };
    },
    readServerResource(_input: unknown, options: { signal: AbortSignal }) {
      reads++;
      return new Promise((_, reject) => {
        options.signal.addEventListener("abort", () => reject(new Error("Read cancelled")), { once: true });
      });
    },
  } as unknown as App;
  const { panel, deviceApps } = createPanel(app, t);
  t.after(() => panel.dispose());
  deviceApps.selectDevice(device);
  panel.setAvailable(true);
  panel.show();
  await setImmediate();
  assert.equal(reads, 1);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  panel.hide();
  await setImmediate();
  t.mock.timers.tick(60000);
  await setImmediate();
  assert.deepEqual(calls, ["mobile_logs_session", "mobile_logs_keep_alive"]);
  assert.equal(reads, 1);
  panel.show();
  await setImmediate();
  assert.equal(reads, 2);
  panel.hide();
  await setImmediate();
  await panel.dispose();
  t.mock.timers.tick(120000);
  await setImmediate();
  assert.deepEqual(calls, ["mobile_logs_session", "mobile_logs_keep_alive", "mobile_logs_close"]);
});
