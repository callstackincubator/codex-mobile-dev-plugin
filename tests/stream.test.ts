import test from "node:test";
import assert from "node:assert/strict";
import { StreamSessions } from "../src/server/stream-sessions.ts";
import { Baguette } from "../src/server/baguette.ts";
import { fakeBaguette, UDID, SCREEN, JPEG } from "./fixtures.ts";

async function fixture(t: test.TestContext) {
  const fake = await fakeBaguette();
  const baguette = new Baguette(fake.url);
  const streams = new StreamSessions(baguette);
  t.after(async () => { streams.close(); await fake.close(); });
  return { fake, streams };
}

async function waitFor(condition: () => boolean) {
  const deadline = Date.now() + 2000;
  while (condition() === false) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for stream behavior.");
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

test("capture requests 60 FPS and serves only the newest independent frame", async t => {
  const { fake, streams } = await fixture(t);
  const id = await streams.open(UDID, 60);
  const first = await streams.frame(id, 0);
  assert.deepEqual(Buffer.from(first.frame!.data, "base64"), JPEG);
  assert.ok(fake.requests.some(request => request.path.endsWith("/stream?format=mjpeg")));
  assert.ok(fake.inputs.some(message => JSON.stringify(message) === '{"type":"set_fps","fps":60}'));
  const newer = Buffer.from([0xff, 0xd8, 2, 0xff, 0xd9]);
  fake.frame();
  fake.frame(newer);
  await new Promise(resolve => setTimeout(resolve, 10));
  const latest = await streams.frame(id, first.frame!.sequence);
  assert.equal(latest.frame!.sequence, first.frame!.sequence + 2);
  assert.deepEqual(Buffer.from(latest.frame!.data, "base64"), newer);
  assert.equal(latest.frame!.bytes, newer.length);
  assert.ok(latest.frame!.receivedAt > 0);
  assert.ok(latest.serverWaitMs >= 0);
  assert.ok(latest.serverStartedAt > 0);
  assert.ok(latest.serverPreparedAt >= latest.serverStartedAt);
});

test("waiting reads wake on a new frame, cancellation, and session closure", async t => {
  const { fake, streams } = await fixture(t);
  const id = await streams.open(UDID, 60);
  const first = await streams.frame(id, 0);
  const waiting = streams.frame(id, first.frame!.sequence);
  fake.frame();
  const next = await waiting;
  assert.equal(next.frame!.sequence, first.frame!.sequence + 1);
  const controller = new AbortController();
  const cancelled = streams.frame(id, next.frame!.sequence, controller.signal);
  const rejected = assert.rejects(cancelled, /abort/i);
  controller.abort();
  await rejected;
  const closing = streams.frame(id, next.frame!.sequence);
  const closed = assert.rejects(closing, /expired or closed/);
  streams.closeSession(id);
  await closed;
  await waitFor(() => fake.websocket.clients.size === 0);
});

test("invalid and expired sessions cannot return frames or send gestures", async t => {
  const { streams } = await fixture(t);
  await assert.rejects(streams.frame("0".repeat(64), 0), /expired or closed/);
  const id = await streams.open(UDID, 60);
  await streams.frame(id, 0);
  assert.throws(() => streams.input(id, [{ type: "run_shell", command: "whoami" }]));
  const now = Date.now();
  t.mock.timers.enable({ apis: ["Date"], now });
  t.mock.timers.setTime(now + 300001);
  await assert.rejects(streams.frame(id, 0), /expired or closed/);
  assert.throws(() => streams.input(id, [{ type: "button", button: "home" }]), /expired or closed/);
  t.mock.timers.reset();
});

test("gestures preserve order and a failed capture recovers through a fresh session", async t => {
  const { fake, streams } = await fixture(t);
  const first = await streams.open(UDID, 60);
  const frame = await streams.frame(first, 0);
  const down = { type: "touch1-down", x: 120, y: 300, ...SCREEN };
  const up = { type: "touch1-up", x: 150, y: 300, ...SCREEN };
  const sent = streams.input(first, [down, up]);
  assert.equal(await sent, 2);
  await waitFor(() => fake.inputs.some(message => JSON.stringify(message) === JSON.stringify(up)));
  assert.deepEqual(fake.inputs.slice(-2), [down, up]);
  const waiting = streams.frame(first, frame.frame!.sequence);
  const disconnected = assert.rejects(waiting, /disconnected/);
  for (const socket of fake.websocket.clients) socket.terminate();
  await disconnected;
  streams.closeSession(first);
  const recovered = await streams.open(UDID, 60);
  assert.notEqual(recovered, first);
  assert.ok((await streams.frame(recovered, 0)).frame);
  assert.equal(fake.inputs.filter(message => JSON.stringify(message) === JSON.stringify(down)).length, 1);
  streams.closeDevice(UDID);
  await waitFor(() => fake.websocket.clients.size === 0);
  fake.setState("Shutdown");
  await assert.rejects(streams.open(UDID, 60), /simulator is stopped/);
  assert.equal(fake.requests.some(request => request.path.endsWith("/boot")), false);
});
