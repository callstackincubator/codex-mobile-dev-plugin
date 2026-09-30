import test from "node:test";
import assert from "node:assert/strict";
import { assertStreamPolicy } from "../src/ui/stream-policy.ts";
import { StopReconnectError } from "../src/ui/reconnect.ts";

test("a panel opens a socket only for its embedded and host-approved endpoint", () => {
  const origin = "wss://127.0.0.1:63754";
  const token = "a".repeat(64);
  const url = `${origin}/${token}`;
  assert.doesNotThrow(() => assertStreamPolicy(url, origin, [origin]));
  assert.throws(() => assertStreamPolicy(url, origin, ["wss://127.0.0.1:63483"]), StopReconnectError);
  assert.throws(() => assertStreamPolicy(url, "wss://127.0.0.1:63483", [origin]), StopReconnectError);
  assert.throws(() => assertStreamPolicy(url, origin), StopReconnectError);
});
