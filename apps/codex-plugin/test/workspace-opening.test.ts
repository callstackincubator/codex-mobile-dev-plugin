import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const built = await build({
  entryPoints: ["apps/codex-plugin/ui/main.tsx"],
  bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
  loader: { ".css": "empty", ".woff2": "empty", ".woff": "empty" },
  define: { "process.env.NODE_ENV": '"production"' },
});

for (const notification of ["input", "result"] as const) test(`workspace applies Android intent from host ${notification} before connecting`, async t => {
  const identity = '<meta name="mobile-dev-user-id" content="anon_0123456789abcdef0123456789abcdef"><meta name="mobile-dev-session-id" content="run_1234567890abcdef1234567890abcdef">';
  const telemetryMeta = notification === "input" ? identity : '<meta name="mobile-dev-telemetry" content="off">';
  const dom = new JSDOM(`<html data-view="panel"><head><meta name="mobile-dev-environment" content="development">${telemetryMeta}</head><body><div id="root"></div></body></html>`, {
    pretendToBeVisual: true, runScripts: "outside-only", url: "https://mobile-dev.test/",
  });
  const window = dom.window;
  window.Math.random = () => 0;
  window.console.debug = () => {};
  Object.defineProperty(window.performance, "getEntriesByType", { value: () => [] });
  Object.defineProperty(window.performance, "getEntries", { value: () => [] });
  const telemetry: string[] = [];
  window.fetch = async (_url, options) => {
    const body = String(options?.body ?? "");
    telemetry.push(body);
    return new Response("", { status: 200 });
  };
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
  Object.defineProperty(window.HTMLElement.prototype, "clientWidth", { get: () => 400 });
  Object.defineProperty(window.HTMLElement.prototype, "clientHeight", { get: () => 800 });
  const calls: string[] = [];
  let initialized = false;
  let tornDown = false;
  function send(message: object) {
    const event = new window.MessageEvent("message", { data: { jsonrpc: "2.0", ...message }, source: window });
    window.dispatchEvent(event);
  }
  function result(id: number | string, value: object) { send({ id, result: value }); }
  window.postMessage = message => {
    if (message.method === "ui/initialize") {
      result(message.id, { protocolVersion: "2026-01-26", hostInfo: { name: "test", version: "1" }, hostCapabilities: { serverTools: {}, serverResources: {} }, hostContext: {} });
    } else if (message.method === "ui/notifications/initialized") {
      initialized = true;
    } else if (message.method === "tools/call") {
      const name = message.params.name;
      calls.push(name);
      if (name === "mobile_list_simulators") {
        result(message.id, { content: [], structuredContent: { connected: true, managed: false, baseUrl: "", devices: [{ udid: "iphone", name: "iPhone", state: "Booted", runtime: "iOS" }] } });
      } else if (name === "mobile_list_ios_devices") {
        result(message.id, { content: [], structuredContent: { physicalDevices: [] } });
      } else if (name === "mobile_list_android_devices") {
        result(message.id, { content: [], structuredContent: { connected: true, managed: false, baseUrl: "", devices: [{ udid: "avd:Pixel", name: "Pixel", state: "Shutdown", runtime: "Android", platform: "android", kind: "emulator" }] } });
      } else {
        result(message.id, { content: [] });
      }
    } else if (message.id === "teardown") {
      tornDown = true;
    } else if (message.id !== undefined) {
      result(message.id, {});
    }
  };
  async function until(condition: () => boolean) {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (condition()) return;
      await setTimeout(5);
    }
    assert.fail("The workspace did not reach the expected host state.");
  }
  t.after(async () => {
    send({ id: "teardown", method: "ui/resource-teardown", params: {} });
    await until(() => tornDown);
    window.close();
    if (notification === "input") {
      const captured = telemetry.join("\n");
      assert.match(captured, /"device_platform":\{"value":"android"/);
      assert.match(captured, /"device_kind":\{"value":"emulator"/);
      assert.match(captured, /"layout":\{"value":"android"/);
      const containsDeviceId = captured.includes("avd:Pixel");
      assert.equal(containsDeviceId, false);
    }
  });
  window.eval(built.outputFiles[0].text);
  await until(() => initialized);
  await setTimeout(10);
  const earlyDiscovery = calls.filter(name => name.startsWith("mobile_list_"));
  assert.deepEqual(earlyDiscovery, []);
  const target = { platform: "android", kind: "emulator", deviceId: "avd:Pixel" };
  if (notification === "input") send({ method: "ui/notifications/tool-input", params: { arguments: target } });
  else send({ method: "ui/notifications/tool-result", params: { content: [], structuredContent: { panelTarget: target } } });
  await until(() => calls.includes("mobile_list_android_devices"));
  await until(() => {
    const label = window.document.getElementById("platform-select")?.textContent ?? "";
    return label.includes("Android");
  });
  await setTimeout(10);
  const ios = window.document.getElementById("ios-panel");
  const android = window.document.getElementById("android-panel");
  assert.equal(ios?.hidden, true);
  assert.equal(android?.hidden, false);
  const devices = android?.querySelector('[data-element="devices"]')?.textContent ?? "";
  assert.match(devices, /Pixel/);
  const unexpected = calls.filter(name => name.endsWith("_stream_session") || name.startsWith("mobile_boot"));
  assert.deepEqual(unexpected, []);
});

test("mobile_open_app_intel's appIntelScreen selects that screen in the workspace", async t => {
  const dom = new JSDOM('<html data-view="panel"><head><meta name="mobile-dev-environment" content="development"><meta name="mobile-dev-telemetry" content="off"></head><body><div id="root"></div></body></html>', {
    pretendToBeVisual: true, runScripts: "outside-only", url: "https://mobile-dev.test/",
  });
  const window = dom.window;
  window.Math.random = () => 0;
  window.console.debug = () => {};
  Object.defineProperty(window.performance, "getEntriesByType", { value: () => [] });
  Object.defineProperty(window.performance, "getEntries", { value: () => [] });
  window.fetch = async () => new Response("", { status: 200 });
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
  Object.defineProperty(window.HTMLElement.prototype, "clientWidth", { get: () => 400 });
  Object.defineProperty(window.HTMLElement.prototype, "clientHeight", { get: () => 800 });
  const snapshot = {
    formatVersion: 1,
    meta: { projectId: "p", generation: "g", analyzedAt: "2026-11-04T00:00:00Z", analyzerVersion: "t", sourceFingerprint: "f" },
    files: { "app/index.tsx": { fingerprint: "x", kind: "source", reach: 1 }, "app/profile.tsx": { fingerprint: "x", kind: "source", reach: 1 } },
    packages: {},
    screens: {
      home: { title: "Home", route: "/", source: "app/index.tsx", layouts: [] },
      profile: { title: "Profile", route: "/profile", source: "app/profile.tsx", layouts: [] },
    },
    edges: [
      { from: "screen:home", to: "file:app/index.tsx", kind: "source", platforms: ["ios", "android"] },
      { from: "screen:profile", to: "file:app/profile.tsx", kind: "source", platforms: ["ios", "android"] },
    ],
    diagnostics: [],
    indexes: { screens: { home: ["0"], profile: ["1"] }, incoming: { "file:app/index.tsx": [0], "file:app/profile.tsx": [1] }, outgoing: { "screen:home": [0], "screen:profile": [1] } },
  };
  let tornDown = false;
  function send(message: object) {
    const event = new window.MessageEvent("message", { data: { jsonrpc: "2.0", ...message }, source: window });
    window.dispatchEvent(event);
  }
  function result(id: number | string, value: object) { send({ id, result: value }); }
  let initialized = false;
  const calls: string[] = [];
  window.postMessage = message => {
    if (message.method === "ui/initialize") {
      result(message.id, { protocolVersion: "2026-01-26", hostInfo: { name: "test", version: "1" }, hostCapabilities: { serverTools: {}, serverResources: {} }, hostContext: {} });
    } else if (message.method === "ui/notifications/initialized") {
      initialized = true;
    } else if (message.method === "tools/call") {
      const name = message.params.name;
      calls.push(name);
      if (name === "mobile_app_intel_snapshot") result(message.id, { content: [], structuredContent: { projectPath: "/app", snapshot, recents: ["/app"] } });
      else if (name === "mobile_list_simulators") result(message.id, { content: [], structuredContent: { connected: true, managed: false, baseUrl: "", devices: [] } });
      else result(message.id, { content: [] });
    } else if (message.id === "teardown") {
      tornDown = true;
    } else if (message.id !== undefined) {
      result(message.id, {});
    }
  };
  async function until(condition: () => boolean) {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (condition()) return;
      await setTimeout(5);
    }
    assert.fail("The workspace did not reach the expected host state.");
  }
  t.after(async () => {
    send({ id: "teardown", method: "ui/resource-teardown", params: {} });
    await until(() => tornDown);
    window.close();
  });
  window.eval(built.outputFiles[0].text);
  await until(() => initialized);
  send({ method: "ui/notifications/tool-result", params: { content: [], structuredContent: { panelTarget: { workspaceTool: "app-intel", appIntelScreen: "profile" } } } });
  // The entry-point rail starts collapsed; open it to see the selected screen.
  await until(() => window.document.querySelector('button[aria-controls="app-intel-entries"]') !== null);
  (window.document.querySelector('button[aria-controls="app-intel-entries"]') as HTMLButtonElement).click();
  await until(() => window.document.querySelector('[data-entry="profile"]') !== null);
  await setTimeout(10);
  const selected = window.document.querySelector('[data-entry="profile"]');
  assert.equal(selected?.getAttribute("aria-current"), "true");
  const home = window.document.querySelector('[data-entry="home"]');
  assert.equal(home?.getAttribute("aria-current"), "false");
  assert.deepEqual(calls.filter(name => name.startsWith("mobile_list_")), [], "App Intelligence does not start device discovery");
});
