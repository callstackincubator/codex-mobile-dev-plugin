import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { FrameStream, decodeJpeg } from "../src/ui/frame-stream.ts";
import type { Bitmap } from "../src/ui/frame-stream.ts";
import type { ObservedRead } from "../src/ui/frame-stream.ts";
import { epochNow } from "../src/shared/stream.ts";
import { readFrame } from "../src/ui/read-frame.ts";
import { StopReconnectError } from "../src/ui/reconnect.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}

type TestBitmap = Bitmap & { sequence: number };

function fixture(decode: (sequence: number) => Promise<TestBitmap>, paint?: (bitmap: TestBitmap) => void) {
  const reads: { after: number; reply: ReturnType<typeof deferred<ObservedRead>> }[] = [];
  const paints = new Map<number, () => void>();
  const controller = new AbortController();
  const painted: number[] = [];
  let paintId = 0;
  const stream = new FrameStream<TestBitmap>({
    read(after, signal) {
      const reply = deferred<ObservedRead>();
      reads.push({ after, reply });
      const abort = () => { reply.reject(new Error("Read aborted")); };
      signal.addEventListener("abort", abort, { once: true });
      return reply.promise.finally(() => { signal.removeEventListener("abort", abort); });
    },
    decode(data) { return decode(Number(data)); },
    paint(bitmap) { painted.push(bitmap.sequence); paint?.(bitmap); },
    requestPaint(callback) { paints.set(++paintId, callback); return paintId; },
    cancelPaint(id) { paints.delete(id); },
  });
  const running = stream.run(controller.signal);
  function frame(index: number, sequence: number) {
    const at = epochNow();
    reads[index].reply.resolve({ serverWaitMs: 0, serverStartedAt: at, serverPreparedAt: at, browserArrivedAt: at, frame: { sequence, data: String(sequence), receivedAt: Date.now(), bytes: 100 } });
  }
  function repaint() { for (const [id, callback] of paints) { paints.delete(id); callback(); } }
  return { stream, reads, paints, controller, painted, running, frame, repaint };
}

test("reads overlap decoding and both pending stages retain only the newest frame", async () => {
  const first = deferred<TestBitmap>();
  const decoded: number[] = [];
  const closed: number[] = [];
  function bitmap(sequence: number): TestBitmap { return { sequence, width: 10, height: 20, close() { closed.push(sequence); } }; }
  const f = fixture(sequence => {
    decoded.push(sequence);
    return sequence === 1 ? first.promise : Promise.resolve(bitmap(sequence));
  });
  f.frame(0, 1);
  await setImmediate();
  assert.deepEqual(decoded, [1]);
  assert.equal(f.reads[1].after, 1, "The next read starts before the first decode finishes.");
  f.frame(1, 2);
  await setImmediate();
  f.frame(2, 3);
  await setImmediate();
  assert.deepEqual(decoded, [1], "There is only one decoder in flight.");
  first.resolve(bitmap(1));
  await setImmediate();
  assert.deepEqual(decoded, [1, 3], "Frame 2 is discarded before decoding.");
  assert.deepEqual(closed, [1], "The newer decoded bitmap replaces and closes frame 1.");
  assert.equal(f.paints.size, 1);
  f.repaint();
  assert.deepEqual(f.painted, [3]);
  assert.deepEqual(closed, [1, 3]);
  const stats = f.stream.stats();
  assert.equal(stats.skippedBeforeDecode, 1);
  assert.equal(stats.skippedBeforePaint, 1);
  assert.equal(stats.reads, 3);
  assert.equal(stats.bytes, 300);
  f.controller.abort();
  await f.running;
});

