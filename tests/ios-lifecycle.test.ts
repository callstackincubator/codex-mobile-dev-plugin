import test from "node:test";
import assert from "node:assert/strict";
import { Baguette } from "../src/server/baguette.ts";
import { fakeBaguette, UDID } from "./fixtures.ts";

test("booting a running simulator skips the route that can repair input", async t => {
  const fake = await fakeBaguette();
  const baguette = new Baguette(fake.url);
  t.after(async () => { baguette.dispose(); await fake.close(); });
  const status = await baguette.changeDeviceState(UDID, "boot");
  assert.equal(status.devices.find(device => device.udid === UDID)?.state, "Booted");
  assert.equal(fake.requests.some(request => request.path.endsWith("/boot")), false);
});

test("concurrent boot calls share one boot and wait for the reported device state", async t => {
  const fake = await fakeBaguette();
  fake.setState("Shutdown"); fake.setLifecycleState("Booting");
  const baguette = new Baguette(fake.url);
  t.after(async () => { baguette.dispose(); await fake.close(); });
  let finished = false;
  const first = baguette.changeDeviceState(UDID, "boot").then(status => { finished = true; return status; });
  const second = baguette.changeDeviceState(UDID, "boot");
  await waitFor(() => fake.requests.some(request => request.path.endsWith("/boot")));
  assert.equal(finished, false);
  assert.equal(fake.requests.filter(request => request.path.endsWith("/boot")).length, 1);
  fake.setState("Booted");
  const statuses = await Promise.all([first, second]);
  for (const status of statuses) assert.equal(status.devices.find(device => device.udid === UDID)?.state, "Booted");
  assert.equal(fake.requests.filter(request => request.path.endsWith("/boot")).length, 1);
});

test("shutdown waits for a pending boot instead of racing its request", async t => {
  const fake = await fakeBaguette();
  fake.setState("Shutdown"); fake.setLifecycleState("Booting");
  const baguette = new Baguette(fake.url);
  t.after(async () => { baguette.dispose(); await fake.close(); });
  const boot = baguette.changeDeviceState(UDID, "boot");
  const shutdown = baguette.changeDeviceState(UDID, "shutdown");
  await waitFor(() => fake.requests.some(request => request.path.endsWith("/boot")));
  assert.equal(fake.requests.some(request => request.path.endsWith("/shutdown")), false);
  fake.setLifecycleState(); fake.setState("Booted");
  await boot;
  const stopped = await shutdown;
  assert.equal(stopped.devices.find(device => device.udid === UDID)?.state, "Shutdown");
});

test("a simulator already booting finishes without a second boot request", async t => {
  const fake = await fakeBaguette();
  fake.setState("Booting");
  const baguette = new Baguette(fake.url);
  t.after(async () => { baguette.dispose(); await fake.close(); });
  const pending = baguette.changeDeviceState(UDID, "boot");
  await waitFor(() => fake.requests.filter(request => request.path === "/simulators.json").length >= 3);
  fake.setState("Booted");
  const status = await pending;
  assert.equal(status.devices.find(device => device.udid === UDID)?.state, "Booted");
  assert.equal(fake.requests.some(request => request.path.endsWith("/boot")), false);
});

test("a boot failure does not prevent a later boot", async t => {
  const fake = await fakeBaguette();
  fake.setState("Shutdown"); fake.setLifecycleFailure(true);
  const baguette = new Baguette(fake.url);
  t.after(async () => { baguette.dispose(); await fake.close(); });
  await assert.rejects(baguette.changeDeviceState(UDID, "boot"), /boot failed/);
  fake.setLifecycleFailure(false);
  const status = await baguette.changeDeviceState(UDID, "boot");
  assert.equal(status.devices.find(device => device.udid === UDID)?.state, "Booted");
});

test("a boot reply without a ready state times out instead of claiming success", async t => {
  const fake = await fakeBaguette();
  fake.setState("Shutdown"); fake.setLifecycleState("Booting");
  const baguette = new Baguette(fake.url);
  t.after(async () => { baguette.dispose(); await fake.close(); });
  await assert.rejects(baguette.changeDeviceState(UDID, "boot", 40), /did not finish booting/);
});

test("disposing the adapter cancels a pending boot and its queued shutdown", async t => {
  const fake = await fakeBaguette();
  fake.setState("Shutdown"); fake.setLifecycleState("Booting");
  const baguette = new Baguette(fake.url);
  t.after(() => fake.close());
  const boot = assert.rejects(baguette.changeDeviceState(UDID, "boot"), /server has closed/);
  const shutdown = assert.rejects(baguette.changeDeviceState(UDID, "shutdown"), /server has closed/);
  await waitFor(() => fake.requests.some(request => request.path.endsWith("/boot")));
  baguette.dispose();
  await Promise.all([boot, shutdown]);
  assert.equal(fake.requests.some(request => request.path.endsWith("/shutdown")), false);
});

async function waitFor(condition: () => boolean) {
  const deadline = Date.now() + 2000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for simulator state.");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
