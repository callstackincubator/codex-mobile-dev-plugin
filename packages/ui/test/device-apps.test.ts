import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import type { App } from "@modelcontextprotocol/ext-apps";
import type { DeviceApps } from "@mobile-dev/shared/device-apps.ts";
import { DeviceAppsStore } from "../src/device-apps.ts";
import { AppVisibility } from "@mobile-dev/test-support/device-apps-fixtures.ts";
import { UDID, OTHER_UDID } from "@mobile-dev/test-support/fixtures.ts";
import { DEVICE_APPS_DIAGNOSTIC_META } from "@mobile-dev/shared/device-apps-diagnostics.ts";
import { runBundle } from "@mobile-dev/test-support/bundle.ts";

const device = { udid: UDID, name: "iPhone", state: "Booted", runtime: "iOS", platform: "ios", kind: "simulator" } as const;
const first: DeviceApps = { apps: [{ bundleId: "app.a", pid: 1, foreground: true }], foregroundApp: { bundleId: "app.a", pid: 1 } };
const second: DeviceApps = { apps: [{ bundleId: "app.a", pid: 1, foreground: false }, { bundleId: "app.b", pid: 2, foreground: true }], foregroundApp: { bundleId: "app.b", pid: 2 } };

function fixture() {
  const requests: { deviceId: unknown; signal: AbortSignal; resolve: (data: unknown) => void; reject: (error: Error) => void }[] = [];
  const app = {
    callServerTool(input: { arguments: { deviceId: string } }, options: { signal: AbortSignal }) {
      return new Promise((resolve, reject) => {
        requests.push({ deviceId: input.arguments.deviceId, signal: options.signal, reject,
          resolve: data => resolve({ content: [], structuredContent: data }) });
      });
    },
  };
  const visibility = new AppVisibility();
  const store = new DeviceAppsStore(app as unknown as App, visibility);
  return { requests, visibility, store };
}

test("subscribers share one poll and observe foreground changes before performance is opened", async t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { store, requests } = fixture();
  t.after(() => store.dispose());
  const observed: (DeviceApps["foregroundApp"])[] = [];
  const unsubscribe = store.subscribe(() => {
    const snapshot = store.getSnapshot();
    if (snapshot.ready && snapshot.discovering === false) observed.push(snapshot.foregroundApp);
  });
  let secondSubscriber = 0;
  store.subscribe(() => { secondSubscriber++; });
  store.selectDevice(device);
  store.setAvailable(true);
  const initial = store.refresh();
  assert.equal(requests.length, 1);
  requests[0].resolve(first);
  await initial;
  const snapshot1 = store.getSnapshot();
  assert.deepEqual(snapshot1.foregroundApp, first.foregroundApp);
  t.mock.timers.tick(3000);
  assert.equal(requests.length, 2);
  const next = store.refresh();
  requests[1].resolve(second);
  await next;
  assert.deepEqual(observed, [first.foregroundApp, second.foregroundApp]);
  assert.ok(secondSubscriber > 0);
  unsubscribe();
  const cleared = store.refresh();
  requests[2].resolve({ apps: [], foregroundApp: null });
  await cleared;
  assert.deepEqual(observed, [first.foregroundApp, second.foregroundApp]);
  const snapshot2 = store.getSnapshot();
  assert.equal(snapshot2.foregroundApp, null);
});

test("switching devices cancels discovery and ignores late successes and failures", async t => {
  const { store, requests } = fixture();
  t.after(() => store.dispose());
  store.selectDevice(device);
  store.setAvailable(true);
  const old = store.refresh();
  store.selectDevice({ ...device, udid: OTHER_UDID });
  assert.equal(requests[0].signal.aborted, true);
  const snapshot3 = store.getSnapshot();
  assert.equal(snapshot3.foregroundApp, null);
  const current = store.refresh();
  requests[1].resolve(second);
  await current;
  requests[0].resolve(first);
  await old;
  const snapshot4 = store.getSnapshot();
  assert.deepEqual(snapshot4.foregroundApp, second.foregroundApp);
  const stale = store.refresh();
  store.selectDevice(device);
  requests[2].reject(new Error("Late transport failure"));
  await stale;
  const snapshot5 = store.getSnapshot();
  assert.equal(snapshot5.error, "");
  const snapshot6 = store.getSnapshot();
  assert.equal(snapshot6.device?.udid, UDID);
});

