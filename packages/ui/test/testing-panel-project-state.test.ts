import test from "node:test";
import assert from "node:assert/strict";
import type { HostBridge } from "../src/host-bridge.ts";
import type { DeviceAppsStore } from "../src/device-apps.ts";
import { TestingPanel } from "../src/testing-panel.ts";

const STUDIO = "/support/mobile-dev/studio";
const APP = "/Users/someone/expoapp57";
const KEY = "mobile-dev.testing.project";
const deviceApps = { subscribe: () => () => undefined, getSnapshot: () => ({ device: undefined }) } as unknown as DeviceAppsStore;

function storage(initial?: unknown) {
  const values = new Map<string, string>(initial === undefined ? [] : [[KEY, JSON.stringify(initial)]]);
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); },
  };
  return values;
}

function host(calls: string[], request?: { id: number; path: string }) {
  return { async callServerTool({ name, arguments: input }: { name: string; arguments: Record<string, unknown> }) {
    calls.push(name === "mobile_testing_choose_project" ? `${name}:${String(input.projectPath)}` : name);
    const structuredContent: Record<string, unknown> =
      name === "mobile_testing_projects" ? { projects: [{ path: APP, name: "expoapp57" }], studioPath: STUDIO }
        : name === "mobile_testing_agent_state" ? { projectRequest: request ?? null }
          : name === "mobile_testing_choose_project" ? { project: { path: input.projectPath, name: "expoapp57" } }
            : {};
    return { content: [], structuredContent };
  } } as unknown as HostBridge;
}
const settle = async (panel: TestingPanel, path: string) => {
  const deadline = Date.now() + 2000;
  while (panel.getSnapshot().projectPath !== path && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  return panel.getSnapshot().projectPath;
};

test("a reopened panel returns to No project, not the newest folder", async t => {
  storage({ project: STUDIO });
  const panel = new TestingPanel(host([]), deviceApps, { heartbeatMs: 1e9 });
  t.after(() => panel.dispose?.());
  panel.setAvailable(true);
  assert.equal(await settle(panel, STUDIO), STUDIO);
});

test("without a saved choice the newest folder still opens", async t => {
  storage();
  const panel = new TestingPanel(host([]), deviceApps, { heartbeatMs: 1e9 });
  t.after(() => panel.dispose?.());
  panel.setAvailable(true);
  assert.equal(await settle(panel, APP), APP);
});

test("an agent's project request already applied by an earlier document is not replayed", async t => {
  const values = storage({ project: STUDIO, request: { id: 4, path: APP } });
  const calls: string[] = [];
  const panel = new TestingPanel(host(calls, { id: 4, path: APP }), deviceApps, { heartbeatMs: 1e9 });
  t.after(() => panel.dispose?.());
  panel.setAvailable(true);
  assert.equal(await settle(panel, STUDIO), STUDIO);
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(calls.some(call => call.startsWith("mobile_testing_choose_project")), false);
  assert.equal(panel.getSnapshot().projectPath, STUDIO);
  assert.ok(values.get(KEY));
});

test("a new agent request is still applied once and remembered", async t => {
  const values = storage({ project: STUDIO, request: { id: 4, path: APP } });
  const panel = new TestingPanel(host([], { id: 5, path: APP }), deviceApps, { heartbeatMs: 1e9 });
  t.after(() => panel.dispose?.());
  panel.setAvailable(true);
  assert.equal(await settle(panel, APP), APP);
  assert.deepEqual(JSON.parse(values.get(KEY)!).request, { id: 5, path: APP });
});

test("clicking a lane switches the layout and mirror to it, and a poll does not", async t => {
  storage();
  const panel = new TestingPanel(host([]), deviceApps, { heartbeatMs: 1e9 });
  t.after(() => panel.dispose?.());
  const lane = (platform: "ios" | "android", state: string) => ({
    runId: `r-${platform}`, deviceId: platform === "android" ? "avd:Pixel" : "d-ios",
    ...(platform === "android" ? { resolvedDeviceId: "emulator-5554" } : {}),
    deviceName: platform, platform, state, progress: [],
  });
  const internals = panel as unknown as { update(fields: Record<string, unknown>): void; readMatrix(id: string): Promise<unknown> };
  internals.update({ matrix: { matrixId: "m", limit: 3, startedAt: 1, lanes: [lane("ios", "passed"), lane("android", "failed")] }, selectedLane: "r-ios" });
  const picked: string[] = [], focused: string[] = [];
  panel.onLanePicked(platform => picked.push(platform));
  panel.setMirrorDevice((platform, deviceId) => { focused.push(`${platform}:${deviceId}`); return true; });
  panel.openLane("r-android");
  assert.deepEqual(picked, ["android"]);
  assert.deepEqual(focused, ["android:emulator-5554"], "the running emulator serial is mirrored instead of its requested AVD id");
  internals.update({ matrix: { matrixId: "m", limit: 3, startedAt: 1, lanes: [lane("ios", "passed"), lane("android", "running")] } });
  assert.equal(panel.matrixBusy("avd:Pixel"), true, "the requested checklist id stays busy");
  assert.equal(panel.matrixBusy("emulator-5554"), true, "the resolved running id is busy too");
  panel.openLane("r-ios");
  assert.deepEqual(focused, ["android:emulator-5554", "ios:d-ios"]);
  // The panel's own refresh of the run re-selects the lane quietly: it must not move the mirror.
  const before = focused.length;
  await internals.readMatrix("m").catch(() => undefined);
  assert.equal(focused.length, before);
});
