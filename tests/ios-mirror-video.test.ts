import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { PhysicalIosVideo } from "../src/ui/ios-mirror-video.ts";
import type { IosVideoBatch } from "../src/shared/ios-video.ts";

const configuration = { revision: 1, width: 1216, height: 2656, codec: "hvc1.1.6.L150.B0", description: "AQ==" };
const batch = (key = true, generation = 1): IosVideoBatch => ({ generation, sequence: 1, dropped: 0, configuration, frames: [{ sequence: 1, key, timestamp: 0, data: "AA==" }] });

function fixture(t: TestContext) {
  let requests = 0;
  let outputs = 0;
  let releases = 0;
  let supported = true;
  const decoders: Decoder[] = [];
  class Decoder {
    state = "configured";
    decodeQueueSize = 0;
    chunks: { type: string; timestamp: number }[] = [];
    callbacks: { output: (frame: VideoFrame) => void; error: (error: Error) => void };
    static async isConfigSupported() { return { supported }; }
    constructor(callbacks: Decoder["callbacks"]) { this.callbacks = callbacks; decoders.push(this); }
    configure() {}
    decode(chunk: { type: string; timestamp: number }) { this.chunks.push(chunk); }
    close() { this.state = "closed"; }
    output() { this.callbacks.output({ close() { releases++; } } as VideoFrame); }
  }
  class Chunk { constructor(value: object) { Object.assign(this, value); } }
  for (const [name, value] of [["VideoDecoder", Decoder], ["EncodedVideoChunk", Chunk]] as const) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true });
    t.after(() => { if (previous) Object.defineProperty(globalThis, name, previous); else Reflect.deleteProperty(globalThis, name); });
  }
  const video = new PhysicalIosVideo(() => { outputs++; }, () => { requests++; });
  t.after(() => video.close());
  return { video, decoders, unsupported() { supported = false; }, get requests() { return requests; }, get outputs() { return outputs; }, get releases() { return releases; } };
}

test("HEVC decoding preserves timestamps and closes every output frame", async t => {
  const f = fixture(t);
  await f.video.accept(batch());
  assert.equal(f.decoders[0].chunks[0].timestamp, 0);
  f.decoders[0].output();
  assert.equal(f.outputs, 1);
  assert.equal(f.releases, 1);
  f.video.close();
  f.decoders[0].output();
  assert.equal(f.outputs, 1);
  assert.equal(f.releases, 2);
});

test("generation changes close the old HEVC decoder and discard stale output", async t => {
  const f = fixture(t);
  await f.video.accept(batch());
  const old = f.decoders[0];
  await f.video.accept(batch(true, 2));
  assert.equal(old.state, "closed");
  old.output();
  assert.equal(f.outputs, 0);
  f.decoders[1].output();
  assert.equal(f.outputs, 1);
});

test("HEVC decoder backlog requests a keyframe with a bounded queue", async t => {
  const f = fixture(t);
  await f.video.accept(batch());
  f.decoders[0].decodeQueueSize = 8;
  await f.video.accept(batch(false));
  assert.equal(f.decoders[0].state, "closed");
  assert.equal(f.requests, 1);
});

test("unsupported HEVC fails explicitly before decoding", async t => {
  const f = fixture(t);
  f.unsupported();
  await assert.rejects(f.video.accept(batch()), /cannot decode the iPhone/);
  assert.equal(f.decoders.length, 0);
});
