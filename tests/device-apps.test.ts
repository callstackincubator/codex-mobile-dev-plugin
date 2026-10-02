import test from "node:test";
import assert from "node:assert/strict";
import type { App } from "@modelcontextprotocol/ext-apps";
import type { DeviceApps } from "../src/shared/device-apps.ts";
import { DeviceAppsStore } from "../src/ui/device-apps.ts";
import { AppVisibility } from "./device-apps-fixtures.ts";
import { UDID, OTHER_UDID } from "./fixtures.ts";

const device = { udid: UDID, name: "iPhone", state: "Booted", runtime: "iOS" };
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