test("pause aborts a pending read and closes a decode that finishes after cancellation", async () => {
  const decode = deferred<TestBitmap>();
  let closed = 0;
  const f = fixture(() => decode.promise);
  f.frame(0, 1);
  await setImmediate();
  f.controller.abort();
  await f.running;
  decode.resolve({ sequence: 1, width: 10, height: 20, close() { closed++; } });
  await setImmediate();
  assert.equal(closed, 1);
  assert.equal(f.paints.size, 0);
  assert.deepEqual(f.painted, []);
  assert.equal(f.reads.length, 2);
});

test("decode failure aborts the parallel reader and fails the stream", async () => {
  const f = fixture(async () => { throw new Error("Broken JPEG"); });
  const failure = assert.rejects(f.running, /Broken JPEG/);
  f.frame(0, 1);
  await failure;
  assert.equal(f.paints.size, 0);
});

test("capture reset discards pending paint and late decode before accepting a fresh frame", async () => {
  const late = deferred<TestBitmap>();
  const closed: number[] = [];
  function bitmap(sequence: number): TestBitmap {
    return { sequence, width: 10, height: 20, close() { closed.push(sequence); } };
  }
  const f = fixture(sequence => sequence === 2 ? late.promise : Promise.resolve(bitmap(sequence)));
  f.frame(0, 1);
  await setImmediate();
  f.frame(1, 2);
  await setImmediate();
  f.stream.clearFrames();
  f.repaint();
  assert.deepEqual(f.painted, []);
  assert.deepEqual(closed, [1]);
  f.frame(2, 3);
  await setImmediate();
  assert.equal(f.reads[3].after, 3, "A read started before reset advances its cursor without decoding.");
  late.resolve(bitmap(2));
  await setImmediate();
  assert.deepEqual(closed, [1, 2]);
  assert.equal(f.paints.size, 0);
  f.frame(3, 4);
  await setImmediate();
  f.repaint();
  assert.deepEqual(f.painted, [4]);
  f.controller.abort();
  await f.running;
});

test("an unchanged screen keeps reading without reconnecting or repainting an old frame", async () => {
  const f = fixture(async sequence => ({ sequence, width: 1, height: 1, close() {} }));
  f.frame(0, 1);
  await setImmediate();
  f.repaint();
  const at = epochNow();
  f.reads[1].reply.resolve({ serverWaitMs: 1000, serverStartedAt: at - 1000, serverPreparedAt: at, browserArrivedAt: at });
  await setImmediate();
  assert.equal(f.reads[2].after, 1);
  assert.deepEqual(f.painted, [1]);
  assert.equal(f.paints.size, 0);
  f.controller.abort();
  await f.running;
});

test("repeated frame sequences stop rather than polling a cached image forever", async () => {
  const f = fixture(async sequence => ({ sequence, width: 1, height: 1, close() {} }));
  f.frame(0, 1);
  await setImmediate();
  const failure = assert.rejects(f.running, StopReconnectError);
  f.frame(1, 1);
  await failure;
  assert.equal(f.paints.size, 0);
});

test("frame responses retain timing metadata and distinguish wait, reconnect, and permanent failures", () => {
  const resource = { contents: [{ uri: "mobile-frame://test/latest", mimeType: "image/jpeg", blob: "YWJj", _meta: { sequence: 2, receivedAt: 1234, bytes: 3, serverWaitMs: 4, serverStartedAt: 1000, serverPreparedAt: 1004 } }] };
  const result = readFrame(resource);
  assert.equal(result.frame?.sequence, 2);
  assert.equal(result.frame?.bytes, 3);
  assert.equal(result.serverWaitMs, 4);
  assert.equal(result.serverStartedAt, 1000);
  assert.equal(result.serverPreparedAt, 1004);
  const waiting = { contents: [{ uri: "mobile-frame://test/latest", mimeType: "application/json", text: '{"state":"waiting","serverWaitMs":1000}', _meta: { serverStartedAt: 1000, serverPreparedAt: 2000 } }] };
  assert.deepEqual(readFrame(waiting), { serverWaitMs: 1000, serverStartedAt: 1000, serverPreparedAt: 2000, connectionState: undefined });
  waiting.contents[0].text = '{"state":"failed","error":"Disconnected","retryable":true}';
  assert.throws(() => readFrame(waiting), /Disconnected/);
  waiting.contents[0].text = '{"state":"failed","error":"Stopped","retryable":false}';
  assert.throws(() => readFrame(waiting), StopReconnectError);
  resource.contents[0]._meta.serverWaitMs = NaN;
  assert.throws(() => readFrame(resource), StopReconnectError);
  resource.contents[0]._meta.serverWaitMs = 4;
  resource.contents[0]._meta.serverPreparedAt = 999;
  assert.throws(() => readFrame(resource), /invalid frame timing/);
});

