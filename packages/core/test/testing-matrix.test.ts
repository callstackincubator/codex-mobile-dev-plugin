import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MATRIX_LIMIT, MatrixRegistry, Scheduler, clampLimit, isTerminalLane, snapshotMatrix, startMatrix } from "../src/testing-matrix.ts";
import type { Lane, LaneExecutor, MatrixDevice } from "../src/testing-matrix.ts";
import { ExpectedOperationError } from "@mobile-dev/shared/error-reporting.ts";

const devices = (n: number): MatrixDevice[] => Array.from({ length: n }, (_, i) => ({ deviceId: `dev-${i}`, platform: "ios" as const, name: `Phone ${i}` }));
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test("the limit defaults to 3 and is clamped to 1–8", () => {
  assert.equal(DEFAULT_MATRIX_LIMIT, 3);
  assert.equal(clampLimit(undefined), 3);
  assert.equal(clampLimit(0), 1);
  assert.equal(clampLimit(99), 8);
  assert.equal(clampLimit(2.7), 2);
});

test("the scheduler never runs more than its limit and starts tasks in order", async () => {
  const scheduler = new Scheduler(2);
  const started: number[] = [];
  const gates = [0, 1, 2, 3].map(() => Promise.withResolvers<void>());
  let peak = 0;
  const tasks = gates.map((gate, i) => scheduler.run(async () => {
    started.push(i); peak = Math.max(peak, scheduler.running); await gate.promise;
  }));
  await tick();
  assert.deepEqual(started, [0, 1]);
  assert.equal(scheduler.queued, 2);
  gates[0]!.resolve(); await tick();
  assert.deepEqual(started, [0, 1, 2], "a finished task frees its slot for the next in line");
  gates[1]!.resolve(); gates[2]!.resolve(); gates[3]!.resolve();
  await Promise.all(tasks);
  assert.equal(peak, 2);
  assert.equal(scheduler.running, 0);
});

test("a failing task still frees its slot", async () => {
  const scheduler = new Scheduler(1);
  await assert.rejects(scheduler.run(async () => { throw new Error("boom"); }), /boom/);
  assert.equal(await scheduler.run(async () => "ok"), "ok");
});

/** An executor whose lanes finish when the test says so. */
function gated() {
  const gates = new Map<string, PromiseWithResolvers<string>>();
  const prepared: string[] = [];
  const executor: LaneExecutor = {
    async prepare(lane, _lanes, _signal, setState) { setState("booting"); prepared.push(lane.deviceId); return lane.deviceId; },
    run(lane, _device, signal, onProgress) {
      onProgress({ stepIndex: 0, phase: "start", api: "locator.tap", label: "tap" });
      const gate = Promise.withResolvers<string>();
      gates.set(lane.deviceId, gate);
      signal.addEventListener("abort", () => gate.reject(new ExpectedOperationError("cancelled", "cancelled")), { once: true });
      return gate.promise.then(status => ({ status, exitCode: status === "passed" ? 0 : 1, steps: [] }));
    },
  };
  return { executor, gates, prepared };
}

test("three of four lanes run at once under the default limit and the fourth queues", async () => {
  const { executor, gates } = gated();
  const registry = new MatrixRegistry();
  const { run, done } = startMatrix(registry, { testPath: "t.e2e.ts", devices: devices(4) }, executor);
  await tick();
  assert.deepEqual(run.lanes.map(lane => lane.state), ["running", "running", "running", "queued"]);
  assert.equal(run.limit, 3);
  gates.get("dev-0")!.resolve("passed"); await tick();
  assert.deepEqual(run.lanes.map(lane => lane.state), ["passed", "running", "running", "running"]);
  for (const id of ["dev-1", "dev-2", "dev-3"]) gates.get(id)!.resolve("failed");
  await done;
  assert.deepEqual(run.lanes.map(lane => lane.state), ["passed", "failed", "failed", "failed"]);
  assert.ok(run.finishedAt);
  assert.ok(run.lanes.every(lane => isTerminalLane(lane.state)));
});

test("lanes keep their own progress and one failure does not stop the others", async () => {
  const { executor, gates } = gated();
  const { run, done } = startMatrix(new MatrixRegistry(), { testPath: "t", devices: devices(2) }, executor);
  await tick();
  gates.get("dev-0")!.resolve("failed"); gates.get("dev-1")!.resolve("passed");
  await done;
  assert.deepEqual(run.lanes.map(lane => lane.state), ["failed", "passed"]);
  assert.ok(run.lanes.every(lane => lane.progress.length === 1));
  assert.notEqual(run.lanes[0]!.progress, run.lanes[1]!.progress);
});

