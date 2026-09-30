import test from "node:test";
import assert from "node:assert/strict";
import { threadLabel } from "../src/ui/components/performance/threadLabels.ts";

test("iOS labels use exact native names for verified roles and number unnamed threads", () => {
  const gc = threadLabel("hades", 2, "ios");
  const network = threadLabel("com.apple.NSURLConnectionLoader", 4, "ios");
  const unnamed = threadLabel("", 7, "ios");
  assert.equal(gc, "Hermes GC");
  assert.equal(network, "Network loader");
  assert.equal(unnamed, "Unnamed thread #7");
});

test("other native names remain verbatim instead of guessing a main or JavaScript role", () => {
  const nearMatch = threadLabel("hades-worker", 1, "ios");
  const custom = threadLabel("My application's worker", 2, "ios");
  const android = threadLabel("hades", 3, "android");
  assert.equal(nearMatch, "hades-worker");
  assert.equal(custom, "My application's worker");
  assert.equal(android, "hades");
});
