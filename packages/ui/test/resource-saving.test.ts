import test from "node:test";
import assert from "node:assert/strict";
import { ResourceSavingStore } from "../src/resource-saving.ts";
import type { ResourceSavingState } from "../../shared/src/resource-saving.ts";

test("stopped virtual devices can opt out before boot and physical devices do not load preferences", async () => {
  const store = new ResourceSavingStore();
  let calls = 0;
  let enabled = true;
  store.request = async next => {
    calls++;
    if (next !== undefined) enabled = next;
    return { enabled, running: false, restartRequired: false };
  };
  store.configure("avd:Pixel_8", true, false);
  await new Promise(resolve => setImmediate(resolve));
  await store.change(false);
  const saved = store.getSnapshot();
  assert.equal(saved.value?.enabled, false);
  assert.equal(calls, 2);
  store.configure("physical", false, false);
  assert.equal(calls, 2);
  const physical = store.getSnapshot();
  assert.equal(physical.visible, false);
});

test("late preferences from an old device never replace the current device", async () => {
  const store = new ResourceSavingStore();
  let finish!: (state: ResourceSavingState) => void;
  store.request = () => new Promise(resolve => { finish = resolve; });
  store.configure("first", true, false);
  store.configure("second", false, true);
  finish({ enabled: false, running: true, restartRequired: true });
  await new Promise(resolve => setImmediate(resolve));
  const state = store.getSnapshot();
  assert.equal(state.value, undefined);
  assert.equal(state.deviceId, "second");
});
