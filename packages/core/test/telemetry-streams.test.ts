import test from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { scrubErrorEvent, scrubMetric } from "@mobile-dev/shared/telemetry.ts";
import { installTracePropagation, IOSLogProcessingTelemetry, recordIosMirrorSharing } from "../src/telemetry.ts";
import { openRequestSession } from "../src/request-session.ts";
import { assertFragment, captureSentry } from "@mobile-dev/test-support/sentry.ts";
import { connectClient } from "@mobile-dev/test-support/mcp.ts";

test("iOS parser telemetry aggregates bounded timings and flushes once on stream cleanup", async t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const sentry = captureSentry(t, { beforeSendMetric: scrubMetric });
  const telemetry = new IOSLogProcessingTelemetry("physical");
  t.after(() => telemetry.close());
  for (let index = 0; index < 1000; index++) telemetry.record(2);
  const before = await sentry.text();
  assertFragment(before, "logs.ios.parse", false);
  t.mock.timers.tick(30000);
  const periodic = await sentry.text();
  for (const name of ["samples", "mean", "p95", "max"]) assertFragment(periodic, `logs.ios.parse.${name}`);
  assertFragment(periodic, "millisecond");
  assertFragment(periodic, '"surface":{"value":"logs"');
  assertFragment(periodic, '"device_kind":{"value":"physical"');
  assertFragment(periodic, '"device_platform":{"value":"ios"');
  telemetry.record(3);
  telemetry.close();
  const closed = await sentry.text();
  telemetry.record(4);
  telemetry.close();
  t.mock.timers.tick(60000);
  const after = await sentry.text();
  assert.equal(after, closed, "Closing stops the timer and ignores late measurements.");
});

test("shared iOS capture metrics retain surface attribution and honor opt-out", async t => {
  const sentry = captureSentry(t, { telemetry: "on", beforeSendMetric: scrubMetric });
  recordIosMirrorSharing(1, 2, 9);
  const sent = await sentry.text();
  for (const fragment of ["ios.mirror.shared.captures", "ios.mirror.shared.subscribers", "ios.mirror.shared.queue_dropped", '"surface":{"value":"simulator"', '"device_platform":{"value":"ios"', '"device_kind":{"value":"physical"', '"component":{"value":"ios-mirror-service"']) assertFragment(sent, fragment);
  for (const fragment of ["udid", "sessionId", "user.id", "telemetry_session"]) assertFragment(sent, fragment, false);
  sentry.setTelemetry("off");
  recordIosMirrorSharing(1, 3, 10);
  assert.equal(await sentry.text(), sent);
});

test("cancelled stream requests close late sessions while delivered sessions remain open", async t => {
  const closed: string[] = [];
  const server = new McpServer({ name: "stream-cancellation-test", version: "1" });
  let finishOpen: (id: string) => void = () => {};
  let started: () => void = () => {};
  let settled: () => void = () => {};
  const opening = new Promise<string>(resolve => { finishOpen = resolve; });
  const startedOpening = new Promise<void>(resolve => { started = resolve; });
  const cancelledOpeningSettled = new Promise<void>(resolve => { settled = resolve; });
  server.registerTool("late", { inputSchema: {} }, async (_input, context) => {
    try {
      await openRequestSession(context.signal, () => { started(); return opening; }, id => { closed.push(id); });
      return { content: [] };
    } finally { settled(); }
  });
  server.registerTool("ready", { inputSchema: {} }, async (_input, context) => {
    const id = await openRequestSession(context.signal, async () => "delivered", id => { closed.push(id); });
    return { content: [{ type: "text", text: id }] };
  });
  let failResponse = false;
  const client = await connectClient(t, server, { prepare: serverTransport => {
    const send = serverTransport.send.bind(serverTransport);
    serverTransport.send = async (message, options) => {
      if (failResponse && "result" in message) throw new Error("Test response delivery failed");
      await send(message, options);
    };
    installTracePropagation(serverTransport);
  } });
  const abort = new AbortController();
  const pending = client.callTool({ name: "late", arguments: {} }, undefined, { signal: abort.signal });
  const rejection = assert.rejects(pending);
  await startedOpening;
  abort.abort();
  await rejection;
  finishOpen("late");
  await cancelledOpeningSettled;
  assert.deepEqual(closed, ["late"]);
  const delivered = new AbortController();
  const result = await client.callTool({ name: "ready", arguments: {} }, undefined, { signal: delivered.signal });
  assert.equal(result.isError, undefined);
  delivered.abort();
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(closed, ["late"]);
  let failed: () => void = () => {};
  const failedResponse = new Promise<void>(resolve => { failed = resolve; });
  server.server.onerror = () => { failed(); };
  failResponse = true;
  const failedAbort = new AbortController();
  const failedCall = client.callTool({ name: "ready", arguments: {} }, undefined, { signal: failedAbort.signal });
  const failedRejection = assert.rejects(failedCall);
  await failedResponse;
  assert.deepEqual(closed, ["late", "delivered"]);
  failedAbort.abort();
  await failedRejection;
});

test("cancellation during stream response preparation closes the session and retains cleanup failures", async t => {
  const sentry = captureSentry(t, { beforeSend: scrubErrorEvent, beforeSendMetric: scrubMetric });
  const closed: string[] = [];
  const prepared = new AbortController();
  const id = await openRequestSession(prepared.signal, async () => "prepared", id => { closed.push(id); });
  assert.equal(id, "prepared");
  prepared.abort();
  assert.deepEqual(closed, ["prepared"]);
  const late = new AbortController();
  const opening = openRequestSession(late.signal, async () => { late.abort(); return "late"; }, () => {
    throw new Error("Unexpected stream cleanup failure");
  });
  await assert.rejects(opening, { outcome: "cancelled" });
  const alreadyCancelled = new AbortController();
  alreadyCancelled.abort();
  let opened = false;
  const prevented = openRequestSession(alreadyCancelled.signal, async () => { opened = true; return "unexpected"; }, () => {});
  await assert.rejects(prevented, { name: "AbortError" });
  assert.equal(opened, false);
  const events = await sentry.events();
  assert.equal(events.length, 1);
  const encoded = JSON.stringify(events);
  assertFragment(encoded, "stream.cancel_cleanup");
  assertFragment(encoded, "Unexpected stream cleanup failure");
});
