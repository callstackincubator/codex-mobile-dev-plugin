import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate as tick } from "node:timers/promises";
import { ExpectedOperationError } from "../../shared/src/error-reporting.ts";
import { IosMirrorSessions } from "../src/ios-mirror.ts";
import { IosMirrorHub } from "../src/ios-mirror-hub.ts";
import type { IosCapture, NativeBatch, NativeCapture, NativeTouchSample } from "../src/ios-native-capture.ts";

// Panels subscribe through the shared hub, which owns the read and input gates.
function fixture() {
  let closed = 0;
  let resets = 0;
  let waiting: ((batch: NativeBatch) => void) | undefined;
  const queued: NativeBatch[] = [];
  const touches: { samples: NativeTouchSample[]; generation: number }[] = [];
  const bytes = Buffer.from([0, 0, 0, 2, 0x26, 1]);
  const configuration = { revision: 1, width: 1216, height: 2656, codec: "hvc1.1.6.L150.B0", description: Buffer.from([1]) };
  const capture: NativeCapture = {
    read() {
      const batch = queued.shift();
      if (batch) return Promise.resolve(batch);
      return new Promise(resolve => { waiting = resolve; });
    },
    async touch(samples, generation) { touches.push({ samples, generation }); },
    requestKeyframe() { resets++; },
    async close() { closed++; waiting?.({ generation: 1, dropped: 0, frames: [] }); },
  };
  const hub = new IosMirrorHub(async () => capture);
  const sessions = new IosMirrorSessions(udid => hub.open(udid));
  async function frame() {
    const batch: NativeBatch = { generation: 1, dropped: 0, configuration, frames: [{ key: true, timestamp: 0, data: bytes }] };
    if (waiting) { const deliver = waiting; waiting = undefined; deliver(batch); }
    else queued.push(batch);
    await tick();
  }
  return { sessions, hub, capture, bytes, touches, frame, get closed() { return closed; }, get resets() { return resets; } };
}

const expected = (outcome: string, message: RegExp) => (error: unknown) => error instanceof ExpectedOperationError && error.outcome === outcome && message.test(error.message);

test("physical touches require the delivered video generation and serialize native writes", async t => {
  const f = fixture();
  t.after(async () => { await f.sessions.close(); await f.hub.close(); });
  const id = await f.sessions.open("phone");
  const touch = [{ type: "touch1-down", x: 200, y: 400, width: 400, height: 800 }] as const;
  await assert.rejects(f.sessions.input(id, [...touch], 1), expected("device_unavailable", /fresh physical iOS screen/));
  await f.frame();
  const batch = await f.sessions.batch(id);
  await f.sessions.input(id, [...touch], batch.generation);
  assert.deepEqual(f.touches, [{ samples: [{ phase: 0, x: 200, y: 400, width: 400, height: 800 }], generation: 1 }]);
  const send = f.capture.touch;
  let release!: () => void;
  f.capture.touch = () => new Promise<void>(resolve => { release = resolve; });
  const pending = f.sessions.input(id, [...touch], batch.generation);
  await assert.rejects(f.sessions.input(id, [...touch], batch.generation), /already pending/);
  await tick();
  release();
  await pending;
  f.capture.touch = send;
  await f.sessions.reset(id);
  await assert.rejects(f.sessions.input(id, [...touch], batch.generation), /fresh physical iOS screen/);
});

test("physical mirroring preserves shared compressed batches and zero timestamps", async t => {
  const f = fixture();
  t.after(() => f.hub.close());
  const id = await f.sessions.open("phone");
  await f.frame();
  const batch = await f.sessions.batch(id);
  assert.equal(batch.frames[0].timestamp, 0);
  assert.equal(batch.frames[0].data, f.bytes.toString("base64"));
  assert.equal(batch.frames[0].key, true);
  assert.equal(batch.configuration?.codec, "hvc1.1.6.L150.B0");
  await f.frame();
  const next = await f.sessions.batch(id);
  assert.equal(next.frames[0].sequence, 2);
  const resets = f.resets;
  await f.sessions.reset(id);
  assert.equal(f.resets, resets + 1);
  await f.sessions.closeSession(id);
  await f.sessions.closeSession(id);
  assert.equal(f.closed, 1);
  await assert.rejects(f.sessions.batch(id), expected("session_expired", /expired or closed/));
});

test("panels can subscribe to the same iPhone", async t => {
  const f = fixture();
  t.after(async () => { await f.sessions.close(); await f.hub.close(); });
  await f.sessions.open("phone");
  const id = await f.sessions.open("phone");
  assert.equal(typeof id, "string");
});

test("closing while native startup is pending still closes the new capture", async () => {
  let resolve!: (capture: IosCapture) => void;
  const pending = new Promise<IosCapture>(done => { resolve = done; });
  let closes = 0;
  const capture: IosCapture = { async read() { throw new Error("unused"); }, async touch() {}, async reset() {}, async close() { closes++; } };
  const sessions = new IosMirrorSessions(() => pending);
  const opening = sessions.open("phone");
  await sessions.close();
  resolve(capture);
  await assert.rejects(opening, /server has closed/);
  assert.equal(closes, 1);
});

test("reads are serialized and a closed session cannot return stale frames", async () => {
  const f = fixture();
  const id = await f.sessions.open("phone");
  const read = f.sessions.batch(id);
  const rejected = assert.rejects(read, expected("session_closed", /closed/));
  await assert.rejects(f.sessions.batch(id), expected("resource_limit", /already pending/));
  await f.sessions.closeSession(id);
  await rejected;
  await f.sessions.close();
  await f.hub.close();
});
