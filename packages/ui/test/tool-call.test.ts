import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { callTool, ToolCallError } from "../src/tool-call.ts";
import { ReconnectLoop } from "../src/reconnect.ts";

const host = (result: CallToolResult) => ({ async callServerTool() { return result; } });

test("callTool throws the tool's text with its failure metadata", async () => {
  const failed = host({ isError: true, content: [{ type: "text", text: "Input is blocked." }, { type: "text", text: "Repair it." }], _meta: { retryable: false, inputBlocked: true } });
  await assert.rejects(callTool(failed, { name: "mobile_stream_input" }), (error: unknown) => {
    assert.ok(error instanceof ToolCallError);
    assert.equal(error.message, "Input is blocked.\nRepair it.");
    assert.deepEqual(error.meta, { retryable: false, inputBlocked: true, streamDisconnected: false, inputBusy: false });
    return true;
  });
  const silent = host({ isError: true, content: [] });
  await assert.rejects(callTool(silent, { name: "mobile_app_storage" }, { fallback: "The plugin could not read app storage." }), /could not read app storage/);
});

test("callTool parses structured content with a schema and reports the round trip", async () => {
  let answered = 0;
  const schema = z.object({ sessionId: z.string() });
  assert.deepEqual(await callTool(host({ content: [], structuredContent: { sessionId: "a", extra: 1 } }), { name: "mobile_cpu_session" }, { schema, answered: () => answered++ }), { sessionId: "a" });
  await assert.rejects(callTool(host({ content: [], structuredContent: {} }), { name: "mobile_cpu_session" }, { schema }), /invalid mobile_cpu_session result/);
  await assert.rejects(callTool(host({ isError: true, content: [] }), { name: "mobile_cpu_session" }, { answered: () => answered++ }), ToolCallError);
  assert.equal(answered, 2);
});

test("a tool failure the server marks as not retryable stops the reconnect loop", async () => {
  const loop = new ReconnectLoop([0]);
  let attempts = 0;
  const outcome = new Promise<unknown>(resolve => {
    loop.start(async () => {
      attempts++;
      throw new ToolCallError("The simulator was deleted.", { retryable: false, inputBlocked: false, streamDisconnected: false, inputBusy: false });
    }, () => assert.fail("A non-retryable failure is not retried."), resolve);
  });
  assert.match(String(await outcome), /simulator was deleted/);
  assert.equal(attempts, 1);
  assert.equal(loop.active, false);
});
