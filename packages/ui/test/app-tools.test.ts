import test from "node:test";
import assert from "node:assert/strict";
import { AppToolsStore } from "../src/app-tools.ts";

test("the app tools store follows the foreground app and keeps the last app after it exits", async () => {
  const store = new AppToolsStore();
  let foreground: string | null = "com.acme.shop";
  const calls: string[] = [];
  store.call = async (name, args) => {
    calls.push(name);
    if (name === "mobile_list_apps") return { apps: [{ bundleId: "com.acme.shop", name: "Shop" }, { bundleId: "dev.other", name: "Other" }], foregroundBundleId: foreground, runningBundleIds: foreground ? [foreground] : [] };
    if (name === "mobile_app_permissions") return { permissions: [{ permission: "camera", state: args.bundleId === "dev.other" ? "allow" : "ask" }] };
    if (name === "mobile_stop_app") throw new Error("Stopping the app failed: busy");
    return {};
  };
  store.configure("android", "emulator-5554", false);
  await store.load();
  assert.equal(store.getSnapshot().bundleId, "com.acme.shop");
  store.select("dev.other");
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(store.getSnapshot().permissions, [{ permission: "camera", state: "allow" }]);
  foreground = null;
  await store.load();
  assert.equal(store.getSnapshot().bundleId, "dev.other", "without a foreground app the panel keeps the last selection");
  await store.stop();
  assert.equal(store.getSnapshot().error, "Stopping the app failed: busy");
  assert.equal(store.getSnapshot().busy, null);
  const beforeOpen = calls.length;
  await store.open("com.acme.shop");
  assert.ok(calls.slice(beforeOpen).includes("mobile_launch_app"), "picking an app launches it");
  assert.equal(store.getSnapshot().runningBundleIds[0], "com.acme.shop", "a launched app is marked running");
  store.configure("android", "emulator-5556", false);
  assert.deepEqual([store.getSnapshot().bundleId, store.getSnapshot().apps], [null, []]);
  store.configure("android", "emulator-5556", true);
  const before = calls.length;
  await store.launch();
  await store.load();
  assert.equal(calls.length, before, "disabled devices do not call tools");
});

test("the app tools store merges icons and Android labels once per device", async () => {
  const store = new AppToolsStore();
  const requests: unknown[] = [];
  store.call = async (name, args) => {
    if (name === "mobile_list_apps") return { apps: [{ bundleId: "com.acme", name: "com.acme" }, { bundleId: "dev.other", name: "dev.other" }], foregroundBundleId: null, runningBundleIds: [] };
    if (name === "mobile_app_icons") { requests.push(args.bundleIds); return { apps: { "com.acme": { name: "Acme Shop", icon: "data:image/png;base64,AAAA" } } }; }
    return {};
  };
  store.configure("android", "emulator-5554", false);
  await store.load();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(store.getSnapshot().apps.map(app => app.icon), ["data:image/png;base64,AAAA", undefined]);
  assert.deepEqual(store.getSnapshot().apps.map(app => app.name), ["Acme Shop", "dev.other"]);
  await store.load();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(requests, [["com.acme", "dev.other"]], "reopening the panel does not refetch icons");
  assert.equal(store.getSnapshot().apps[0].name, "Acme Shop", "labels survive a fresh app list");
});

