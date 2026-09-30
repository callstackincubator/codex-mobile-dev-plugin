import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { WebSocket } from "ws";
import { Baguette } from "../src/server/baguette.ts";
import { StreamSessions } from "../src/server/stream-sessions.ts";
import { SharedStreamService, startStreamService } from "../src/server/shared-stream-service.ts";
import { fakeBaguette, fakeCertificate, fakeSimulatorInput, fakeStreamingService, PNG, UDID, SCREEN } from "./fixtures.ts";

async function waitFor(condition: () => boolean) {
  const deadline = Date.now() + 3000;
  while (condition() === false) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for streaming cleanup.");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

test("shared WSS routes two owners' binary frames and gestures; owner shutdown is isolated", async t => {
  const service = await fakeStreamingService();
  const certificate = await fakeCertificate();
  const fake = await fakeBaguette();
  const first = service.client();
  const second = service.client();
  const input = fakeSimulatorInput();
  const workers = [new StreamSessions(new Baguette(fake.url), input), new StreamSessions(new Baguette(fake.url), input)];
  t.after(async () => {
    await first.close(); await second.close();
    for (const worker of workers) await worker.close();
    await service.close(); await fake.close();
  });
  for (const worker of workers) await worker.start();
  await Promise.all([first.configureTls(certificate), second.configureTls(certificate)]);
  async function connect(owner: SharedStreamService, worker: StreamSessions) {
    const session = await worker.open(UDID, 60);
    const url = await owner.publish(session.id, session.url);
    const endpoint = new URL(url);
    assert.equal(endpoint.origin, service.origin);
    const browser = new WebSocket(url, { ca: certificate.cert });
    const frame = once(browser, "message");
    await once(browser, "open");
    const [bytes, binary] = await frame;
    assert.equal(binary, true);
    assert.deepEqual(bytes, PNG);
    return { session, browser, url };
  }
  const a = await connect(first, workers[0]);
  const b = await connect(second, workers[1]);
  await first.closeSession(b.session.id);
  assert.equal(b.browser.readyState, WebSocket.OPEN);
  const gesture = { type: "touch1-down", x: 120, y: 300, ...SCREEN };
  const encoded = JSON.stringify(gesture);
  b.browser.send(encoded);
  await waitFor(() => fake.inputs.some(message => (message as { type: string }).type === "touch1-down"));
  assert.deepEqual(fake.inputs.at(-1), gesture);
  const invalid = once(b.browser, "message");
  b.browser.send('{"type":"run_shell","command":"whoami"}');
  const [invalidMessage] = await invalid;
  const invalidResult = JSON.parse(invalidMessage.toString());
  assert.equal(invalidResult.type, "error");
  input.block();
  const blocked = once(b.browser, "message");
  b.browser.send('{"type":"button","button":"home"}');
  const [blockedMessage] = await blocked;
  const blockedResult = JSON.parse(blockedMessage.toString());
  assert.equal(blockedResult.inputBlocked, true);
  const closed = once(a.browser, "close");
  await first.close();
  await closed;
  assert.equal(b.browser.readyState, WebSocket.OPEN);
  await waitFor(() => fake.websocket.clients.size === 1);
  const denied = new WebSocket(a.url, { ca: certificate.cert });
  const [error] = await once(denied, "error");
  assert.match(error.message, /403/);
  await second.closeSession(b.session.id);
  await waitFor(() => fake.websocket.clients.size === 0);
});

test("a competing service cannot change the port or remove the running service's control socket", async t => {
  const service = await fakeStreamingService();
  const certificate = await fakeCertificate();
  const client = service.client();
  t.after(async () => { await client.close(); await service.close(); });
  const endpoint = new URL(service.origin);
  const port = Number(endpoint.port);
  await assert.rejects(startStreamService({ socketPath: service.socketPath, port }), { code: "EADDRINUSE" });
  await client.configureTls(certificate);
  await assert.rejects(client.publish("0".repeat(64), "ws://example.com/token"), /Invalid local streaming target/);
});

test("service restart reuses the same origin and clients reconnect through a stale control socket", async t => {
  const service = await fakeStreamingService();
  const certificate = await fakeCertificate();
  const endpoint = new URL(service.origin);
  const port = Number(endpoint.port);
  const client = service.client();
  await client.configureTls(certificate);
  await service.close();
  await new Promise(resolve => setTimeout(resolve, 20));
  const directory = dirname(service.socketPath);
  await mkdir(directory, { recursive: true });
  const script = 'import { createServer } from "node:net"; const server = createServer(); server.listen(process.argv[1], () => { process.stdout.write("ready"); });';
  const staleOwner = spawn(process.execPath, ["--input-type=module", "-e", script, service.socketPath], { stdio: ["ignore", "pipe", "inherit"] });
  await once(staleOwner.stdout, "data");
  const exited = once(staleOwner, "exit");
  staleOwner.kill("SIGKILL");
  await exited;
  let restarted: Awaited<ReturnType<typeof startStreamService>> | undefined;
  const replacement = new SharedStreamService({
    socketPath: service.socketPath, origin: service.origin,
    launch() { void startStreamService({ socketPath: service.socketPath, port }).then(value => { restarted = value; }); },
  });
  t.after(async () => { await client.close(); await replacement.close(); await restarted?.close(); await service.close(); });
  await replacement.configureTls(certificate);
  assert.equal(restarted?.origin, service.origin);
});
