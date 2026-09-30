import test from "node:test";
import assert from "node:assert/strict";
import { StreamSessions } from "../src/server/stream-sessions.ts";
import { Baguette } from "../src/server/baguette.ts";
import { fakeBaguette, UDID, SCREEN, PNG } from "./fixtures.ts";

test("panel sessions carry frames and validated input without a browser socket", async t => {
  const fake = await fakeBaguette();
  const streams = new StreamSessions(new Baguette(fake.url));
  t.after(async () => { streams.close(); await fake.close(); });
  const id = await streams.open(UDID, 30);
  const first = await streams.frame(id, 0);
  assert.equal(first?.sequence, 1);
  assert.deepEqual(Buffer.from(first!.data, "base64"), PNG);
  assert.equal(fake.requests.find(request => request.path.includes("/stream"))?.origin, undefined);
  const input = { type: "touch1-down", x: 120, y: 300, ...SCREEN };
  assert.equal(streams.input(id, [input]), 1);
  await waitFor(() => fake.inputs.some(message => (message as { type: string }).type === "touch1-down"));
  assert.deepEqual(fake.inputs.at(-1), input);
  const before = fake.inputs.length;
  assert.throws(() => streams.input(id, [input, { type: "run_shell", command: "whoami" }]));
  assert.equal(fake.inputs.length, before);
  const next = streams.frame(id, first!.sequence);
  for (const socket of fake.websocket.clients) socket.send(PNG);
  assert.equal((await next)?.sequence, 2);
  streams.closeSession(id);
  await waitFor(() => fake.websocket.clients.size === 0);
  await assert.rejects(streams.frame(id, 0), /expired or closed/);
});

test("unknown panel sessions cannot read frames or send input", async t => {
  const fake = await fakeBaguette();
  const streams = new StreamSessions(new Baguette(fake.url));
  t.after(async () => { streams.close(); await fake.close(); });
  const unknown = "0".repeat(64);
  await assert.rejects(streams.frame(unknown, 0), /expired or closed/);
  assert.throws(() => streams.input(unknown, [{ type: "button", button: "home" }]), /expired or closed/);
  assert.equal(fake.websocket.clients.size, 0);
});

test("closing a panel releases a pending frame read and stops upstream capture", async t => {
  const fake = await fakeBaguette();
  const streams = new StreamSessions(new Baguette(fake.url));
  t.after(async () => { streams.close(); await fake.close(); });
  const id = await streams.open(UDID, 30);
  const first = await streams.frame(id, 0);
  const pending = streams.frame(id, first!.sequence);
  streams.closeSession(id);
  await assert.rejects(pending, /stream closed/);
  await waitFor(() => fake.websocket.clients.size === 0);
});

test("a dropped socket recovers the same session without replaying input or resetting frame sequence", async t => {
  const fake = await fakeBaguette();
  const streams = new StreamSessions(new Baguette(fake.url), [0]);
  t.after(async () => { streams.close(); await fake.close(); });
  const id = await streams.open(UDID, 30);
  const first = await streams.frame(id, 0);
  streams.input(id, [{ type: "button", button: "home" }]);
  await waitFor(() => fake.inputs.some(message => (message as { type: string }).type === "button"));
  for (const socket of fake.websocket.clients) socket.terminate();
  await waitFor(() => streams.connectionState(id) === "reconnecting");
  assert.throws(() => streams.input(id, [{ type: "button", button: "home" }]), /reconnecting/);
  let recovered;
  const deadline = Date.now() + 2000;
  while (!recovered && Date.now() < deadline) recovered = await streams.frame(id, first!.sequence);
  assert.equal(recovered?.sequence, first!.sequence + 1);
  assert.equal(streams.connectionState(id), "connected");
  assert.equal(fake.inputs.filter(message => (message as { type: string }).type === "button").length, 1);
  assert.equal(fake.requests.filter(request => request.path.includes("/stream")).length, 2);
});

test("pausing during reconnect prevents a late device check from reopening capture", async t => {
  const fake = await fakeBaguette();
  class GatedBaguette extends Baguette {
    gate?: Promise<void>;
    resumed = false;
    async device(udid: string, booted = false) {
      if (this.gate) await this.gate;
      const device = await super.device(udid, booted);
      this.resumed = true;
      return device;
    }
  }
  const baguette = new GatedBaguette(fake.url);
  const streams = new StreamSessions(baguette, [0]);
  t.after(async () => { streams.close(); await fake.close(); });
  const id = await streams.open(UDID, 30);
  const first = await streams.frame(id, 0);
  let release!: () => void;
  baguette.gate = new Promise<void>(resolve => { release = resolve; });
  baguette.resumed = false;
  for (const socket of fake.websocket.clients) socket.terminate();
  await waitFor(() => streams.connectionState(id) === "reconnecting");
  const pending = streams.frame(id, first!.sequence);
  streams.closeSession(id);
  await assert.rejects(pending, /stream closed/);
  release();
  await waitFor(() => baguette.resumed);
  assert.equal(fake.requests.filter(request => request.path.includes("/stream")).length, 1);
  assert.equal(fake.websocket.clients.size, 0);
});

test("reconnect reports a stopped device without booting it", async t => {
  const fake = await fakeBaguette();
  const streams = new StreamSessions(new Baguette(fake.url), [0]);
  t.after(async () => { streams.close(); await fake.close(); });
  const id = await streams.open(UDID, 30);
  const first = await streams.frame(id, 0);
  fake.setState("Shutdown");
  for (const socket of fake.websocket.clients) socket.terminate();
  await waitFor(() => streams.connectionState(id) === "reconnecting");
  await assert.rejects(streams.frame(id, first!.sequence), /simulator is stopped/);
  assert.equal(fake.requests.some(request => request.path.endsWith("/boot")), false);
});

test("a panel can resume after more than thirty seconds without losing its session", async t => {
  const fake = await fakeBaguette();
  const streams = new StreamSessions(new Baguette(fake.url));
  t.after(async () => { streams.close(); await fake.close(); });
  const id = await streams.open(UDID, 30);
  const first = await streams.frame(id, 0);
  const now = Date.now();
  t.mock.timers.enable({ apis: ["Date"], now });
  t.mock.timers.setTime(now + 45000);
  assert.equal((await streams.frame(id, 0))?.sequence, first!.sequence);
  t.mock.timers.setTime(now + 45000 + 5 * 60 * 1000 + 1);
  await assert.rejects(streams.frame(id, 0), /expired or closed/);
  t.mock.timers.reset();
});

async function waitFor(condition: () => boolean) {
  const deadline = Date.now() + 2000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for stream behavior.");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
