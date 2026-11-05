import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import * as Sentry from "@sentry/node";
import type { Envelope } from "@sentry/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MIXPANEL_TRACK_URL, MIXPANEL_ENGAGE_URL, TELEMETRY_INTERVAL_MS } from "../../shared/src/telemetry.ts";
import { PLUGIN_VERSION } from "../../shared/src/version.ts";
import { instrumentProductAnalytics } from "../src/analytics.ts";
import type { AnalyticsOptions } from "../src/analytics.ts";

type SentEvent = { event: string; properties: Record<string, unknown> };
type SentProfile = { $token: string; $distinct_id: string; $ip: string; $set: Record<string, string> };

function mixpanel(status = 1) {
  const requests: { url: string; body: string }[] = [];
  const send = async (url: string, init: RequestInit) => {
    const body = String(init.body);
    requests.push({ url, body });
    return Response.json({ error: status === 1 ? "" : "rejected", status });
  };
  function events() {
    const batches = requests.filter(request => request.url === MIXPANEL_TRACK_URL);
    return batches.flatMap(request => {
      const batch: SentEvent[] = JSON.parse(request.body);
      return batch;
    });
  }
  function profiles() {
    const batches = requests.filter(request => request.url === MIXPANEL_ENGAGE_URL);
    return batches.flatMap(request => {
      const batch: SentProfile[] = JSON.parse(request.body);
      return batch;
    });
  }
  return { requests, send, events, profiles };
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

test("product analytics joins EU installation profiles to events without IPs or content", async () => {
  const { requests, send, events, profiles } = mixpanel();
  const { client, analytics } = await connect({ send });
  await client.callTool({ name: "mobile_logs_session", arguments: {} });
  await client.callTool({ name: "mobile_repair_input", arguments: {} });
  await client.close();
  await analytics.close();
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, MIXPANEL_ENGAGE_URL);
  assert.equal(requests[1].url, MIXPANEL_TRACK_URL);
  assert.match(MIXPANEL_TRACK_URL, /^https:\/\/api-eu\.mixpanel\.com\/track\?(?=.*\bip=0\b)(?=.*\bverbose=1\b)/);
  assert.match(MIXPANEL_ENGAGE_URL, /^https:\/\/api-eu\.mixpanel\.com\/engage\?(?=.*\bip=0\b)(?=.*\bverbose=1\b)/);
  const sentProfiles = profiles();
  assert.deepEqual(sentProfiles, [{
    $token: "token", $distinct_id: "anon_1", $ip: "0",
    $set: { host: "claude", plugin_version: PLUGIN_VERSION, os: process.platform },
  }]);
  const [session, logs, repair] = events();
  assert.equal(session.event, "Session Started");
  assert.equal(session.properties.host, "claude");
  assert.deepEqual([logs.event, logs.properties.tool, logs.properties.outcome], ["Tool Called", "mobile_logs_session", "success"]);
  assert.deepEqual([repair.properties.tool, repair.properties.outcome], ["mobile_repair_input", "error"]);
  assert.deepEqual(Object.keys(logs.properties).sort(), ["$insert_id", "distinct_id", "host", "os", "outcome", "plugin_version", "time", "token", "tool"]);
  assert.equal(logs.properties.distinct_id, "anon_1");
  const [profile] = sentProfiles;
  assert.equal(profile.$distinct_id, session.properties.distinct_id);
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
  const { send: record, requests } = mixpanel(0);
  const delivery = Promise.withResolvers<void>();
  const send = async (url: string, init: RequestInit) => {
    await delivery.promise;
    return record(url, init);
  };
  const { client, analytics } = await connect({ send });
  for (let index = 0; index < 120; index += 1) await client.callTool({ name: "mobile_logs_session", arguments: {} });
  await client.close();
  const closing = analytics.close();
  delivery.resolve();
  await closing;
  const eventRequests = requests.filter(request => request.url === MIXPANEL_TRACK_URL);
  const batchSizes = eventRequests.map(request => {
    const batch: SentEvent[] = JSON.parse(request.body);
    return batch.length;
  });
  assert.deepEqual(batchSizes, [50, 50, 21]);
  const requestCount = requests.length;
  await analytics.close();
  assert.equal(requests.length, requestCount);
  await Sentry.flush();
  const sent = JSON.stringify(envelopes);
  assert.ok(sent.includes("analytics.flush"));
  assert.ok(sent.includes('"outcome":{"value":"failed"'));
  assert.equal(sent.includes('"outcome":{"value":"success"'), false);
  const trackEndpoint = sent.includes('"endpoint":{"value":"track"');
  const engageEndpoint = sent.includes('"endpoint":{"value":"engage"');
  const includesIdentity = sent.includes("anon_1");
  assert.ok(trackEndpoint);
  assert.ok(engageEndpoint);
  assert.equal(includesIdentity, false);
});

test("a rejected profile retries on the existing timer without blocking events or sending after close", async t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const recorded = mixpanel();
  let profileAttempts = 0;
  const send = async (url: string, init: RequestInit) => {
    const response = await recorded.send(url, init);
    if (url === MIXPANEL_ENGAGE_URL) {
      profileAttempts += 1;
      if (profileAttempts === 1) return Response.json({ status: 0, error: "rejected" });
    }
    return response;
  };
  const { client, analytics } = await connect({ send });
  t.after(async () => {
    await client.close();
    await analytics.close();
  });
  t.mock.timers.tick(TELEMETRY_INTERVAL_MS);
  await setImmediate();
  assert.equal(profileAttempts, 1);
  const events = recorded.events();
  assert.equal(events.length, 1, "A rejected profile must not drop session events.");

  t.mock.timers.tick(TELEMETRY_INTERVAL_MS);
  await setImmediate();
  assert.equal(profileAttempts, 2);
  assert.equal(recorded.requests.length, 3, "The retry must not resend accepted events.");
  t.mock.timers.tick(TELEMETRY_INTERVAL_MS);
  await setImmediate();
  assert.equal(profileAttempts, 2, "An accepted profile is not sent again during the session.");

  await analytics.close();
  analytics.sessionStarted("codex");
  t.mock.timers.tick(TELEMETRY_INTERVAL_MS);
  await analytics.close();
  assert.equal(recorded.requests.length, 3);
});

test("closing waits for an in-flight profile and flushes queued events", async () => {
  const recorded = mixpanel();
  const gate = Promise.withResolvers<Response>();
  const send = async (url: string, init: RequestInit) => {
    const response = await recorded.send(url, init);
    if (url === MIXPANEL_ENGAGE_URL) return gate.promise;
    return response;
  };
  const { client, analytics } = await connect({ send });
  await client.close();
  let closed = false;
  const closing = analytics.close();
  const observedClosing = closing.then(() => { closed = true; });
  let secondClosed = false;
  const secondClosing = analytics.close();
  const observedSecondClosing = secondClosing.then(() => { secondClosed = true; });
  await setImmediate();
  assert.equal(closed, false);
  assert.equal(secondClosed, false);
  assert.equal(recorded.requests.length, 1);
  const response = Response.json({ status: 1 });
  gate.resolve(response);
  await observedClosing;
  await observedSecondClosing;
  const events = recorded.events();
  assert.equal(events.length, 1);
  assert.equal(recorded.requests.length, 2);
});
