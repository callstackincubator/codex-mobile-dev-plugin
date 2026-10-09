import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate as tick } from "node:timers/promises";
import { IosMirrorHub } from "../src/server/ios-mirror-hub.ts";
import type { NativeBatch, NativeCapture, NativeTouchSample } from "../src/server/ios-native-capture.ts";

function fixture() {
  let opens = 0;
  let closes = 0;
  let resets = 0;
  let generation = 1;
  let waiting: ((batch: NativeBatch) => void) | undefined;
  const queued: NativeBatch[] = [];
  const touches: { samples: NativeTouchSample[]; generation: number }[] = [];
  const configuration = { revision: 1, width: 400, height: 800, codec: "hvc1.1.6.L150.B0", description: Buffer.from([1]) };
  const capture: NativeCapture = {
    read() {
      const batch = queued.shift();
      if (batch) return Promise.resolve(batch);
      return new Promise(resolve => { waiting = resolve; });
    },
    async touch(samples, nativeGeneration) { touches.push({ samples, generation: nativeGeneration }); },
    requestKeyframe() { resets++; },
    async close() { closes++; waiting?.({ generation, dropped: 0, frames: [] }); },
  };
  const hub = new IosMirrorHub(async () => { opens++; return capture; });
  async function frame(key = true, empty = false) {
    const frames = empty ? [] : [{ key, timestamp: 0, data: Buffer.from([generation]) }];
    const batch: NativeBatch = { generation, dropped: 0, configuration, frames };
    if (waiting) { const deliver = waiting; waiting = undefined; deliver(batch); }
    else queued.push(batch);
    await tick();
  }
  return { hub, capture, touches, frame, get opens() { return opens; }, get closes() { return closes; }, get resets() { return resets; } };
}

test("concurrent subscribers share one native capture and closing one keeps the other running", async t => {
  const f = fixture();
  t.after(() => f.hub.close());
  const [a, b] = await Promise.all([f.hub.open("phone"), f.hub.open("phone")]);
  assert.equal(f.opens, 1);
  await f.frame();
  const [first, second] = await Promise.all([a.read(), b.read()]);
  assert.equal(first.frames.length, 1);
  assert.deepEqual(first, second);
  assert.equal(first.configuration?.description, "AQ==");
  await a.close();
  assert.equal(f.closes, 0);
  await f.frame(false);
  const continued = await b.read();
  assert.equal(continued.frames.length, 1);
  assert.equal(continued.frames[0].sequence, first.frames[0].sequence + 1);
  await b.close();
  assert.equal(f.closes, 1);
});

test("slow subscriber overflow is bounded and requests recovery only when it reads again", async t => {
  const f = fixture();
  t.after(() => f.hub.close());
  const fast = await f.hub.open("phone");
  const slow = await f.hub.open("phone");
  await f.frame();
  const initial = await fast.read();
  const resets = f.resets;
  for (let index = 0; index < 24; index++) {
    await f.frame(false);
    const batch = await fast.read();
    assert.equal(batch.frames.length, 1);
    assert.equal(batch.generation, initial.generation);
  }
  assert.equal(f.resets, resets, "A panel that is not reading must not interrupt the healthy panel.");
  assert.ok(f.hub.snapshot().dropped > 0);
  const reading = slow.read();
  assert.equal(f.resets, resets + 1);
  await f.frame();
  const recovered = await reading;
  assert.ok(recovered.dropped > 0);
  assert.equal(recovered.frames.length, 1);
  assert.equal(recovered.frames[0].key, true);
  assert.equal(f.opens, 1);
  const resumed = await fast.read();
  assert.equal(resumed.frames[0].key, true);
  assert.equal(resumed.generation, initial.generation);
});

test("joining an active capture preserves the existing panel generation", async t => {
  const f = fixture();
  t.after(() => f.hub.close());
  const a = await f.hub.open("phone");
  await f.frame();
  const initial = await a.read();
  const b = await f.hub.open("phone");
  await f.frame();
  const [continued, joined] = await Promise.all([a.read(), b.read()]);
  assert.equal(continued.generation, initial.generation);
  assert.equal(joined.frames[0].key, true);
  assert.equal(f.opens, 1);
  assert.equal(f.closes, 0);
});

test("held gestures belong to one subscriber and disconnect releases its pointer", async t => {
  const f = fixture();
  t.after(() => f.hub.close());
  const a = await f.hub.open("phone");
  const b = await f.hub.open("phone");
  await f.frame();
  const first = await a.read();
  const second = await b.read();
  const down = [{ phase: 0, x: 10, y: 20, width: 400, height: 800 }];
  await a.touch(down, first.generation);
  await assert.rejects(b.touch(down, second.generation), /Another panel/);
  await a.close();
  assert.equal(f.touches.at(-1)?.samples[0].phase, 2);
  await b.touch(down, second.generation);
  assert.equal(f.touches.at(-1)?.samples[0].phase, 0);
});

test("joining and another subscriber's reset preserve a held gesture", async t => {
  const f = fixture();
  t.after(() => f.hub.close());
  const a = await f.hub.open("phone");
  await f.frame();
  const first = await a.read();
  await a.touch([{ phase: 0, x: 10, y: 20, width: 400, height: 800 }], first.generation);
  const b = await f.hub.open("phone");
  await b.reset();
  assert.equal(f.touches.length, 1);
  await a.touch([{ phase: 1, x: 20, y: 30, width: 400, height: 800 }], first.generation);
  assert.equal(f.touches.at(-1)?.samples[0].phase, 1);
  await a.reset();
  assert.equal(f.touches.at(-1)?.samples[0].phase, 2);
});

test("empty native reads during recovery coalesce keyframe requests", async t => {
  const f = fixture();
  t.after(() => f.hub.close());
  const a = await f.hub.open("phone");
  await f.frame();
  await a.read();
  const b = await f.hub.open("phone");
  const resets = f.resets;
  for (let index = 0; index < 4; index++) {
    const reads = [a.read(), b.read()];
    await f.frame(false, true);
    await Promise.all(reads);
    assert.equal(f.resets, resets);
  }
  await f.frame();
  const [first, second] = await Promise.all([a.read(), b.read()]);
  assert.equal(first.frames[0].key, true);
  assert.equal(second.frames[0].key, true);
});

test("closing a subscriber wakes pending reads and shutdown closes captures opened during startup", async () => {
  const f = fixture();
  const a = await f.hub.open("phone");
  const read = a.read();
  const rejection = assert.rejects(read, /closed/);
  await a.close();
  await rejection;
  await f.hub.close();
  let release!: (capture: NativeCapture) => void;
  const pending = new Promise<NativeCapture>(resolve => { release = resolve; });
  const hub = new IosMirrorHub(() => pending);
  const opening = hub.open("phone");
  await tick();
  const closed = hub.close();
  release(f.capture);
  await assert.rejects(opening, /closed/);
  await closed;
  assert.equal(f.closes, 2);
});

test("new subscribers wait for last native close before opening a replacement capture", async () => {
  const f = fixture();
  const a = await f.hub.open("phone");
  let release!: () => void;
  const originalClose = f.capture.close;
  f.capture.close = async () => { await new Promise<void>(resolve => { release = resolve; }); await originalClose(); };
  const closing = a.close();
  await tick();
  const opening = f.hub.open("phone");
  await tick();
  assert.equal(f.opens, 1);
  release();
  await closing;
  const b = await opening;
  assert.equal(f.opens, 2);
  f.capture.close = originalClose;
  await b.close();
  await f.hub.close();
});