test("a lane whose prepare throws ends in error without touching its siblings", async () => {
  const executor: LaneExecutor = {
    async prepare(lane) { if (lane.deviceId === "dev-0") throw new Error("App not installed"); return lane.deviceId; },
    async run() { return { status: "passed", exitCode: 0, steps: [] }; },
  };
  const { run, done } = startMatrix(new MatrixRegistry(), { testPath: "t", devices: devices(2) }, executor);
  await done;
  assert.equal(run.lanes[0]!.state, "error");
  assert.equal(run.lanes[0]!.error, "App not installed");
  assert.equal(run.lanes[1]!.state, "passed");
});

test("cancelling a queued lane means it never starts; cancelling a running one aborts it", async () => {
  const { executor, gates, prepared } = gated();
  const registry = new MatrixRegistry();
  const { run, done } = startMatrix(registry, { testPath: "t", devices: devices(4), limit: 2 }, executor);
  await tick();
  assert.equal(registry.cancel(run.matrixId, "dev-3").length, 1);
  assert.equal(run.lanes[3]!.state, "cancelled");
  registry.cancel(run.matrixId, "dev-0"); await tick();
  assert.equal(run.lanes[0]!.state, "cancelled");
  gates.get("dev-1")!.resolve("passed"); await tick();
  gates.get("dev-2")!.resolve("passed");
  await done;
  assert.deepEqual(run.lanes.map(lane => lane.state), ["cancelled", "passed", "passed", "cancelled"]);
  assert.ok(!prepared.includes("dev-3"), "the cancelled lane was never prepared");
});

test("cancelling every lane of a matrix", async () => {
  const { executor } = gated();
  const registry = new MatrixRegistry();
  const { run, done } = startMatrix(registry, { testPath: "t", devices: devices(3), limit: 1 }, executor);
  await tick();
  assert.equal(registry.cancel(run.matrixId).length, 3);
  await done;
  assert.ok(run.lanes.every(lane => lane.state === "cancelled"));
  assert.equal(registry.busy, false);
});

test("cancelling during preparation waits for the active lane to observe the abort", async () => {
  const preparing = Promise.withResolvers<void>();
  const registry = new MatrixRegistry();
  const executor: LaneExecutor = {
    prepare: async (_lane, _lanes, signal) => {
      signal.addEventListener("abort", () => preparing.reject(new ExpectedOperationError("cancelled", "cancelled")), { once: true });
      await preparing.promise;
      return "dev-0";
    },
    run: async () => ({ status: "passed", exitCode: 0, steps: [] }),
  };
  const { run, done } = startMatrix(registry, { testPath: "t", devices: devices(1) }, executor);
  assert.ok(run.lanes[0]!.startedAt, "the lane is active even before preparation reports a phase");
  assert.equal(run.lanes[0]!.state, "queued");
  registry.cancel(run.matrixId, "dev-0");
  assert.equal(run.lanes[0]!.state, "queued", "an active preparation does not appear free before it stops");
  await done;
  assert.equal(run.lanes[0]!.state, "cancelled");
});

test("the registry finds runs, reports busy devices and drops old finished ones", async () => {
  const registry = new MatrixRegistry(2);
  const instant: LaneExecutor = { prepare: async lane => lane.deviceId, run: async () => ({ status: "passed", exitCode: 0, steps: [] }) };
  const first = startMatrix(registry, { testPath: "a", devices: devices(1) }, instant);
  await first.done;
  const { executor } = gated();
  const second = startMatrix(registry, { testPath: "b", devices: devices(2) }, executor);
  await tick();
  assert.equal(registry.latest()?.matrixId, second.run.matrixId);
  assert.deepEqual(registry.busyDevices().sort(), ["dev-0", "dev-1"]);
  const third = startMatrix(registry, { testPath: "c", devices: devices(1) }, instant);
  await third.done;
  assert.equal(registry.get(first.run.matrixId), undefined, "the oldest finished matrix is pruned");
  assert.ok(registry.get(second.run.matrixId), "an unfinished matrix is never pruned");
});

test("a snapshot does not change as the lane keeps running", async () => {
  const { executor, gates } = gated();
  const { run } = startMatrix(new MatrixRegistry(), { testPath: "t", devices: devices(1) }, executor);
  await tick();
  const copy = snapshotMatrix(run);
  run.lanes[0]!.progress.push({ stepIndex: 1, phase: "end", api: "x", label: "x" });
  assert.equal(copy.lanes[0]!.progress.length, 1);
  gates.get("dev-0")!.resolve("passed");
});

test("lanes carry stable unique run ids", () => {
  const { run } = new MatrixRegistry().create("t", devices(3), 3);
  assert.equal(new Set(run.lanes.map((lane: Lane) => lane.runId)).size, 3);
});
