import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import type { App } from "@modelcontextprotocol/ext-apps";
import type { InstalledApp } from "@mobile-dev/shared/app-control.ts";
import type { PhysicalAndroidDevice } from "@mobile-dev/shared/android-devices.ts";
import { createDeviceApps } from "@mobile-dev/test-support/device-apps-fixtures.ts";
import { UDID } from "@mobile-dev/test-support/fixtures.ts";
import { storageSnapshotSchema } from "@mobile-dev/shared/app-storage.ts";
import type { StorageStore } from "@mobile-dev/shared/app-storage.ts";
import { diffSnapshots, shownChanges, StoragePanel } from "../src/storage-panel.ts";
import { bytesAsText, changedFields, isSdkStore, storeTitle } from "../src/storage-labels.ts";

const simulator = { udid: UDID, name: "iPhone", state: "Booted", runtime: "iOS", platform: "ios", kind: "simulator" } as const;
const installed = (bundleId: string): InstalledApp => ({ bundleId, name: bundleId });

// A device whose installed and running apps change between listings. Held listings wait until released.
function fixture(t: TestContext) {
  const device = { apps: [] as InstalledApp[], running: [] as string[], stores: [] as StorageStore[], hold: false };
  const held: (() => void)[] = [];
  const calls: { name: string; bundleId?: unknown }[] = [];
  const app = {
    async callServerTool({ name, arguments: args }: { name: string; arguments: Record<string, unknown> }) {
      calls.push({ name, bundleId: args.bundleId });
      if (name === "mobile_list_apps") {
        const data = { apps: [...device.apps], foregroundBundleId: null, runningBundleIds: [...device.running] };
        if (!device.hold) return { content: [], structuredContent: data };
        await new Promise<void>(resolve => held.push(resolve));
        return { isError: true, content: [{ type: "text", text: "Unable to lookup in current state: Shutdown" }] };
      }
      if (name === "mobile_app_icons") return { content: [], structuredContent: { apps: {} } };
      return { content: [], structuredContent: { platform: "ios", bundleId: args.bundleId, readAt: Date.now(), stores: device.stores, files: [], fileCount: 0, totalBytes: 0 } };
    },
  };
  const deviceApps = createDeviceApps(app as unknown as App);
  const panel = new StoragePanel(app as unknown as App, deviceApps);
  t.after(() => { panel.dispose(); deviceApps.dispose(); });
  panel.setAvailable(true);
  return {
    device, deviceApps, panel,
    listings: () => calls.filter(call => call.name === "mobile_list_apps").length,
    reads: () => calls.filter(call => call.name === "mobile_app_storage").map(call => call.bundleId),
    apps: () => panel.getSnapshot().apps.map(app => app.bundleId),
    release: () => { for (const resolve of held.splice(0)) resolve(); },
  };
}

test("Storage lists apps when the open panel's simulator boots, and again after a restart, keeping the picked app", async t => {
  const { device, deviceApps, panel, listings, reads, apps } = fixture(t);
  device.apps = [installed("com.example.a"), installed("com.example.b")];
  device.running = ["com.example.a"];
  deviceApps.selectDevice({ ...simulator, state: "Shutdown" });
  panel.show();
  await setImmediate();
  assert.equal(panel.getSnapshot().unsupported, "iPhone isn't running.");
  assert.equal(listings(), 0);

  deviceApps.selectDevice(simulator);
  await setImmediate();
  assert.equal(panel.getSnapshot().unsupported, "");
  assert.equal(listings(), 1);
  assert.deepEqual(apps(), ["com.example.a", "com.example.b"]);
  assert.equal(panel.getSnapshot().snapshot?.bundleId, "com.example.a", "The running app is picked and read.");

  panel.selectApp("com.example.b");
  await setImmediate();
  deviceApps.selectDevice({ ...simulator, state: "Shutdown" });
  assert.equal(panel.getSnapshot().snapshot, undefined, "A stopped device's data is not kept as current.");
  deviceApps.selectDevice(simulator);
  await setImmediate();
  assert.equal(listings(), 2);
  assert.equal(panel.getSnapshot().bundleId, "com.example.b");
  assert.deepEqual(reads(), ["com.example.a", "com.example.b", "com.example.b"]);
});

