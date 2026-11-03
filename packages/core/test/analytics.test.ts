import test from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { analyticsDisabled, MIXPANEL_TRACK_URL, ProductAnalytics, productAnalytics } from "../src/analytics.ts";
import { instrumentMcpServer } from "../src/telemetry.ts";

function recorder() {
  const requests: { url: string; events: { event: string; properties: Record<string, unknown> }[] }[] = [];
  const send = async (url: string, init: RequestInit) => {
    requests.push({ url, events: JSON.parse(String(init.body)) });
    return new Response("1");
  };
  return { requests, send };
}

test("product analytics sends tool usage to Mixpanel's EU endpoint without IPs or content", async () => {
  const { requests, send } = recorder();
  const analytics = new ProductAnalytics({ token: "token", environment: "release", distinctId: () => "anon_1", send });
  analytics.setHost("claude");
  analytics.sessionStarted();
  analytics.toolCalled("mobile_logs_session", "success");
  analytics.toolCalled("mobile_record_performance", "error");
  await analytics.close();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, MIXPANEL_TRACK_URL);
  assert.match(MIXPANEL_TRACK_URL, /^https:\/\/api-eu\.mixpanel\.com\/.*[?&]ip=0/);
  const [session, logs, recording] = requests[0].events;
  assert.equal(session.event, "Session Started");
  assert.deepEqual({ event: logs.event, tool: logs.properties.tool, outcome: logs.properties.outcome }, { event: "Tool Called", tool: "mobile_logs_session", outcome: "success" });
  assert.equal(recording.properties.outcome, "error");
  assert.deepEqual(Object.keys(logs.properties).sort(), ["$insert_id", "distinct_id", "host", "os", "outcome", "plugin_version", "time", "token", "tool"]);
  assert.equal(logs.properties.distinct_id, "anon_1");
  assert.equal(logs.properties.host, "claude");
});

test("product analytics skips polling and input tools", async () => {
  const { requests, send } = recorder();
  const analytics = new ProductAnalytics({ token: "token", environment: "release", distinctId: () => "anon_1", send });
  analytics.toolCalled("mobile_read_logs", "success");
  analytics.toolCalled("mobile_stream_input", "success");
  analytics.toolCalled("device_devices", "success");
  await analytics.close();
  assert.equal(requests.length, 0);
});

test("product analytics sends nothing in development, without a token, or when turned off", async () => {
  const { requests, send } = recorder();
  for (const options of [{ token: "token", environment: "development" as const }, { token: "", environment: "release" as const }]) {
    const analytics = new ProductAnalytics({ ...options, distinctId: () => "anon_1", send });
    analytics.toolCalled("mobile_logs_session", "success");
    await analytics.close();
  }
  for (const [key, value] of [["MOBILE_DEV_TELEMETRY", "off"], ["MOBILE_DEV_ANALYTICS", "off"], ["DO_NOT_TRACK", "1"]]) {
    const previous = process.env[key];
    process.env[key] = value;
    try {
      assert.equal(analyticsDisabled(), true);
      const analytics = new ProductAnalytics({ token: "token", environment: "release", distinctId: () => "anon_1", send });
      analytics.toolCalled("mobile_logs_session", "success");
      await analytics.close();
    } finally {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
  }
  assert.equal(requests.length, 0);
});

test("product analytics batches at Mixpanel's limit and drops failed batches", async () => {
  let calls = 0;
  const send = async () => { calls += 1; throw new Error("offline"); };
  const analytics = new ProductAnalytics({ token: "token", environment: "release", distinctId: () => "anon_1", send });
  for (let index = 0; index < 120; index += 1) analytics.toolCalled("mobile_logs_session", "success");
  await analytics.close();
  assert.equal(calls, 3);
  await analytics.close();
  assert.equal(calls, 3);
});

test("instrumented servers count each tool call with its outcome", async t => {
  const calls: [string, string][] = [];
  t.mock.method(productAnalytics, "toolCalled", (tool: string, outcome: string) => { calls.push([tool, outcome]); });
  const server = new McpServer({ name: "test", version: "1" });
  instrumentMcpServer(server);
  server.registerTool("works", {}, async () => ({ content: [] }));
  server.registerTool("fails", {}, async () => ({ content: [], isError: true }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "client", version: "1" });
  await client.connect(clientTransport);
  await client.callTool({ name: "works" });
  await client.callTool({ name: "fails" });
  await client.close();
  assert.deepEqual(calls, [["works", "success"], ["fails", "error"]]);
});
