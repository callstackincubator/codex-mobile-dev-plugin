import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { WebSocket } from "ws";
import { StreamSessions } from "../src/server/stream-sessions.ts";
import { Baguette } from "../src/server/baguette.ts";
import { fakeBaguette, fakeCertificate, fakeSimulatorInput, UDID, SCREEN, PNG } from "./fixtures.ts";

async function fixture(t: test.TestContext) {
  const fake = await fakeBaguette();
  const certificate = await fakeCertificate();
  const input = fakeSimulatorInput();
  const baguette = new Baguette(fake.url);
  const streams = new StreamSessions(baguette, input);
  const origin = await streams.start();
  t.after(async () => { await streams.close(); await fake.close(); });
  return { fake, certificate, input, streams, origin };
}

async function connect(streams: StreamSessions) {
  const session = await streams.open(UDID, 60);
  const socket = new WebSocket(session.url);
  const first = once(socket, "message");
  await once(socket, "open");
  const [frame, binary] = await first;
  assert.equal(binary, true);
  assert.deepEqual(frame, PNG);
  return { ...session, socket };
}

test("The internal relay carries binary frames and validated gestures; blocked input stays blocked", async t => {
  const { fake, certificate, input, streams } = await fixture(t);
  const session = await connect(streams);
  assert.ok(fake.requests.some(request => request.path.endsWith("/stream?format=avcc")));
  const gesture = { type: "touch1-down", x: 120, y: 300, ...SCREEN };
  const encoded = JSON.stringify(gesture);
  session.socket.send(encoded);
  await waitFor(() => fake.inputs.some(message => (message as { type: string }).type === "touch1-down"));
  assert.deepEqual(fake.inputs.at(-1), gesture);
  const rejected = once(session.socket, "message");
  session.socket.send('{"type":"run_shell","command":"whoami"}');
  const [rejection] = await rejected;
  assert.equal(JSON.parse(rejection.toString()).type, "error");
  assert.equal(fake.inputs.some(message => (message as { type: string }).type === "run_shell"), false);
  input.block();
  const blocked = once(session.socket, "message");
  session.socket.send('{"type":"button","button":"home"}');
  const [blockage] = await blocked;
  assert.equal(JSON.parse(blockage.toString()).inputBlocked, true);
  assert.equal(fake.inputs.some(message => (message as { type: string }).type === "button"), false);
  const closed = once(session.socket, "close");
  streams.closeSession(session.id);
  await closed;
  await waitFor(() => fake.websocket.clients.size === 0);
});

test("unknown, reused, and expired stream tokens cannot connect", async t => {
  const { certificate, streams, origin } = await fixture(t);
  async function denied(url: string) {
    const socket = new WebSocket(url);
    const [error] = await once(socket, "error");
    assert.match(error.message, /403/);
  }
  const unknown = "0".repeat(64);
  await denied(`${origin}/${unknown}`);
  const session = await connect(streams);
  await denied(session.url);
  const expired = await streams.open(UDID, 60);
  const now = Date.now();
  t.mock.timers.enable({ apis: ["Date"], now });
  t.mock.timers.setTime(now + 60001);
  await denied(expired.url);
  t.mock.timers.reset();
});

test("an upstream failure closes the browser; a new session recovers without replaying input", async t => {
  const { fake, certificate, streams } = await fixture(t);
  const first = await connect(streams);
  const closed = once(first.socket, "close");
  for (const socket of fake.websocket.clients) socket.terminate();
  await closed;
  const recovered = await connect(streams);
  assert.notEqual(recovered.id, first.id);
  streams.closeDevice(UDID);
  await waitFor(() => fake.websocket.clients.size === 0);
  fake.setState("Shutdown");
  await assert.rejects(streams.open(UDID, 60), /simulator is stopped/);
  assert.equal(fake.requests.some(request => request.path.endsWith("/boot")), false);
});

async function waitFor(condition: () => boolean) {
  const deadline = Date.now() + 2000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for stream behavior.");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
