import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { IosVideo } from "../src/ui/ios-video.ts";

function mockBitmap(t: TestContext, decode: (...args: unknown[]) => unknown) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "createImageBitmap");
  Object.defineProperty(globalThis, "createImageBitmap", { value: decode, configurable: true });
  t.after(() => { if (previous) Object.defineProperty(globalThis, "createImageBitmap", previous); else Reflect.deleteProperty(globalThis, "createImageBitmap"); });
}

test("JPEG decode failure recovers capture and a good frame clears the failure count", async t => {
  let closes = 0;
  let outputs = 0;
  let resets = 0;
  let fails = true;
  mockBitmap(t, async () => {
    if (fails) throw new Error("bad JPEG");
    return { close() { closes++; } };
  });
  const decoder = new IosVideo(() => { outputs++; }, async () => { resets++; });
  await decoder.accept("AA==");
  await decoder.accept("AA==");
  assert.equal(resets, 2);
  fails = false;
  await decoder.accept("AA==");
  assert.equal(outputs, 1);
  assert.equal(closes, 1);
  fails = true;
  await decoder.accept("AA==");
  await decoder.accept("AA==");
  await assert.rejects(decoder.accept("AA=="), /three frames/);
  assert.equal(resets, 4);
  decoder.close();
  await decoder.accept("AA==");
  assert.equal(resets, 4);
});

test("closing during JPEG decode frees the late bitmap without drawing it", async t => {
  let finish!: (bitmap: unknown) => void;
  let closes = 0;
  let outputs = 0;
  mockBitmap(t, () => new Promise(resolve => { finish = resolve; }));
  const controller = new AbortController();
  const decoder = new IosVideo(() => { outputs++; }, async () => {}, controller.signal);
  const pending = decoder.accept("AA==");
  controller.abort();
  finish({ close() { closes++; } });
  await pending;
  assert.equal(closes, 1);
  assert.equal(outputs, 0);
});

test("closing during a failed decode cannot reset another stream", async t => {
  let reject!: (error: Error) => void;
  let resets = 0;
  mockBitmap(t, () => new Promise((_, failed) => { reject = failed; }));
  const decoder = new IosVideo(() => {}, async () => { resets++; });
  const pending = decoder.accept("AA==");
  decoder.close();
  reject(new Error("late JPEG failure"));
  await pending;
  assert.equal(resets, 0);
});
