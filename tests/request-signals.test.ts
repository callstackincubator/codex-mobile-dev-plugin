import test from "node:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { App } from "@modelcontextprotocol/ext-apps";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { isolateRequestSignals } from "../src/ui/request-signals.ts";

async function fixture(t: test.TestContext) {
  const cancelled: number[] = [];
  let hold = false;
  const app = new App({ name: "stream-test", version: "1" }, {}, { autoResize: false });
  isolateRequestSignals(app);
  const transport: Transport = {
    async start() {}, async close() { this.onclose?.(); },
    async send(message) {
      if ("method" in message && message.method === "notifications/cancelled") cancelled.push(message.params!.requestId as number);
      if (!("id" in message) || !("method" in message) || hold) return;
      const result = message.method === "ui/initialize"
        ? { protocolVersion: "2026-01-26", hostInfo: { name: "test", version: "1" }, hostCapabilities: { serverResources: {}, serverTools: {} }, hostContext: {} }
        : { contents: [{ uri: "mobile-frame://test/latest", mimeType: "image/jpeg", blob: "a".repeat(32768) }] };
      queueMicrotask(() => this.onmessage?.({ jsonrpc: "2.0", id: message.id, result }));
    },
  };
  await app.connect(transport);
  t.after(() => app.close());
  return { cancelled, hold: () => { hold = true; }, read: (signal: AbortSignal, timeout = 1000) => app.readServerResource({ uri: "mobile-frame://test/latest" }, { signal, timeout }) };
}

test("20,000 completed frames retain no stream abort listeners or stale cancellations", async t => {
  const app = await fixture(t), session = new AbortController();
  for (let i = 0; i < 20000; i++) {
    await app.read(session.signal);
    if (i % 1000 === 0) assert.equal(getEventListeners(session.signal, "abort").length, 0);
  }
  assert.equal(getEventListeners(session.signal, "abort").length, 0);
  session.abort();
  assert.deepEqual(app.cancelled, []);
});

test("stream cancellation reaches only its outstanding requests", async t => {
  const app = await fixture(t), session = new AbortController();
  await app.read(session.signal);
  app.hold();
  const first = app.read(session.signal), second = app.read(session.signal);
  assert.equal(getEventListeners(session.signal, "abort").length, 2);
  session.abort(new Error("Stopped"));
  await assert.rejects(first, /Stopped/); await assert.rejects(second, /Stopped/);
  assert.equal(getEventListeners(session.signal, "abort").length, 0);
  assert.equal(app.cancelled.length, 2);
  await assert.rejects(app.read(session.signal), /Stopped/);
  assert.equal(app.cancelled.length, 2);
});

test("timed-out requests release their stream listener", async t => {
  const app = await fixture(t), session = new AbortController();
  app.hold();
  await assert.rejects(app.read(session.signal, 5), /timed out/);
  assert.equal(getEventListeners(session.signal, "abort").length, 0);
  session.abort();
  assert.equal(app.cancelled.length, 1);
});
