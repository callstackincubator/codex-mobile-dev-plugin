import test from "node:test";
import assert from "node:assert/strict";
import { FrameArrivals } from "../src/ui/frame-arrivals.ts";

function response(uri: string, serverPreparedAt: number) {
  return { jsonrpc: "2.0", id: 1, result: { contents: [{ uri, _meta: { serverPreparedAt } }] } };
}

test("arrival timings remain independent for overlapping sessions and are consumed once", () => {
  const arrivals = new FrameArrivals();
  const first = response("mobile-frame://first/latest?after=1", 1000);
  const second = response("mobile-frame://second/latest?after=1", 1000);
  arrivals.record(first, 1003);
  arrivals.record(second, 1005);
  assert.equal(arrivals.take(first.result.contents[0].uri, 1000), 1003);
  assert.equal(arrivals.take(second.result.contents[0].uri, 1000), 1005);
  assert.throws(() => arrivals.take(first.result.contents[0].uri, 1000), /not observed/);
});

test("unrelated and malformed messages cannot populate a frame timing", () => {
  const arrivals = new FrameArrivals();
  arrivals.record(null, 10);
  arrivals.record({ result: { contents: [] } }, 10);
  const unrelated = response("ui://other/content", 20);
  arrivals.record(unrelated, 10);
  const invalid = response("mobile-frame://first/latest", NaN);
  arrivals.record(invalid, 10);
  assert.throws(() => arrivals.take(unrelated.result.contents[0].uri, 20), /not observed/);
  assert.throws(() => arrivals.take(invalid.result.contents[0].uri, NaN), /not observed/);
});

test("late cancelled responses cannot retain an unbounded timing history", () => {
  const arrivals = new FrameArrivals();
  const uri = "mobile-frame://first/latest";
  for (let key = 1; key <= 129; key++) {
    const message = response(uri, key);
    arrivals.record(message, key + 10);
  }
  assert.throws(() => arrivals.take(uri, 1), /not observed/);
  assert.equal(arrivals.take(uri, 129), 139);
  arrivals.clear();
  assert.throws(() => arrivals.take(uri, 128), /not observed/);
});
