import test from "node:test";
import assert from "node:assert/strict";
import { StreamInput } from "../src/ui/stream-input.ts";
import type { StreamMessage } from "../src/ui/stream-input.ts";
import { SCREEN } from "./fixtures.ts";

test("slow input coalesces pointer moves while preserving down/up and hardware-button order", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const batches: StreamMessage[][] = [];
  const input = new StreamInput(async messages => {
    batches.push(messages);
    if (batches.length === 1) await gate;
  }, error => { throw error; });
  input.send({ type: "touch1-down", x: 1, y: 2, ...SCREEN });
  for (let x = 2; x < 100; x++) input.send({ type: "touch1-move", x, y: 2, ...SCREEN });
  input.send({ type: "touch1-up", x: 99, y: 2, ...SCREEN });
  input.send({ type: "button", button: "home" });
  const finished = input.finish();
  input.send({ type: "button", button: "power" });
  release();
  await finished;
  assert.deepEqual(batches.map(batch => batch.map(message => message.type)), [["touch1-down"], ["touch1-move", "touch1-up", "button"]]);
  assert.equal(batches[1][0].type === "touch1-move" && batches[1][0].x, 99);
});

test("a failed input request discards queued gestures and does not replay them", async () => {
  let reject!: (error: Error) => void;
  const gate = new Promise<void>((_resolve, failure) => { reject = failure; });
  const errors: unknown[] = [];
  let deliveries = 0;
  const input = new StreamInput(async () => { deliveries++; await gate; }, error => { errors.push(error); });
  input.send({ type: "button", button: "home" });
  input.send({ type: "button", button: "power" });
  reject(new Error("Disconnected"));
  await input.flush();
  input.send({ type: "button", button: "app-switcher" });
  await input.flush();
  assert.equal(deliveries, 1);
  assert.equal(errors.length, 1);
});