test("Storage lists apps again when the open panel's Android device reconnects", async t => {
  const { device, deviceApps, panel, listings, apps } = fixture(t);
  const phone: PhysicalAndroidDevice = { udid: "R5CT1234567", name: "Pixel", state: "Booted", runtime: "Android 16", platform: "android", kind: "physical", transportType: "wired" };
  deviceApps.selectDevice(phone);
  panel.show();
  await setImmediate();
  assert.equal(listings(), 1);
  deviceApps.selectDevice({ ...phone, state: "offline" });
  device.apps = [installed("com.example.new")];
  deviceApps.selectDevice(phone);
  await setImmediate();
  assert.equal(listings(), 2);
  assert.deepEqual(apps(), ["com.example.new"]);
});

test("reopening Storage and Refresh list newly installed apps and keep the selection while it is installed", async t => {
  const { device, deviceApps, panel, listings, reads, apps } = fixture(t);
  deviceApps.selectDevice(simulator);
  panel.show();
  await setImmediate();
  assert.equal(listings(), 1);
  assert.deepEqual(apps(), []);

  device.apps = [installed("com.example.new")];
  deviceApps.selectDevice({ ...simulator });
  panel.hide();
  panel.show();
  await setImmediate();
  assert.equal(listings(), 2);
  assert.deepEqual(apps(), ["com.example.new"]);
  panel.selectApp("com.example.new");
  await setImmediate();

  device.apps.push(installed("com.example.other"));
  await panel.reload();
  await setImmediate();
  assert.equal(listings(), 3);
  assert.deepEqual(apps(), ["com.example.new", "com.example.other"]);
  assert.equal(panel.getSnapshot().bundleId, "com.example.new");
  assert.deepEqual(reads(), ["com.example.new", "com.example.new"], "Refresh also reads the selected app again.");

  device.apps = [installed("com.example.other")];
  await panel.reload();
  await setImmediate();
  assert.equal(panel.getSnapshot().bundleId, "", "An uninstalled app is no longer selected.");
  assert.equal(panel.getSnapshot().snapshot, undefined);
  assert.equal(panel.getSnapshot().busy, null);
});

test("Storage shares a listing in flight and drops one that finishes after its device stopped", async t => {
  const { device, deviceApps, panel, listings, apps, release } = fixture(t);
  device.hold = true;
  deviceApps.selectDevice(simulator);
  panel.show();
  panel.hide();
  panel.show();
  void panel.reload();
  assert.equal(listings(), 1);
  assert.equal(panel.getSnapshot().busy, "apps");

  deviceApps.selectDevice({ ...simulator, state: "Shutdown" });
  release();
  await setImmediate();
  assert.equal(panel.getSnapshot().error, "", "The stopped device's late failure is not shown.");

  device.hold = false;
  device.apps = [installed("com.example.a")];
  deviceApps.selectDevice(simulator);
  await setImmediate();
  assert.equal(listings(), 2);
  assert.deepEqual(apps(), ["com.example.a"]);
  assert.equal(panel.getSnapshot().busy, null);
});

