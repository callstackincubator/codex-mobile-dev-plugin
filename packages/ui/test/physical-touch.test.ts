import test from "node:test";
import assert from "node:assert/strict";
import { streamMessageSchema } from "@mobile-dev/shared/protocol.ts";
import { touchInputSchema } from "@mobile-dev/shared/protocol.ts";
import { toPhysicalTouches } from "../src/physical-touch.ts";

const SCREEN = { width: 400, height: 800 };

test("a recorded tap reaches a physical iPhone as touch-down and touch-up, the only types its tool accepts", () => {
  const touches = toPhysicalTouches({ type: "tap", x: 10, y: 20, ...SCREEN });
  assert.deepEqual(touches.map(touch => touch.type), ["touch1-down", "touch1-up"]);
  for (const touch of touches) assert.equal(touchInputSchema.safeParse(touch).success, true);
});

test("a recorded swipe is a touch path from start to end", () => {
  const touches = toPhysicalTouches({ type: "swipe", startX: 0, startY: 100, endX: 0, endY: 500, ...SCREEN, duration: 0.3 });
  assert.equal(touches[0]!.type, "touch1-down");
  assert.equal(touches.at(-1)!.type, "touch1-up");
  assert.deepEqual([touches[0]!.y, touches.at(-1)!.y], [100, 500]);
  assert.ok(touches.slice(1, -1).every(touch => touch.type === "touch1-move"));
  assert.ok(touches.length <= 64);
  for (const touch of touches) assert.equal(touchInputSchema.safeParse(touch).success, true);
});

test("touches pass through and messages with no touch form are dropped", () => {
  const down = streamMessageSchema.parse({ type: "touch1-down", x: 1, y: 2, ...SCREEN });
  assert.deepEqual(toPhysicalTouches(down), [down]);
  for (const message of [{ type: "button", button: "home" }, { type: "type", text: "a" }, { type: "key", code: "Enter" }] as const)
    assert.deepEqual(toPhysicalTouches(streamMessageSchema.parse(message)), []);
});
