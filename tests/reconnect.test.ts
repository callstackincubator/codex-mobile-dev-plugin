import test from "node:test";
import assert from "node:assert/strict";
import { ReconnectLoop, StopReconnectError } from "../src/ui/reconnect.ts";

test("the panel recovers from a failed read and Pause cancels its live loop", async () => {
  const loop = new ReconnectLoop([0]);
  let attempts = 0;
  let recovered!: () => void;
  const connected = new Promise<void>(resolve => { recovered = resolve; });
  const failures: unknown[] = [];
  loop.start(async signal => {
    if (++attempts === 1) throw new Error("MCP connection lost");
    loop.connected();
    recovered();
    await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
  }, error => failures.push(error), error => assert.fail(String(error)));
  await connected;
  assert.equal(attempts, 2);
  assert.equal(failures.length, 1);
  assert.equal(loop.active, true);
  loop.stop();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(loop.active, false);
  assert.equal(attempts, 2);
});

test("Pause during retry delay prevents another connection attempt", async () => {
  const loop = new ReconnectLoop([20]);
  let attempts = 0;
  let failed!: () => void;
  const failure = new Promise<void>(resolve => { failed = resolve; });
  loop.start(async () => { attempts++; throw new Error("Backend unavailable"); }, () => failed(), error => assert.fail(String(error)));
  await failure;
  loop.stop();
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(attempts, 1);
  assert.equal(loop.active, false);
});

test("a late failed request cannot revive a paused panel or replace a new device", async () => {
  const loop = new ReconnectLoop([0]);
  let failOld!: (error: Error) => void;
  loop.start(() => new Promise<void>((_, reject) => { failOld = reject; }), () => assert.fail("Old device retried"), () => assert.fail("Old device changed the panel"));
  loop.stop();
  let nextStarted!: () => void;
  const started = new Promise<void>(resolve => { nextStarted = resolve; });
  loop.start(async signal => {
    nextStarted();
    await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
  }, () => assert.fail("New device retried"), () => assert.fail("New device stopped"));
  await started;
  failOld(new Error("Old request closed"));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(loop.active, true);
  loop.stop();
});

test("a stopped simulator ends retry without an automatic boot", async () => {
  const loop = new ReconnectLoop([0]);
  let attempts = 0;
  let finished!: () => void;
  const stopped = new Promise<void>(resolve => { finished = resolve; });
  loop.start(async () => { attempts++; throw new StopReconnectError("The simulator is stopped"); }, () => assert.fail("Stopped simulator retried"), () => finished());
  await stopped;
  assert.equal(attempts, 1);
  assert.equal(loop.active, false);
});
