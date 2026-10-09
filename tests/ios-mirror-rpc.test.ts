import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createConnection } from "node:net";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { IosMirrorHub } from "../src/server/ios-mirror-hub.ts";
import { createIosMirrorServer } from "../src/server/ios-mirror-server.ts";
import { connectIosCapture } from "../src/server/ios-mirror-client.ts";
import type { NativeCapture } from "../src/server/ios-native-capture.ts";

async function message(child: ChildProcess) {
  const result = await once(child, "message", { signal: AbortSignal.timeout(5000) });
  return result[0];
}

test("independent client processes share capture and a crashed client leaves its peer streaming", async t => {
  let opens = 0;
  let closes = 0;
  const hub = new IosMirrorHub(async () => {
    opens++;
    let generation = 1;
    let closed = false;
    const capture: NativeCapture = {
      async read() {
        await delay(10);
        return { generation, dropped: 0, configuration: { revision: 1, width: 400, height: 800, codec: "hvc1.1.6.L150.B0", description: Buffer.from([1]) }, frames: closed ? [] : [{ key: true, timestamp: 0, data: Buffer.from([1, 2, 3]) }] };
      },
      async touch() {}, requestKeyframe() {}, async close() { closed = true; closes++; },
    };
    return capture;
  });
  const service = createIosMirrorServer(hub, () => {}, () => {});
  const path = `/tmp/mobile-dev-mirror-test-${randomUUID()}.sock`;
  service.server.listen(path);
  await once(service.server, "listening");
  t.after(() => service.close());
  const worker = fileURLToPath(new URL("./fixtures/ios-mirror-client.ts", import.meta.url));
  const a = fork(worker, [path], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  const b = fork(worker, [path], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  t.after(() => { a.kill(); b.kill(); });
  await Promise.all([message(a), message(b)]);
  assert.equal(opens, 1);
  assert.equal(hub.snapshot().subscribers, 2);
  const first = message(a);
  const second = message(b);
  a.send("read"); b.send("read");
  const batches = await Promise.all([first, second]);
  for (const response of batches) {
    assert.equal(response.error, undefined);
    assert.ok(response.batch.frames.length > 0);
    assert.equal(response.batch.frames[0].data, "AQID");
  }
  a.kill("SIGKILL");
  await once(a, "exit");
  const deadline = Date.now() + 2000;
  while (hub.snapshot().subscribers !== 1 && Date.now() < deadline) await delay(10);
  assert.equal(hub.snapshot().subscribers, 1);
  assert.equal(closes, 0);
  const continued = message(b);
  b.send("read");
  const response = await continued;
  assert.ok(response.batch.frames.length > 0);
  const exiting = once(b, "exit");
  b.send("close");
  await exiting;
  assert.equal(closes, 1);
});

test("disconnect during native startup closes the eventual subscription", async t => {
  let release!: (capture: NativeCapture) => void;
  let started!: () => void;
  let closes = 0;
  const startup = new Promise<void>(resolve => { started = resolve; });
  const hub = new IosMirrorHub(() => { started(); return new Promise(resolve => { release = resolve; }); });
  const service = createIosMirrorServer(hub, () => {}, () => {});
  const path = `/tmp/mobile-dev-mirror-test-${randomUUID()}.sock`;
  service.server.listen(path);
  await once(service.server, "listening");
  t.after(() => service.close());
  const socket = createConnection(path);
  await once(socket, "connect");
  socket.write('{"id":1,"method":"open","udid":"phone"}\n');
  await startup;
  socket.destroy();
  await once(socket, "close");
  let finishRead!: () => void;
  release({
    read: () => new Promise(resolve => { finishRead = () => resolve({ generation: 1, dropped: 0, frames: [] }); }),
    async touch() {}, requestKeyframe() {}, async close() { closes++; finishRead(); },
  });
  const deadline = Date.now() + 2000;
  while (closes === 0 && Date.now() < deadline) await delay(10);
  assert.equal(closes, 1);
  assert.equal(hub.snapshot().captures, 0);
});

test("service shutdown rejects pending video reads and releases its capture", async t => {
  let finishRead!: () => void;
  let closes = 0;
  const hub = new IosMirrorHub(async () => ({
    read: () => new Promise(resolve => { finishRead = () => resolve({ generation: 1, dropped: 0, frames: [] }); }),
    async touch() {}, requestKeyframe() {}, async close() { closes++; finishRead(); },
  }));
  const service = createIosMirrorServer(hub, () => {}, () => {});
  const path = `/tmp/mobile-dev-mirror-test-${randomUUID()}.sock`;
  service.server.listen(path);
  await once(service.server, "listening");
  const capture = await connectIosCapture(path, "phone");
  t.after(() => capture.close());
  const reading = capture.read();
  const rejection = assert.rejects(reading, /disconnected/);
  await service.close();
  await rejection;
  assert.equal(closes, 1);
});
