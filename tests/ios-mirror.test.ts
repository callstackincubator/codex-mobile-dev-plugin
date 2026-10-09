import test from "node:test";
import assert from "node:assert/strict";
import { IosMirrorSessions } from "../src/server/ios-mirror.ts";
import type { IosCapture, NativeTouchSample } from "../src/server/ios-native-capture.ts";

function fixture() {
  let closed = 0;
  let sequence = 0;
  let resets = 0;
  const touches: { samples: NativeTouchSample[]; generation: number }[] = [];
  const bytes = Buffer.from([0, 0, 0, 2, 0x26, 1]);
  const capture: IosCapture = {
    async read() { sequence++; return { generation: 1, sequence, dropped: 0, configuration: { revision: 1, width: 1216, height: 2656, codec: "hvc1.1.6.L150.B0", description: "AQ==" }, frames: [{ sequence, data: bytes.toString("base64"), timestamp: 0, key: true }] }; },
    async touch(samples, generation) { touches.push({ samples, generation }); },
    async reset() { resets++; }, async close() { closed++; },
  };
  const sessions = new IosMirrorSessions(async () => capture);
  return { sessions, capture, bytes, touches, get closed() { return closed; }, get resets() { return resets; } };
}

test("physical touches require the delivered video generation and serialize native writes", async t => {
  const f = fixture();
  t.after(() => f.sessions.close());
  const id = await f.sessions.open("phone");
  const messages = [{ type: "touch1-down", x: 200, y: 400, width: 400, height: 800 }] as const;
  const touch = [...messages];
  const premature = f.sessions.input(id, touch, 1);
  await assert.rejects(premature, /fresh physical iOS screen/);
  await f.sessions.batch(id);
  await f.sessions.input(id, touch, 1);
  assert.deepEqual(f.touches, [{ samples: [{ phase: 0, x: 200, y: 400, width: 400, height: 800 }], generation: 1 }]);
  let release!: () => void;
  f.capture.touch = () => new Promise<void>(resolve => { release = resolve; });
  const pending = f.sessions.input(id, touch, 1);
  const overlapping = f.sessions.input(id, touch, 1);
  await assert.rejects(overlapping, /already pending/);
  release();
  await pending;
  await f.sessions.reset(id);
  const stale = f.sessions.input(id, touch, 1);
  await assert.rejects(stale, /fresh physical iOS screen/);
});

test("physical mirroring preserves shared compressed batches and zero timestamps", async t => {
  const f = fixture();
  t.after(() => f.sessions.close());
  const id = await f.sessions.open("phone");
  const batch = await f.sessions.batch(id);
  assert.equal(batch.frames[0].timestamp, 0);
  assert.equal(batch.frames[0].data, f.bytes.toString("base64"));
  assert.equal(batch.frames[0].key, true);
  assert.equal(batch.configuration?.codec, "hvc1.1.6.L150.B0");
  const next = await f.sessions.batch(id);
  assert.equal(next.frames[0].sequence, 2);
  await f.sessions.reset(id);
  assert.equal(f.resets, 1);
  await f.sessions.closeSession(id);
  await f.sessions.closeSession(id);
  assert.equal(f.closed, 1);
  await assert.rejects(f.sessions.batch(id), /expired or closed/);
});

test("panels can subscribe to the same iPhone", async t => {
  const f = fixture();
  t.after(() => f.sessions.close());
  await f.sessions.open("phone");
  const id = await f.sessions.open("phone");
  assert.equal(typeof id, "string");
});

test("closing while native startup is pending still closes the new capture", async () => {
  let resolve!: (capture: IosCapture) => void;
  const pending = new Promise<IosCapture>(done => { resolve = done; });
  const f = fixture();
  await f.sessions.close();
  const sessions = new IosMirrorSessions(() => pending);
  const opening = sessions.open("phone");
  await sessions.close();
  resolve(f.capture);
  await assert.rejects(opening, /server has closed/);
  assert.equal(f.closed, 1);
});

test("reads are serialized and a closed session cannot return stale frames", async () => {
  const f = fixture();
  let resolve!: (value: Awaited<ReturnType<IosCapture["read"]>>) => void;
  const pending = new Promise<Awaited<ReturnType<IosCapture["read"]>>>(done => { resolve = done; });
  f.capture.read = () => pending;
  const id = await f.sessions.open("phone");
  const read = f.sessions.batch(id);
  await assert.rejects(f.sessions.batch(id), /already pending/);
  await f.sessions.closeSession(id);
  resolve({ generation: 1, sequence: 0, dropped: 0, frames: [] });
  await assert.rejects(read, /closed/);
  await f.sessions.close();
});
