import test from "node:test";
import assert from "node:assert/strict";
import { FailureEpisodes } from "../src/error-reporting.ts";

test("failure episode memory is bounded and inactivity starts a new episode", () => {
  const episodes = new FailureEpisodes();
  const first = episodes.shouldReport("a", "first", 0);
  const repeated = episodes.shouldReport("a", "first", 1);
  const changed = episodes.shouldReport("a", "changed", 2);
  const inactive = episodes.shouldReport("a", "changed", 300002);
  assert.equal(first, true);
  assert.equal(repeated, false);
  assert.equal(changed, true);
  assert.equal(inactive, true);
  episodes.recover("a");
  const recovered = episodes.shouldReport("a", "changed", 300003);
  assert.equal(recovered, true);
  for (let index = 0; index < 64; index++) {
    const key = String(index);
    episodes.shouldReport(key, "failure", 300004);
  }
  const evicted = episodes.shouldReport("a", "changed", 300005);
  assert.equal(evicted, true);
  episodes.clear();
  const cleared = episodes.shouldReport("a", "changed", 300006);
  assert.equal(cleared, true);
});
