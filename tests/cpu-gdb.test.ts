import test from "node:test";
import assert from "node:assert/strict";
import { encodePacket, GdbPacketDecoder, ProfileAssembler } from "../src/server/cpu/gdb.ts";

test("handles packets split at every TCP byte boundary and acknowledgements", () => {
  const decoder = new GdbPacketDecoder();
  const first = encodePacket("OK");
  const second = encodePacket("T05thread:1;");
  const ack = Buffer.from("+");
  const wire = Buffer.concat([ack, first, second]);
  const decoded: string[] = [];
  for (const byte of wire) {
    const chunk = Buffer.from([byte]);
    const packets = decoder.push(chunk);
    decoded.push(...packets);
  }
  assert.deepEqual(decoded, ["+", "OK", "T05thread:1;"]);
});

test("validates checksums until no-ack mode is negotiated", () => {
  const decoder = new GdbPacketDecoder();
  const invalid = Buffer.from("$OK#00");
  assert.throws(() => decoder.push(invalid), error => { assert.ok(error instanceof Error); assert.ok(error.message.includes("checksum mismatch")); return true; });
  const noAck = new GdbPacketDecoder();
  noAck.verifyChecksums = false;
  assert.deepEqual(noAck.push(invalid), ["OK"]);
});

test("decodes GDB run-length and escaped bytes", () => {
  const decoder = new GdbPacketDecoder();
  const wire = encodePacket("A0* }");
  const result = decoder.push(wire);
  assert.deepEqual(result, ["A0000#"]);
});

test("assembles large per-thread snapshots across async packets", () => {
  const assembler = new ProfileAssembler();
  assert.deepEqual(assembler.push("elapsed_usec:1;thread_used_"), []);
  assert.deepEqual(assembler.push("id:abc;--en"), []);
  const results = assembler.push("d--;elapsed_usec:2;--end--;");
  assert.deepEqual(results, ["elapsed_usec:1;thread_used_id:abc;", "elapsed_usec:2;"]);
});
