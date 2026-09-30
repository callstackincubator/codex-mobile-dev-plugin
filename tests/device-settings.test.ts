import test from "node:test";
import assert from "node:assert/strict";
import { DeviceSettingsService } from "../src/server/device-settings.ts";
import { DeviceSettingsStore } from "../src/ui/device-settings.ts";
import type { Baguette } from "../src/server/baguette.ts";
import type { ServeEmu } from "../src/server/serve-emu.ts";
import { deviceSettingSchema } from "../src/shared/device-settings.ts";

const ios = { platform: "ios", id: "B5C969F6-58A4-4C31-AB12-FB9E56D681DE" } as const;
const android = { platform: "android", id: "emulator-5554" } as const;
function fixture() {
  const requests: { platform: string; id: string; path: string; method: string; body?: object }[] = [];
  const values = { appearance: "dark", increaseContrast: "disabled", contentSize: "large" };
  let failFont = false;
  const baguette = {
    async device(id: string, booted: boolean) { assert.equal(id, ios.id); assert.equal(booted, true); },
    async json(path: string, options: RequestInit = {}) {
      const body = options.body ? JSON.parse(String(options.body)) : undefined;
      requests.push({ platform: "ios", id: ios.id, path, method: options.method ?? "GET", body });
      if (path.endsWith("/location")) return { ok: true };
      if (body) Object.assign(values, body);
      return { ...values };
    },
  } as unknown as Baguette;
  const serveEmu = {
    async start(id: string) { return { url: new URL(`http://localhost/${id}/`) }; },
    async json(url: URL, path: string, options: RequestInit = {}) {
      const body = options.body ? JSON.parse(String(options.body)) : undefined;
      requests.push({ platform: "android", id: url.pathname.slice(1, -1), path, method: options.method ?? "GET", body });
      if (path === "/api/night-mode") return { ok: true, nightMode: { mode: body?.mode ?? "light" } };
      if (path === "/api/font-scale") { if (failFont) throw new Error("Not available"); return { ok: true, fontScale: { scale: body?.scale ?? 1 } }; }
      if (path === "/api/orientation") return { ok: true, orientation: { orientation: body?.orientation ?? "auto" } };
      if (path === "/api/location") return { ...(body ? { ok: true } : {}), location: body ?? null };
      throw new Error("Unexpected path");
    },
  } as unknown as ServeEmu;
  return { service: new DeviceSettingsService(baguette, serveEmu), requests, failFont() { failFont = true; } };
}

test("settings preserve platform values and apply changes through the selected backend", async () => {
  const f = fixture();
  assert.deepEqual(await f.service.read(ios), { appearance: "dark", increaseContrast: false, contentSize: "large", locationSupported: true });
  await f.service.update(ios, { setting: "increaseContrast", value: true });
  assert.deepEqual(f.requests.at(-1)?.body, { increaseContrast: "enabled" });
  await f.service.update(ios, { setting: "location", value: null });
  assert.equal(f.requests.at(-1)?.method, "DELETE");
  assert.deepEqual(await f.service.read(android), { appearance: "light", fontScale: 1, orientation: "auto", location: null, locationSupported: true });
  assert.deepEqual(await f.service.update(android, { setting: "appearance", value: "dark" }), { appearance: "dark" });
  assert.equal(f.requests.at(-1)?.id, android.id);
  assert.deepEqual(f.requests.at(-1)?.body, { mode: "dark" });
  assert.deepEqual(await f.service.update(android, { setting: "location", value: { latitude: 48.2, longitude: 16.3 } }), { location: { latitude: 48.2, longitude: 16.3 } });
});

test("unsupported settings never reach a backend and partial reads keep working controls", async () => {
  const f = fixture();
  for (const [target, change] of [[ios, { setting: "fontScale", value: 1.5 }], [ios, { setting: "appearance", value: "auto" }], [android, { setting: "increaseContrast", value: true }], [android, { setting: "location", value: null }]] as const) {
    await assert.rejects(f.service.update(target, change), /does not expose/);
  }
  assert.equal(f.requests.length, 0);
  f.failFont();
  const settings = await f.service.read(android);
  assert.equal(settings.appearance, "light");
  assert.equal(settings.fontScale, undefined);
  assert.match(settings.errors![0], /Text size/);
  assert.equal((await f.service.read({ platform: "android", id: "physical-device" })).locationSupported, false);
  assert.equal(deviceSettingSchema.safeParse({ setting: "location", value: { latitude: 91, longitude: 0 } }).success, false);
  assert.equal(deviceSettingSchema.safeParse({ setting: "fontScale", value: 3 }).success, false);
});

test("switching devices ignores pending settings and frame changes stay local", async () => {
  const store = new DeviceSettingsStore();
  let resolve!: (value: object) => void;
  let requests = 0;
  store.request = () => { requests++; return new Promise(done => { resolve = done; }); };
  store.configure(ios.id, false);
  const load = store.load();
  store.configure(android.id, false);
  resolve({ appearance: "dark", locationSupported: true });
  await load;
  assert.equal(store.getSnapshot().settings, undefined);
  assert.equal(store.getSnapshot().loading, false);
  let visible = true;
  store.setFrame = value => { visible = value; };
  store.toggleFrame(false);
  assert.equal(visible, false);
  assert.equal(requests, 1);
  store.dispose();
  assert.equal(store.getSnapshot().disabled, true);
});

test("rapid edits stay interactive and save in order without overwriting queued choices", async () => {
  const store = new DeviceSettingsStore();
  const writes: { change: unknown; resolve: (value: object) => void; reject: (error: Error) => void }[] = [];
  store.configure(ios.id, false);
  store.request = async change => {
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
  const store = new DeviceSettingsStore();
  store.configure(ios.id, false);
  let refresh!: (value: object) => void;
  let reads = 0;
  store.request = async change => {
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
