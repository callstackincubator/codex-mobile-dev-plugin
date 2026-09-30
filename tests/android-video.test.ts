import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { AndroidVideo, videoPacket } from "../src/ui/android-video.ts";

const key = Buffer.from([0, 0, 0, 1, 0x67, 0x64, 0, 0x28, 0, 0, 0, 1, 0x65, 1]);
const delta = Buffer.from([0, 0, 0, 1, 0x41, 1]);
const batch = (data: Buffer, generation = 1) => ({ generation, sequence: 1, packets: [{ sequence: 1, data: data.toString("base64") }] });

function fixture(t: TestContext) {
  let now = 0;
  let requests = 0;
  let recoveries = 0;
  let outputs = 0;
  const decoders: FakeDecoder[] = [];
  class FakeDecoder {
    state = "unconfigured";
    decodeQueueSize = 0;
    chunks: { type: string; timestamp: number }[] = [];
    failDecode = false;
    autoDrain = false;
    callbacks: { output: (frame: unknown) => void; error: (error: Error) => void };
    constructor(callbacks: FakeDecoder["callbacks"]) { this.callbacks = callbacks; decoders.push(this); }
    configure() { this.state = "configured"; }
    decode(chunk: { type: string; timestamp: number }) { if (this.failDecode) throw new Error("Decode failed"); this.chunks.push(chunk); if (this.autoDrain) { this.decodeQueueSize++; setTimeout(() => { this.decodeQueueSize = 0; }, 0); } }
    close() { this.state = "closed"; }
  }
  class FakeChunk { constructor(options: object) { Object.assign(this, options); } }
  for (const [name, value] of [["VideoDecoder", FakeDecoder], ["EncodedVideoChunk", FakeChunk]] as const) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true });
    t.after(() => { if (previous) Object.defineProperty(globalThis, name, previous); else Reflect.deleteProperty(globalThis, name); });
  }
  t.mock.method(performance, "now", () => now);
  const video = new AndroidVideo(() => { outputs++; }, () => { requests++; }, () => { recoveries++; });
  t.after(() => video.close());
  return { video, decoders, get requests() { return requests; }, get recoveries() { return recoveries; }, get outputs() { return outputs; }, advance() { now += 1001; } };
}

test("Android decoding requests a keyframe and skips delta frames until it arrives", async t => {
  const fake = fixture(t);
  await fake.video.accept(batch(delta)); await fake.video.accept(batch(delta));
  assert.equal(fake.requests, 1); assert.equal(fake.decoders.length, 0);
  await fake.video.accept(batch(key));
  assert.equal(fake.decoders[0].chunks[0].type, "key");
  await fake.video.accept(batch(delta));
  assert.equal(fake.decoders[0].chunks[1].type, "delta");
});

test("decoder backlog recovers on a fresh keyframe without reconnecting", async t => {
  const fake = fixture(t); await fake.video.accept(batch(key));
  fake.decoders[0].decodeQueueSize = 9;
  await fake.video.accept(batch(delta));
  assert.equal(fake.recoveries, 1); assert.equal(fake.requests, 1);
  assert.equal(fake.decoders[0].state, "closed");
  await fake.video.accept(batch(delta)); assert.equal(fake.decoders.length, 1);
  await fake.video.accept(batch(key)); assert.equal(fake.decoders.length, 2);
  assert.equal(fake.decoders[1].chunks[0].type, "key");
});

test("synchronous and asynchronous decoder errors request recovery with a cooldown", async t => {
  const fake = fixture(t); await fake.video.accept(batch(key));
  fake.decoders[0].failDecode = true;
  await assert.doesNotReject(fake.video.accept(batch(delta)));
  assert.equal(fake.requests, 1);
  await fake.video.accept(batch(key));
  fake.decoders[1].callbacks.error(new Error("Decoder lost state"));
  assert.equal(fake.recoveries, 2); assert.equal(fake.requests, 1);
  fake.advance(); await fake.video.accept(batch(delta)); assert.equal(fake.requests, 2);
});

test("video generation changes and panel close suppress old decoder output", async t => {
  const fake = fixture(t); await fake.video.accept(batch(key));
  const previous = fake.decoders[0]; await fake.video.accept(batch(key, 2));
  let closedFrames = 0;
  const frame = { close() { closedFrames++; } };
  previous.callbacks.output(frame);
  assert.equal(fake.outputs, 0); assert.equal(closedFrames, 1);
  const current = fake.decoders[1]; current.callbacks.output(frame); assert.equal(fake.outputs, 1);
  fake.video.close(); current.callbacks.error(new Error("Late error")); current.callbacks.output(frame);
  await fake.video.accept(batch(key));
  assert.equal(fake.outputs, 1); assert.equal(closedFrames, 3); assert.equal(fake.requests, 0);
});

test("zero video timestamps stay zero and malformed headers request recovery", async t => {
  const header = Buffer.alloc(24); header.write("SEMU"); header[4] = 2;
  const fake = fixture(t); await fake.video.accept(batch(Buffer.concat([header, key])));
  assert.equal(fake.decoders[0].chunks[0].timestamp, 0);
  assert.throws(() => videoPacket(Buffer.from("SEMU")), /Invalid Android video header/);
  await assert.doesNotReject(fake.video.accept(batch(Buffer.from("SEMU"))));
  assert.equal(fake.requests, 1);
});

test("MCP video batches yield so a healthy decoder can drain its queue", async t => {
  const fake = fixture(t); await fake.video.accept(batch(key));
  fake.decoders[0].autoDrain = true;
  const packets = Array.from({ length: 16 }, (_, index) => ({ sequence: index + 2, data: delta.toString("base64") }));
  await fake.video.accept({ generation: 1, sequence: 17, packets });
  assert.equal(fake.requests, 0); assert.equal(fake.recoveries, 0);
  assert.equal(fake.decoders[0].chunks.length, 17);
});

test("closing during a video batch stops the remaining packets", async t => {
  const fake = fixture(t); await fake.video.accept(batch(key));
  const packets = Array.from({ length: 16 }, (_, index) => ({ sequence: index + 2, data: delta.toString("base64") }));
  const feeding = fake.video.accept({ generation: 1, sequence: 17, packets });
  fake.video.close(); await feeding;
  assert.equal(fake.decoders[0].chunks.length, 5);
  assert.equal(fake.requests, 0);
});
