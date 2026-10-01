import test from "node:test";
import assert from "node:assert/strict";
import { IosMirrorSessions } from "../src/server/ios-mirror.ts";
import type { NativeCapture } from "../src/server/ios-mirror.ts";

function fixture() {
  let closed = 0;
  let resets = 0;
  const bytes = Buffer.from([0, 0, 0, 2, 0x26, 1]);
  const capture: NativeCapture = {
    async read() { return { generation: 1, dropped: 0, configuration: { revision: 1, width: 1216, height: 2656, codec: "hvc1.1.6.L150.B0", description: Buffer.from([1]) }, frames: [{ data: bytes, timestamp: 0, key: true }] }; },
    reset() { resets++; }, async close() { closed++; },
  };
  const sessions = new IosMirrorSessions(async () => capture);
  return { sessions, capture, bytes, get closed() { return closed; }, get resets() { return resets; } };
}

test("physical mirroring serializes compressed native buffers and preserves zero timestamps", async t => {
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
  f.sessions.reset(id);
  assert.equal(f.resets, 1);
  await f.sessions.closeSession(id);
  await f.sessions.closeSession(id);
  assert.equal(f.closed, 1);
  await assert.rejects(f.sessions.batch(id), /expired or closed/);
});

test("a panel cannot open competing sessions for the same iPhone", async t => {
  const f = fixture();
  t.after(() => f.sessions.close());
  await f.sessions.open("phone");
  await assert.rejects(f.sessions.open("phone"), /already has a mirroring session/);
});

test("closing while native startup is pending still closes the new capture", async () => {
  let resolve!: (capture: NativeCapture) => void;
  const pending = new Promise<NativeCapture>(done => { resolve = done; });
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
  let resolve!: (value: Awaited<ReturnType<NativeCapture["read"]>>) => void;
  const pending = new Promise<Awaited<ReturnType<NativeCapture["read"]>>>(done => { resolve = done; });
  f.capture.read = () => pending;
  const id = await f.sessions.open("phone");
  const read = f.sessions.batch(id);
  await assert.rejects(f.sessions.batch(id), /already pending/);
  await f.sessions.closeSession(id);
  resolve({ generation: 1, dropped: 0, frames: [] });
  await assert.rejects(read, /closed/);
  await f.sessions.close();
});
