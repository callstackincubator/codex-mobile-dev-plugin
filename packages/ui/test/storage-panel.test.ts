import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import type { App } from "@modelcontextprotocol/ext-apps";
import type { InstalledApp } from "../../shared/src/app-control.ts";
import type { PhysicalAndroidDevice } from "../../shared/src/android-devices.ts";
import { createDeviceApps } from "../../test-support/device-apps-fixtures.ts";
import { UDID } from "../../test-support/fixtures.ts";
import { StoragePanel } from "../src/storage-panel.ts";

const simulator = { udid: UDID, name: "iPhone", state: "Booted", runtime: "iOS", platform: "ios", kind: "simulator" } as const;
const installed = (bundleId: string): InstalledApp => ({ bundleId, name: bundleId });

// A device whose installed and running apps change between listings. Held listings wait until released.
function fixture(t: TestContext) {
  const device = { apps: [] as InstalledApp[], running: [] as string[], hold: false };
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
      return { content: [], structuredContent: { platform: "ios", bundleId: args.bundleId, readAt: Date.now(), stores: [], files: [], fileCount: 0, totalBytes: 0 } };
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
