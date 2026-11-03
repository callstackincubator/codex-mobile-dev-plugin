import test from "node:test";
import assert from "node:assert/strict";
import * as Sentry from "@sentry/node";
import type { Envelope } from "@sentry/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MIXPANEL_TRACK_URL } from "../../shared/src/telemetry.ts";
import { instrumentProductAnalytics } from "../src/analytics.ts";
import type { AnalyticsOptions } from "../src/analytics.ts";

type SentEvent = { event: string; properties: Record<string, unknown> };

function mixpanel(status = 1) {
  const requests: { url: string; events: SentEvent[] }[] = [];
  const send = async (url: string, init: RequestInit) => {
    requests.push({ url, events: JSON.parse(String(init.body)) });
    return Response.json({ error: status === 1 ? "" : "rejected", status });
  };
  return { requests, send, events: () => requests.flatMap(request => request.events) };
}

/** A release server with three tools, connected to a client named `clientName`. */
async function connect(options: AnalyticsOptions, clientName = "claude-code") {
  const server = new McpServer({ name: "test", version: "1" });
  const analytics = instrumentProductAnalytics(server, { token: "token", environment: "release", userId: "anon_1", ...options });
  server.server.oninitialized = () => { analytics.sessionStarted(server.server.getClientVersion()?.name); };
  server.registerTool("mobile_logs_session", {}, async () => ({ content: [] }));
  server.registerTool("mobile_repair_input", {}, async () => ({ content: [], isError: true }));
  server.registerTool("mobile_read_logs", {}, async () => ({ content: [] }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: clientName, version: "1" });
  await client.connect(clientTransport);
  return { client, analytics };
}

async function withEnv(key: string, value: string, run: () => Promise<void>) {
  const previous = process.env[key];
  process.env[key] = value;
  try { await run(); }
  finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
}

test("product analytics sends sessions and tool calls to Mixpanel's EU endpoint without IPs or content", async () => {
  const { requests, send, events } = mixpanel();
  const { client, analytics } = await connect({ send });
  await client.callTool({ name: "mobile_logs_session", arguments: {} });
  await client.callTool({ name: "mobile_repair_input", arguments: {} });
  await client.close();
  await analytics.close();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, MIXPANEL_TRACK_URL);
  assert.match(MIXPANEL_TRACK_URL, /^https:\/\/api-eu\.mixpanel\.com\/track\?(?=.*\bip=0\b)(?=.*\bverbose=1\b)/);
  const [session, logs, repair] = events();
  assert.equal(session.event, "Session Started");
  assert.equal(session.properties.host, "claude");
  assert.deepEqual([logs.event, logs.properties.tool, logs.properties.outcome], ["Tool Called", "mobile_logs_session", "success"]);
  assert.deepEqual([repair.properties.tool, repair.properties.outcome], ["mobile_repair_input", "error"]);
  assert.deepEqual(Object.keys(logs.properties).sort(), ["$insert_id", "distinct_id", "host", "os", "outcome", "plugin_version", "time", "token", "tool"]);
  assert.equal(logs.properties.distinct_id, "anon_1");
});

test("product analytics leaves out polling tools", async () => {
  const { send, events } = mixpanel();
  const { client, analytics } = await connect({ send });
  await client.callTool({ name: "mobile_read_logs", arguments: {} });
  await client.close();
  await analytics.close();
  assert.deepEqual(events().map(event => event.event), ["Session Started"]);
});

test("product analytics sends nothing in development, without a token, or when turned off", async () => {
  const { send, requests } = mixpanel();
  async function session(options: AnalyticsOptions) {
    const { client, analytics } = await connect({ send, ...options });
    await client.callTool({ name: "mobile_logs_session", arguments: {} });
    await client.close();
    await analytics.close();
  }
  await session({ environment: "development" });
  await session({ token: "" });
  for (const [key, value] of [["MOBILE_DEV_TELEMETRY", "off"], ["MOBILE_DEV_ANALYTICS", "off"], ["DO_NOT_TRACK", "1"]]) {
    await withEnv(key, value, () => session({}));
  }
  assert.equal(requests.length, 0);
});

test("product analytics batches at Mixpanel's limit and counts batches Mixpanel rejects as failed", async t => {
  const envelopes: Envelope[] = [];
  Sentry.init({
    dsn: "https://public@example.com/1", defaultIntegrations: false,
    transport: () => ({ async send(envelope) { envelopes.push(envelope); return { statusCode: 200 }; }, async flush() { return true; } }),
  });
  t.after(async () => { await Sentry.close(); });
  const { send, requests } = mixpanel(0);
  const { client, analytics } = await connect({ send });
  for (let index = 0; index < 120; index += 1) await client.callTool({ name: "mobile_logs_session", arguments: {} });
  await client.close();
  await analytics.close();
  assert.deepEqual(requests.map(request => request.events.length), [50, 50, 21]);
  await analytics.close();
  assert.equal(requests.length, 3);
  await Sentry.flush();
  const sent = JSON.stringify(envelopes);
  assert.ok(sent.includes("analytics.flush"));
  assert.ok(sent.includes('"outcome":{"value":"failed"'));
  assert.equal(sent.includes('"outcome":{"value":"success"'), false);
});
