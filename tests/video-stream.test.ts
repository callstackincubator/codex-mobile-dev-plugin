import test from "node:test";
import assert from "node:assert/strict";
import { VideoStream } from "../src/ui/video-stream.ts";

test("AVCC configures low latency H.264 and sends binary key and delta frames to WebCodecs", async t => {
  let socket: FakeSocket;
  let decoder: FakeDecoder;
  class FakeSocket {
    static OPEN = 1;
    readyState = 1;
    bufferedAmount = 0;
    binaryType = "";
    onmessage?: (event: { data: ArrayBuffer | string }) => void;
    onerror?: () => void;
    onclose?: () => void;
    sent: string[] = [];
    constructor() { socket = this; }
    send(message: string) { this.sent.push(message); }
    close() { this.readyState = 3; }
  }
  class FakeDecoder {
    state = "unconfigured";
    decodeQueueSize = 0;
    config?: Record<string, unknown>;
    chunks: { type: string; timestamp: number; data: Uint8Array }[] = [];
    constructor() { decoder = this; }
    configure(config: Record<string, unknown>) { this.config = config; this.state = "configured"; }
    decode(chunk: { type: string; timestamp: number; data: Uint8Array }) { this.chunks.push(chunk); }
    close() { this.state = "closed"; }
  }
  class FakeChunk {
    type: string;
    timestamp: number;
    data: Uint8Array;
    constructor(chunk: { type: string; timestamp: number; data: Uint8Array }) {
      this.type = chunk.type; this.timestamp = chunk.timestamp; this.data = chunk.data;
    }
  }
  const original = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of [["WebSocket", FakeSocket], ["VideoDecoder", FakeDecoder], ["EncodedVideoChunk", FakeChunk]]) {
    const key = String(name);
    original.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  t.after(() => {
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  const token = "a".repeat(64);
  let blocked = "";
  const video = new VideoStream(`wss://127.0.0.1:1234/${token}`, 60, { frame() {}, inputBlocked(message) { blocked = message; } });
  function packet(bytes: number[]) {
    const data = new Uint8Array(bytes);
    socket.onmessage?.({ data: data.buffer });
  }
  packet([1, 1, 0x64, 0, 0x28, 0xff]);
  assert.equal(decoder.config?.codec, "avc1.640028");
  assert.equal(decoder.config?.optimizeForLatency, true);
  packet([4, 0xff, 0xd8]);
  assert.equal(decoder.chunks.length, 0);
  packet([2, 0, 0, 0, 1, 0x65]);
  packet([3, 0, 0, 0, 1, 0x41]);
  assert.deepEqual(decoder.chunks.map(chunk => chunk.type), ["key", "delta"]);
  assert.equal(decoder.chunks[1].timestamp, 1_000_000 / 60);
  socket.onmessage?.({ data: '{"type":"error","inputBlocked":true,"error":"Device Hub"}' });
  assert.equal(blocked, "Device Hub");
  video.send({ type: "button", button: "home" });
  assert.deepEqual(socket.sent, ['{"type":"button","button":"home"}']);
  const failed = assert.rejects(video.finished, /unknown video packet/);
  packet([99, 1]);
  await failed;
  assert.equal(socket.readyState, 3);
  assert.equal(decoder.state, "closed");
});
