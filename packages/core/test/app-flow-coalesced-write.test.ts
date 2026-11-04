import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCoalescedWriter } from "../src/app-flow/coalesced-write.ts";

describe("createCoalescedWriter", () => {
  it("retries a checkpoint whose write failed instead of treating it as durable", async () => {
    let now = 0;
    let attempt = 0;
    const writer = createCoalescedWriter({
      write: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error("disk full");
      },
      windowMs: 1_000,
      now: () => now,
    });

    await assert.rejects(writer.mark(), /disk full/);
    assert.equal(writer.writes, 1);

    // The failed write must not have advanced the saved revision: a later flush with nothing new
    // marked still has to retry it, or the latest crash-resume checkpoint is lost for good.
    await writer.flush();
    assert.equal(writer.writes, 2);
    assert.equal(attempt, 2);
  });

  it("does not re-issue a write once one has actually succeeded", async () => {
    let now = 0;
    const writer = createCoalescedWriter({ write: async () => undefined, windowMs: 1_000, now: () => now });
    await writer.mark();
    assert.equal(writer.writes, 1);
    await writer.flush();
    assert.equal(writer.writes, 1);
  });
});
