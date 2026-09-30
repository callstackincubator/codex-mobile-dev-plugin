import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { SimulatorInputService } from "../src/server/simulator-input.ts";
import { UDID, OTHER_UDID } from "./fixtures.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}

test("first check is awaited and concurrent callers cannot start duplicate queries", async t => {
  let now = 0;
  t.mock.method(Date, "now", () => now);
  const query = deferred<string>();
  let checks = 0;
  const service = new SimulatorInputService(async () => {}, () => { checks++; return query.promise; });
  const first = service.status(UDID);
  now = 2000;
  const second = service.status(UDID);
  assert.equal(first, second);
  assert.equal(checks, 1);
  let settled = false;
  void first.then(() => { settled = true; });
  await setImmediate();
  assert.equal(settled, false);
  query.resolve("state 0");
  assert.deepEqual(await first, { state: "ready" });
});

test("expired checks refresh without making gestures wait, then publish newly blocked state", async t => {
  let now = 0;
  t.mock.method(Date, "now", () => now);
  const refresh = deferred<string>();
  let checks = 0;
  const service = new SimulatorInputService(async () => {}, () => {
    checks++;
    return checks === 1 ? Promise.resolve("state 0") : refresh.promise;
  });
  assert.deepEqual(await service.status(UDID), { state: "ready" });
  now = 1000;
  for (let i = 0; i < 10; i++) assert.deepEqual(await service.status(UDID), { state: "ready" });
  now = 3000;
  assert.deepEqual(await service.status(UDID), { state: "ready" });
  assert.equal(checks, 2, "Only one refresh may be in flight, even if it outlasts the cache TTL.");
  refresh.resolve("state 1");
  await setImmediate();
  assert.deepEqual(await service.status(UDID), { state: "blocked" });
  assert.equal(checks, 3, "An already expired completed refresh may be renewed, without delaying cached input.");
});

test("explicit fresh checks await a shared refresh while ordinary input uses the completed result", async () => {
  const refresh = deferred<string>();
  let checks = 0;
  const service = new SimulatorInputService(async () => {}, () => {
    checks++;
    return checks === 1 ? Promise.resolve("state 0") : refresh.promise;
  });
  await service.status(UDID);
  const fresh = service.status(UDID, { fresh: true });
  const another = service.status(UDID, { fresh: true });
  assert.equal(fresh, another);
  assert.deepEqual(await service.status(UDID), { state: "ready" });
  let settled = false;
  void fresh.then(() => { settled = true; });
  await setImmediate();
  assert.equal(settled, false);
  refresh.resolve("state 1");
  assert.deepEqual(await fresh, { state: "blocked" });
});

test("background query failures publish unknown without rejecting or blocking cached input", async t => {
  let now = 0;
  t.mock.method(Date, "now", () => now);
  const refresh = deferred<string>();
  let checks = 0;
  const service = new SimulatorInputService(async () => {}, () => {
    checks++;
    return checks === 1 ? Promise.resolve("state 0") : refresh.promise;
  });
  await service.status(UDID);
  now = 1000;
  assert.deepEqual(await service.status(UDID), { state: "ready" });
  refresh.reject(new Error("simctl failed"));
  await setImmediate();
  assert.deepEqual(await service.status(UDID), { state: "unknown" });
  assert.equal(checks, 2);
});

test("a pending query on one device does not delay another device", async () => {
  const query = deferred<string>();
  const service = new SimulatorInputService(async () => {}, udid => udid === UDID ? query.promise : Promise.resolve("state 1"));
  const pending = service.status(UDID);
  assert.deepEqual(await service.status(OTHER_UDID), { state: "blocked" });
  query.resolve("state 0");
  assert.deepEqual(await pending, { state: "ready" });
});

test("a late refresh cannot overwrite repair results or start a second repair", async t => {
  let now = 0;
  t.mock.method(Date, "now", () => now);
  const stale = deferred<string>();
  const repairing = deferred<void>();
  let state = "0";
  let checks = 0;
  let repairs = 0;
  const service = new SimulatorInputService(async () => {
    repairs++;
    await repairing.promise;
    state = "0";
  }, () => {
    checks++;
    return checks === 2 ? stale.promise : Promise.resolve(`state ${state}`);
  });
  await service.status(UDID);
  now = 1000;
  await service.status(UDID);
  state = "1";
  const repair = service.repair(UDID);
  assert.equal(service.repair(UDID), repair);
  assert.equal(service.status(UDID), repair);
  await setImmediate();
  assert.equal(repairs, 1);
  repairing.resolve();
  assert.deepEqual(await repair, { state: "ready" });
  await service.status(UDID);
  stale.resolve("state 1");
  await setImmediate();
  assert.deepEqual(await service.status(UDID), { state: "ready" });
});