test("hidden panels pause polling, invalidate foreground state, and resume with a fresh query", async t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { store, requests, visibility } = fixture();
  t.after(() => store.dispose());
  store.selectDevice(device);
  store.setAvailable(true);
  const initial = store.refresh();
  requests[0].resolve(first);
  await initial;
  const pending = store.refresh();
  visibility.hide();
  assert.equal(requests[1].signal.aborted, true);
  const snapshot7 = store.getSnapshot();
  assert.equal(snapshot7.ready, false);
  const snapshot8 = store.getSnapshot();
  assert.equal(snapshot8.foregroundApp, null);
  t.mock.timers.tick(9000);
  assert.equal(requests.length, 2);
  requests[1].resolve(second);
  await pending;
  visibility.show();
  assert.equal(requests.length, 3);
  const resumed = store.refresh();
  requests[2].resolve(second);
  await resumed;
  const snapshot9 = store.getSnapshot();
  assert.deepEqual(snapshot9.foregroundApp, second.foregroundApp);
});

test("disconnect and disposal clear data, cancel work, and remove visibility polling", async t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { store, requests, visibility } = fixture();
  store.selectDevice(device);
  store.setAvailable(true);
  const pending = store.refresh();
  store.selectDevice({ ...device, state: "Shutdown" });
  requests[0].resolve(first);
  await pending;
  t.mock.timers.tick(3000);
  assert.equal(requests.length, 1);
  store.selectDevice(device);
  const active = store.refresh();
  store.setAvailable(false);
  requests[1].resolve(first);
  await active;
  const snapshot10 = store.getSnapshot();
  assert.equal(snapshot10.ready, false);
  store.setAvailable(true);
  const disposing = store.refresh();
  store.dispose();
  requests[2].resolve(first);
  await disposing;
  visibility.hide();
  visibility.show();
  t.mock.timers.tick(9000);
  assert.equal(requests.length, 3);
  const snapshot11 = store.getSnapshot();
  assert.equal(snapshot11.foregroundApp, null);
});

test("discovery failures invalidate foreground state and malformed responses cannot become ready", async t => {
  const { store, requests } = fixture();
  t.after(() => store.dispose());
  store.selectDevice(device);
  store.setAvailable(true);
  const initial = store.refresh();
  requests[0].resolve(first);
  await initial;
  const failed = store.refresh();
  requests[1].reject(new Error("Device disconnected"));
  await failed;
  const snapshot12 = store.getSnapshot();
  assert.equal(snapshot12.error, "Device disconnected");
  const snapshot13 = store.getSnapshot();
  assert.equal(snapshot13.ready, false);
  const snapshot14 = store.getSnapshot();
  assert.equal(snapshot14.foregroundApp, null);
  const malformed = store.refresh();
  requests[2].resolve({ apps: first.apps });
  await malformed;
  const snapshot15 = store.getSnapshot();
  assert.equal(snapshot15.ready, false);
  const recovered = store.refresh();
  requests[3].resolve(second);
  await recovered;
  const snapshot16 = store.getSnapshot();
  assert.equal(snapshot16.error, "");
  const snapshot17 = store.getSnapshot();
  assert.deepEqual(snapshot17.foregroundApp, second.foregroundApp);
});

test("panels on one device share an installed-apps listing in flight and keep their own picks", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let listings = 0;
  const app = {
    async callServerTool({ name, arguments: args }: { name: string; arguments: Record<string, unknown> }) {
      assert.equal(name, "mobile_list_apps");
      assert.deepEqual(args, { platform: "ios", deviceId: UDID });
      listings++;
      await gate;
      return { content: [], structuredContent: { apps: [{ bundleId: "app.a", name: "A" }], foregroundBundleId: null, runningBundleIds: ["app.a"] } };
    },
  };
  const store = new DeviceAppsStore(app as unknown as App, new AppVisibility());
  const target = { platform: "ios", deviceId: UDID } as const;
  const storage = store.installedApps(target);
  const tools = store.installedApps(target);
  assert.equal(listings, 1);
  release();
  assert.deepEqual(await storage, await tools);
  await store.installedApps(target);
  assert.equal(listings, 2, "A later request lists the device again, so newly installed apps appear.");
  store.pickApp("storage", target, "app.a");
  assert.equal(store.pickedApp("storage", target), "app.a");
  assert.equal(store.pickedApp("performance", target), undefined, "Each panel keeps its own pick.");
  assert.equal(store.pickedApp("storage", { platform: "ios", deviceId: OTHER_UDID }), undefined);
  store.dispose();
});

