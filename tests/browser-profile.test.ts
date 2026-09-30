import test from "node:test";
import assert from "node:assert/strict";
import { BrowserProfile } from "../src/ui/browser-profile.ts";

test("response and decode correlations clip overlapping events without double counting", () => {
  const profile = new BrowserProfile(["longtask", "long-animation-frame"]);
  const origin = performance.timeOrigin;
  profile.response(origin + 100, origin + 180, 42);
  profile.decode("bitmapDecode", 160, 60);
  profile.recordEntries([
    { entryType: "longtask", name: "self", startTime: 90, duration: 60 },
    { entryType: "longtask", name: "cross-origin-ancestor", startTime: 140, duration: 70 },
    { entryType: "long-animation-frame", name: "long-animation-frame", startTime: 110, duration: 100, blockingDuration: 30, scripts: [
      { duration: 65, invoker: "DOMWindow.onmessage", sourceFunctionName: "receiveFrame", sourceCharPosition: 123, windowAttribution: "self", forcedStyleAndLayoutDuration: 4 },
    ] },
  ]);
  profile.timerFired(120, 170, "visible");
  const stats = profile.stats("visible");
  const response = stats.slowestResponses[0];
  assert.equal(response.longTaskOverlapMs, 80);
  assert.equal(response.longAnimationFrameOverlapMs, 70);
  assert.equal(response.timerLateOverlapMs, 50);
  assert.equal(stats.slowestDecodes[0].longTaskOverlapMs, 50);
  assert.equal(stats.slowestDecodes[0].longAnimationFrameOverlapMs, 50);
  assert.equal(stats.longestTasks[0].scope, "cross-origin-ancestor");
  assert.equal(stats.longestAnimations[0].scripts[0].invoker, "DOMWindow.onmessage");
  assert.equal(stats.longTasks.count, 2);
  assert.equal(stats.longTasks.average, 65);
  const empty = profile.stats("visible");
  assert.equal(empty.longTasks.count, 0);
  assert.equal(empty.slowestResponses.length, 0);
  assert.equal(empty.slowestDecodes.length, 0);
});

test("late responses still correlate with events delivered before the preceding report", () => {
  const profile = new BrowserProfile(["longtask"]);
  profile.recordEntries([{ entryType: "longtask", name: "self", startTime: 100, duration: 80 }]);
  profile.stats("visible");
  const origin = performance.timeOrigin;
  profile.response(origin + 120, origin + 190, 1);
  const stats = profile.stats("visible");
  assert.equal(stats.longTasks.count, 0);
  assert.equal(stats.slowestResponses[0].longTaskOverlapMs, 60);
});

test("hidden timer throttling is excluded and unsupported observers are explicit", () => {
  const profile = new BrowserProfile([]);
  profile.timerFired(10, 1010, "hidden");
  profile.timerFired(10, 12, "visible");
  profile.timerFired(20, 21, "visible");
  const stats = profile.stats("visible");
  assert.equal(stats.hiddenTimerSamples, 1);
  assert.deepEqual(stats.timerLag, { count: 2, average: 1.5, p95: 2, max: 2 });
  assert.equal(stats.longTaskSupported, false);
  assert.equal(stats.longAnimationFrameSupported, false);
});

test("response histories are bounded and omitted samples are counted", () => {
  const profile = new BrowserProfile([]);
  const origin = performance.timeOrigin;
  for (let i = 0; i < 140; i++) profile.response(origin + i, origin + i + 140 - i, i);
  const stats = profile.stats("visible");
  assert.equal(stats.overflowedResponses, 12);
  assert.equal(stats.slowestResponses.length, 3);
  assert.equal(stats.slowestResponses[0].sequence, 12);
});

test("observer records are drained at reporting time and disconnected when profiling stops", t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "PerformanceObserver");
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  let disconnected = 0;
  let observed: string[] = [];
  class Observer {
    static supportedEntryTypes = ["longtask"];
    observe(options: { entryTypes: string[] }) { observed = options.entryTypes; }
    takeRecords() { return [{ entryType: "longtask", name: "self", startTime: 1, duration: 60 }]; }
    disconnect() { disconnected++; }
  }
  Object.defineProperty(globalThis, "PerformanceObserver", { value: Observer, configurable: true });
  Object.defineProperty(globalThis, "document", { value: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} }, configurable: true });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "PerformanceObserver", original);
    else Reflect.deleteProperty(globalThis, "PerformanceObserver");
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
  });
  const profile = new BrowserProfile();
  try {
    profile.start();
    assert.deepEqual(observed, ["longtask"]);
    assert.equal(profile.stats("visible").longTasks.max, 60);
  } finally { profile.stop(); }
  assert.equal(disconnected, 1);
});