test("delivery phases account for the read round trip and paint scheduling is measured separately", async t => {
  let now = 10;
  t.mock.method(performance, "now", () => now);
  const origin = performance.timeOrigin;
  const f = fixture(async sequence => ({ sequence, width: 1, height: 1, close() {} }));
  now = 26;
  f.reads[0].reply.resolve({ serverWaitMs: 5, serverStartedAt: origin + 13, serverPreparedAt: origin + 20, browserArrivedAt: origin + 24, frame: { sequence: 1, data: "1", receivedAt: Date.now(), bytes: 100 } });
  await setImmediate();
  now = 30;
  f.repaint();
  const stats = f.stream.stats();
  assert.equal(stats.read.average, 16);
  assert.equal(stats.serverWait.average, 5);
  assert.equal(stats.bridge.average, 11);
  assert.equal(stats.requestTravel.average, 3);
  assert.equal(stats.serverPrepare.average, 2);
  assert.equal(stats.responseTravel.average, 4);
  assert.equal(stats.sdkDispatch.average, 2);
  assert.equal(stats.paintWait.average, 4);
  f.controller.abort();
  await f.running;
});

test("JPEG preparation is measured separately from waiting for the bitmap promise", async t => {
  let now = 10;
  t.mock.method(performance, "now", () => now);
  t.mock.method(globalThis, "atob", () => { now += 2; return "abc"; });
  const pending = deferred<ImageBitmap>();
  const original = Object.getOwnPropertyDescriptor(globalThis, "createImageBitmap");
  let jpeg: Blob | undefined;
  Object.defineProperty(globalThis, "createImageBitmap", {
    configurable: true,
    value: (blob: Blob) => { jpeg = blob; return pending.promise; },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "createImageBitmap", original);
    else Reflect.deleteProperty(globalThis, "createImageBitmap");
  });
  const timings: { phase: string; elapsed: number; startedAt: number }[] = [];
  const decoding = decodeJpeg("ignored", (phase, elapsed, startedAt) => { timings.push({ phase, elapsed, startedAt }); });
  assert.equal(jpeg?.size, 3);
  assert.equal(jpeg?.type, "image/jpeg");
  assert.deepEqual(timings, [{ phase: "jpegPrepare", elapsed: 2, startedAt: 10 }]);
  now = 62;
  const bitmap: ImageBitmap = { width: 1, height: 1, close() {} };
  pending.resolve(bitmap);
  const result = await decoding;
  assert.equal(result, bitmap);
  assert.deepEqual(timings[1], { phase: "bitmapDecode", elapsed: 50, startedAt: 12 });
});

test("rare input stalls remain visible even when p95 hides them", async () => {
  const f = fixture(async sequence => ({ sequence, width: 1, height: 1, close() {} }));
  for (let i = 0; i < 100; i++) f.stream.inputTiming(1);
  f.stream.inputTiming(185);
  for (let i = 0; i < 200; i++) f.stream.inputTiming(1);
  const report = f.stream.stats();
  assert.equal(report.input.p95, 1);
  assert.equal(report.input.max, 185);
  assert.equal(report.input.count, 301);
  assert.equal(f.stream.stats().input.max, 0);
  f.controller.abort();
  await f.running;
});