test("UI discovery leaves server errors with the server and reports transport and malformed responses", async t => {
  const root = process.cwd();
  const built = await build({ stdin: { contents: 'export * from "./packages/ui/src/telemetry.ts"; export { DeviceAppsStore } from "./packages/ui/src/device-apps.ts";', resolveDir: root, loader: "ts" },
    bundle: true, write: false, format: "iife", globalName: "Telemetry", platform: "browser", target: "chrome120",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const html = '<html><head><meta name="mobile-dev-environment" content="development"><meta name="mobile-dev-user-id" content="anon_0123456789abcdef0123456789abcdef"><meta name="mobile-dev-session-id" content="run_1234567890abcdef1234567890abcdef"></head></html>';
  const dom = new JSDOM(html, { pretendToBeVisual: true, runScripts: "outside-only", url: "https://mobile-dev.test/" });
  t.after(() => dom.window.close());
  dom.window.Math.random = () => 0;
  const bodies: string[] = [];
  dom.window.fetch = async (_url, options) => { const body = String(options?.body ?? ""); bodies.push(body); return new Response("", { status: 200 }); };
  Object.defineProperty(dom.window.performance, "getEntriesByType", { value: () => [] });
  Object.defineProperty(dom.window.performance, "getEntries", { value: () => [] });
  runBundle(dom.window, built.outputFiles[0].text);
  const api = dom.window.Telemetry;
  let resolve: (result: unknown) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const app = { callServerTool() { return new Promise((accept, fail) => { resolve = accept; reject = fail; }); } };
  api.startUiTelemetry(app);
  api.setUiSurface("logs");
  const store = new api.DeviceAppsStore(app, dom.window.document);
  store.selectDevice({ udid: "PRIVATE_DEVICE", name: "PRIVATE_NAME", state: "connected", runtime: "iOS", platform: "ios", kind: "physical" });
  store.setAvailable(true);
  let pending = store.refresh();
  resolve({ isError: true, content: [{ type: "text", text: "PRIVATE_COMMAND PRIVATE_OUTPUT" }],
    _meta: { [DEVICE_APPS_DIAGNOSTIC_META]: { stage: "foreground", failure: "command_failed", platform: "ios", kind: "physical" } } });
  await pending;
  const snapshot = store.getSnapshot();
  assert.equal(snapshot.error, "PRIVATE_COMMAND PRIVATE_OUTPUT");
  pending = store.refresh();
  resolve({ isError: true, content: [{ type: "text", text: "PRIVATE_OUTPUT" }],
    _meta: { [DEVICE_APPS_DIAGNOSTIC_META]: { stage: "PRIVATE_STAGE", failure: "PRIVATE_FAILURE", platform: "ios", kind: "physical" } } });
  await pending;
  pending = store.refresh();
  const timeout = new dom.window.Error("PRIVATE_TRANSPORT");
  timeout.name = "TimeoutError";
  reject(timeout);
  await pending;
  pending = store.refresh();
  reject(timeout);
  await pending;
  pending = store.refresh();
  resolve({ content: [], structuredContent: { apps: [], foregroundApp: null } });
  await pending;
  pending = store.refresh();
  const recoveredTimeout = new dom.window.Error("PRIVATE_TRANSPORT");
  recoveredTimeout.name = "TimeoutError";
  reject(recoveredTimeout);
  await pending;
  pending = store.refresh();
  resolve({ content: [], structuredContent: { apps: "PRIVATE_RESPONSE" } });
  await pending;
  pending = store.refresh();
  resolve({ isError: true, content: [{ type: "text", text: "PRIVATE_CANCELLED" }],
    _meta: { [DEVICE_APPS_DIAGNOSTIC_META]: { stage: "foreground", failure: "cancelled", platform: "ios", kind: "physical" } } });
  await pending;
  pending = store.refresh();
  store.dispose();
  const cancelled = new dom.window.Error("PRIVATE_CANCELLED");
  cancelled.name = "AbortError";
  reject(cancelled);
  await pending;
  await api.stopUiTelemetry();
  const captured = bodies.join("\n");
  const includesPrivate = captured.includes("PRIVATE");
  assert.equal(includesPrivate, false);
  const includesRepeated = captured.includes("ui.device_apps.discovery_repeated");
  assert.equal(includesRepeated, true);
  const events = bodies.flatMap(body => {
    const lines = body.split("\n");
    const items = [];
    for (let index = 1; index < lines.length - 1; index += 2) {
      const header = JSON.parse(lines[index]);
      if (header.type === "event") {
        const event = JSON.parse(lines[index + 1]);
        items.push(event);
      }
    }
    return items;
  });
  assert.equal(events.length, 2);
  const diagnosticTags = events.map(event => ({ stage: event.tags.discovery_stage, failure: event.tags.discovery_failure,
    platform: event.tags.device_platform, kind: event.tags.device_kind, surface: event.tags.surface }));
  assert.deepEqual(diagnosticTags, [
    { stage: "transport", failure: "timeout", platform: "ios", kind: "physical", surface: "logs" },
    { stage: "response", failure: "invalid_response", platform: "ios", kind: "physical", surface: "logs" },
  ]);
});
