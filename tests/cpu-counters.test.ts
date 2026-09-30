import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { CpuCounterSampler, parseCpuCounters } from "../src/server/cpu/counters.ts";

const profile = (time: number, retired: number, threads: string) =>
  `elapsed_usec:${time};task_used_usec:${retired};${threads}`;

describe("debugserver CPU counters", () => {
  test("keeps 64-bit thread IDs and decodes names", () => {
    const raw = profile(1000000, 0, "thread_used_id:20000000000001;thread_used_usec:900;thread_used_name:6d61696e;");
    const parsed = parseCpuCounters(raw);
    assert.deepEqual(parsed.threads, [{ id: "20000000000001", name: "main", cpuTimeUs: 900n }]);
  });

  test("measures CPU time deltas, with 100% per core and process usage above 100%", () => {
    const sampler = new CpuCounterSampler();
    const first = profile(1000000, 0, "thread_used_id:1;thread_used_usec:500000;thread_used_id:2;thread_used_usec:500000;");
    const second = profile(1250000, 0, "thread_used_id:1;thread_used_usec:750000;thread_used_id:2;thread_used_usec:625000;");
    const firstCounters = parseCpuCounters(first);
    const secondCounters = parseCpuCounters(second);
    const baseline = sampler.sample(firstCounters);
    const reading = sampler.sample(secondCounters);
    assert.equal(baseline.cpuPercent, null);
    assert.equal(reading.cpuPercent, 150);
    assert.deepEqual(reading.threads.map((thread) => thread.cpuPercent), [100, 50]);
  });

  test("keeps exited threads in process totals and baselines newly observed threads", () => {
    const sampler = new CpuCounterSampler();
    const first = profile(1000000, 0, "thread_used_id:1;thread_used_usec:200000;");
    const second = profile(1250000, 300000, "thread_used_id:2;thread_used_usec:10000;");
    const firstCounters = parseCpuCounters(first);
    const secondCounters = parseCpuCounters(second);
    sampler.sample(firstCounters);
    const reading = sampler.sample(secondCounters);
    assert.equal(reading.cpuPercent, 44);
    assert.equal(reading.threads[0].cpuPercent, null);
  });

  test("rejects incomplete thread data instead of displaying process-only results", () => {
    const missingThreads = profile(1000000, 1, "");
    assert.throws(() => parseCpuCounters(missingThreads), error => { assert.ok(error instanceof Error); assert.ok(error.message.includes("per-thread")); return true; });
    const missingTime = profile(1000000, 1, "thread_used_id:1;");
    assert.throws(() => parseCpuCounters(missingTime), error => { assert.ok(error instanceof Error); assert.ok(error.message.includes("Incomplete")); return true; });
  });

  test("starts a new baseline after device clock reversal or counter regression", () => {
    const sampler = new CpuCounterSampler();
    for (const [time, cpu] of [[1000000, 500000], [900000, 600000], [1150000, 100000]]) {
      const raw = profile(time, 0, `thread_used_id:1;thread_used_usec:${cpu};`);
      const counters = parseCpuCounters(raw);
      const reading = sampler.sample(counters);
      assert.equal(reading.cpuPercent, null);
      assert.equal(reading.threads[0].cpuPercent, null);
    }
  });
});
