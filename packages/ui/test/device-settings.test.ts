import test from "node:test";
import assert from "node:assert/strict";
import { DeviceSettingsStore } from "../src/device-settings.ts";
import type { DeviceSettingsSource } from "../src/device-settings.ts";

const ios = { platform: "ios", id: "B5C969F6-58A4-4C31-AB12-FB9E56D681DE" } as const;
const android = { platform: "android", id: "emulator-5554" } as const;

test("switching devices ignores pending settings and frame changes stay local", async () => {
  let request: DeviceSettingsSource["request"] = async () => ({});
  let setFrame: DeviceSettingsSource["setFrame"] = () => {};
  const store = new DeviceSettingsStore({ request: change => request(change), setFrame: visible => setFrame(visible) });
  let resolve!: (value: object) => void;
  let requests = 0;
  request = () => { requests++; return new Promise(done => { resolve = done; }); };
  store.configure(ios.id, false);
  const load = store.load();
  store.configure(android.id, false);
  resolve({ appearance: "dark", locationSupported: true });
  await load;
  assert.equal(store.getSnapshot().settings, undefined);
  assert.equal(store.getSnapshot().loading, false);
  let visible = true;
  setFrame = value => { visible = value; };
  store.toggleFrame(false);
  assert.equal(visible, false);
  assert.equal(requests, 1);
  store.dispose();
  assert.equal(store.getSnapshot().disabled, true);
});

test("rapid edits stay interactive and save in order without overwriting queued choices", async () => {
  let request: DeviceSettingsSource["request"] = async () => ({});
  let setFrame: DeviceSettingsSource["setFrame"] = () => {};
  const store = new DeviceSettingsStore({ request: change => request(change), setFrame: visible => setFrame(visible) });
  const writes: { change: unknown; resolve: (value: object) => void; reject: (error: Error) => void }[] = [];
  store.configure(ios.id, false);
  request = async change => {
    if (!change) return { appearance: "light", contentSize: "large", locationSupported: true };
    return new Promise((resolve, reject) => writes.push({ change, resolve, reject }));
  };
  await store.load();
  const first = store.change({ setting: "appearance", value: "dark" });
  const second = store.change({ setting: "contentSize", value: "small" });
  assert.equal(store.getSnapshot().disabled, false);
  assert.equal(store.getSnapshot().settings?.appearance, "dark");
  assert.equal(store.getSnapshot().settings?.contentSize, "small");
  assert.equal(writes.length, 1);
  writes[0].resolve({ appearance: "dark", contentSize: "large" });
  await first;
  assert.equal(store.getSnapshot().settings?.contentSize, "small");
  assert.equal(writes.length, 2);
  const third = store.change({ setting: "appearance", value: "light" });
  writes[1].resolve({ appearance: "dark", contentSize: "small" });
  await second;
  assert.equal(store.getSnapshot().settings?.appearance, "light");
  writes[2].reject(new Error("Device rejected appearance"));
  await third;
  assert.equal(store.getSnapshot().settings?.appearance, "dark");
  assert.equal(store.getSnapshot().settings?.contentSize, "small");
  assert.match(store.getSnapshot().error, /rejected appearance/);
  assert.equal(store.getSnapshot().busy, false);
});

test("a background refresh never replaces a newer edit", async () => {
  let request: DeviceSettingsSource["request"] = async () => ({});
  let setFrame: DeviceSettingsSource["setFrame"] = () => {};
  const store = new DeviceSettingsStore({ request: change => request(change), setFrame: visible => setFrame(visible) });
  store.configure(ios.id, false);
  let refresh!: (value: object) => void;
  let reads = 0;
  request = async change => {
    if (change) return { appearance: "dark" };
    if (++reads === 1) return { appearance: "light", locationSupported: true };
    return new Promise(resolve => { refresh = resolve; });
  };
  await store.load();
  const loading = store.load();
  await Promise.resolve();
  assert.equal(store.getSnapshot().settings?.appearance, "light");
  await store.change({ setting: "appearance", value: "dark" });
  refresh({ appearance: "light", locationSupported: true });
  await loading;
  assert.equal(store.getSnapshot().settings?.appearance, "dark");
});