test("the change feed records keys added, changed, and removed between reads, and labels SDK stores", () => {
  const snapshot = (readAt: number, entries: [string, string][], entryCount = entries.length) => storageSnapshotSchema.parse({ platform: "ios", bundleId: "com.example", readAt, files: [], fileCount: 0, totalBytes: 0,
    stores: [{ id: "mmkv:a", kind: "mmkv", name: "a", path: "a", status: "ok", bytes: 0, entryCount, entries: entries.map(([key, value]) => ({ key, type: "string", value, bytes: value.length })) }] });
  const first = snapshot(1, [["kept", "1"], ["edited", "1"], ["dropped", "x"]]);
  const events = diffSnapshots(first, snapshot(2, [["kept", "1"], ["edited", "2"], ["added", "x"]]));
  assert.deepEqual(events.map(event => [event.key, event.change, event.before?.value, event.after?.value, event.at]), [
    ["edited", "changed", "1", "2", 2], ["added", "added", undefined, "x", 2], ["dropped", "removed", "x", undefined, 2],
  ]);
  // A capped read is not evidence that keys past the cap were removed.
  assert.deepEqual(diffSnapshots(first, snapshot(3, [["kept", "1"]], 3)).map(event => event.change), []);
  assert.deepEqual(changedFields({ user: "ada", count: 1 }, { user: "ada", count: 2 }), [{ path: "count", before: "1", after: "2" }]);
  assert.equal(changedFields("a", "b"), undefined);
  assert.equal(bytesAsText({ key: "k", type: "data", value: Buffer.from("[1,2]").toString("hex"), bytes: 5 }), "[1,2]");
  assert.equal(bytesAsText({ key: "k", type: "data", value: "ff00", bytes: 2 }), undefined);
  assert.equal(isSdkStore({ name: "com.google.gmp.measurement.monitor", path: "Library/Preferences/com.google.gmp.measurement.monitor.plist" }), true);
  assert.equal(isSdkStore({ name: "com.example", path: "Library/Preferences/com.example.plist" }), false);
  assert.equal(storeTitle({ kind: "user-defaults", name: "com.example" }, "com.example"), "Standard defaults");
});

test("the change feed hides SDK changes until the toggle shows them", async t => {
  const { device, deviceApps, panel } = fixture(t);
  const store = (name: string, path: string, key: string): StorageStore => ({ id: `user-defaults:${path}`, kind: "user-defaults", name, path, status: "ok", bytes: 1, entryCount: 1, entries: [{ key, type: "string", value: "1", bytes: 1 }] });
  device.apps = [installed("com.example")];
  device.running = ["com.example"];
  deviceApps.selectDevice(simulator);
  panel.show();
  await setImmediate();
  assert.equal(panel.getSnapshot().snapshot?.bundleId, "com.example");
  device.stores = [store("com.example", "Library/Preferences/com.example.plist", "onboarded"), store("com.google.gmp.measurement.monitor", "Library/Preferences/com.google.gmp.measurement.monitor.plist", "firebase")];
  await panel.refresh();
  assert.deepEqual(shownChanges(panel.getSnapshot()).map(event => event.key), ["onboarded"]);
  panel.setShowSdkChanges(true);
  assert.deepEqual(shownChanges(panel.getSnapshot()).map(event => event.key), ["firebase", "onboarded"]);
});

test("a slower earlier table page never replaces the page opened after it", async () => {
  const pending: { offset: number; resolve: (result: unknown) => void }[] = [];
  const app = { callServerTool: ({ arguments: args }: { arguments: { offset: number } }) => new Promise(resolve => pending.push({ offset: args.offset, resolve })) };
  // The app picked on this simulator earlier is selected without reading its storage.
  const panel = new StoragePanel(app as never, { subscribe: () => () => {}, getSnapshot: () => ({ device: simulator }), pickedApp: () => "dev.example", pickApp() {} } as never);
  panel.setAvailable(true);
  const page = (offset: number) => ({ structuredContent: { table: "items", columns: [{ name: "id", type: "INTEGER" }], rows: [[offset + 1]], total: 300, offset } });
  const first = panel.openTable("sqlite:app.db", "items", 0);
  const second = panel.openTable("sqlite:app.db", "items", 100);
  pending.find(call => call.offset === 100)!.resolve(page(100));
  await second;
  pending.find(call => call.offset === 0)!.resolve(page(0));
  await first;
  const detail = panel.getSnapshot().detail;
  assert.equal(detail?.kind === "table" ? detail.data?.offset : undefined, 100);
  panel.dispose();
});