test("without a foreground app the picker opens on the newest running app, keeps content while switching, and remembers picks", async () => {
  const storage = new Map<string, string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) } });
  try {
    let running = ["dev.recent"];
    let finishPermissions!: () => void;
    const store = new AppToolsStore();
    store.call = async (name, args) => {
      if (name === "mobile_list_apps") return { apps: [{ bundleId: "a.first", name: "A" }, { bundleId: "dev.recent", name: "Recent" }, { bundleId: "z.last", name: "Z" }], foregroundBundleId: null, runningBundleIds: running };
      if (name === "mobile_app_permissions") {
        if (args.bundleId === "z.last") await new Promise<void>(resolve => { finishPermissions = resolve; });
        return { permissions: [{ permission: "location", state: args.bundleId === "z.last" ? "deny" : "allow" }] };
      }
      if (name === "mobile_app_links") return { links: [`${String(args.bundleId).split(".")[1]}://`] };
      return {};
    };
    store.configure("android", "emulator-5554", false);
    await store.load();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(store.getSnapshot().bundleId, "dev.recent");
    assert.deepEqual(store.getSnapshot().links, ["recent://"]);
    store.select("z.last");
    assert.deepEqual(store.getSnapshot().permissions, [{ permission: "location", state: null }], "rows stay while the new app loads");
    assert.deepEqual(store.getSnapshot().links, ["recent://"], "suggestions stay until the new ones arrive");
    finishPermissions();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(store.getSnapshot().permissions, [{ permission: "location", state: "deny" }]);
    assert.deepEqual(store.getSnapshot().links, ["last://"]);
    running = [];
    const reopened = new AppToolsStore();
    reopened.call = store.call;
    reopened.configure("android", "emulator-5554", false);
    await reopened.load();
    assert.equal(reopened.getSnapshot().bundleId, "z.last", "a new panel returns to the last picked app");
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("a permission change that lands after a device switch leaves the new device's rows alone", async () => {
  const store = new AppToolsStore();
  let finish: (value: unknown) => void = () => undefined;
  store.call = async (name, args) => {
    if (name === "mobile_list_apps") return { apps: [{ bundleId: "com.acme", name: "Acme" }], foregroundBundleId: "com.acme", runningBundleIds: ["com.acme"] };
    if (name === "mobile_app_permissions") return { permissions: [{ permission: "photos", state: null }] };
    if (name === "mobile_set_app_permission") return new Promise(resolve => { finish = resolve; });
    return {};
  };
  store.configure("ios", "A", false);
  await store.load();
  const change = store.setPermission("photos", "deny");
  store.configure("ios", "B", false);
  await store.load();
  await new Promise(resolve => setImmediate(resolve));
  finish({ permissions: [{ permission: "photos", state: null }] });
  await change;
  await store.load();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(store.getSnapshot().permissions, [{ permission: "photos", state: null }]);
});

test("icons for devices with many apps are requested in batches the server accepts", async () => {
  const store = new AppToolsStore();
  const batches: number[] = [];
  const apps = Array.from({ length: 450 }, (_, index) => ({ bundleId: `com.app${index}`, name: `App ${index}` }));
  store.call = async (name, args) => {
    if (name === "mobile_list_apps") return { apps, foregroundBundleId: null, runningBundleIds: [] };
    if (name === "mobile_app_icons") { batches.push((args.bundleIds as string[]).length); return { apps: {} }; }
    if (name === "mobile_app_permissions") return { permissions: [] };
    return {};
  };
  store.configure("android", "emulator-5554", false);
  await store.load();
  for (let wait = 0; wait < 10 && batches.length < 3; wait++) await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(batches, [200, 200, 50]);
});

test("the shared icon cache fetches each app once per device across panels and retries failures", async () => {
  const { AppIconStore } = await import("../src/app-icons.ts");
  const icons = new AppIconStore();
  const requests: unknown[] = [];
  let fail = true;
  const call = async (_name: string, args: Record<string, unknown>) => {
    requests.push([args.deviceId, args.bundleIds]);
    if (fail && (args.bundleIds as string[]).includes("dev.flaky")) throw new Error("offline");
    return { apps: { "com.acme": { icon: "data:image/png;base64,AAAA" } } };
  };
  await Promise.all([icons.load(call, "ios", "sim-a", ["com.acme", "dev.plain"]), icons.load(call, "ios", "sim-a", ["com.acme"])]);
  assert.equal(icons.get("ios", "sim-a", "com.acme")?.icon, "data:image/png;base64,AAAA");
  assert.deepEqual(icons.get("ios", "sim-a", "dev.plain"), {}, "apps without an icon are remembered");
  await icons.load(call, "ios", "sim-b", ["com.acme"]);
  assert.deepEqual(requests, [["sim-a", ["com.acme", "dev.plain"]], ["sim-b", ["com.acme"]]], "a second panel asking at the same time does not refetch; another device does");
  await icons.load(call, "ios", "sim-a", ["dev.flaky"]);
  assert.equal(icons.get("ios", "sim-a", "dev.flaky"), undefined);
  fail = false;
  await icons.load(call, "ios", "sim-a", ["dev.flaky"]);
  assert.deepEqual(icons.get("ios", "sim-a", "dev.flaky"), {}, "a failed batch is requested again later");
});
