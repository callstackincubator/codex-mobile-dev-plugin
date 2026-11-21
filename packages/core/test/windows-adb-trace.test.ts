import assert from "node:assert/strict";
import test from "node:test";
import { WindowsAdbTrace } from "../src/fps/windows-adb-trace.ts";

test("Windows adb text-mode output preserves protobuf LF, CRLF and binary payloads across every chunk boundary", () => {
  const expected = Buffer.from([10, 0, 10, 13, 10, 13, 13, 10, 128, 255, 13, 0]);
  const shellOutput = Buffer.from([...expected].flatMap(byte => byte === 10 ? [13, 10] : [byte]));
  for (let split = 0; split <= shellOutput.length; split++) {
    const trace = new WindowsAdbTrace();
    assert.deepEqual(Buffer.concat([trace.decode(shellOutput.subarray(0, split)), trace.decode(shellOutput.subarray(split))]), expected);
  }
});

test("binary adb pipes pass every chunk through unchanged, including chunks beginning with CRLF", () => {
  const trace = new WindowsAdbTrace();
  for (const chunk of [Buffer.alloc(0), Buffer.from([10]), Buffer.from([13, 10]), Buffer.from([13]), Buffer.from([10, 0, 255])]) {
    assert.equal(trace.decode(chunk), chunk);
  }
});
