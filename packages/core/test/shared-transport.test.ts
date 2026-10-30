import test from "node:test";
import assert from "node:assert/strict";
import type { Transport, TransportSendOptions } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage, RequestId } from "@modelcontextprotocol/sdk/types.js";
import { SharedTransport } from "../src/shared-transport.ts";

class Connection implements Transport {
  onmessage?: Transport["onmessage"];
  onclose?: Transport["onclose"];
  onerror?: Transport["onerror"];
  sent: Array<{ message: JSONRPCMessage; options?: TransportSendOptions }> = [];
  async start() {}
  async close() { this.onclose?.(); }
  async send(message: JSONRPCMessage, options?: TransportSendOptions) { this.sent.push({ message, options }); }
  receive(message: JSONRPCMessage) { this.onmessage?.(message); }
}

function request(id: RequestId, method = "ping"): JSONRPCMessage {
  if (method === "initialize") return {
    jsonrpc: "2.0", id, method, params: {
      protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" },
    },
  };
  return { jsonrpc: "2.0", id, method };
}

function id(message: JSONRPCMessage): RequestId {
  assert.ok("id" in message && message.id !== undefined);
  return message.id;
}

async function router() {
  const host = new Connection();
  const shared = new SharedTransport(host);
  const received: JSONRPCMessage[] = [];
  shared.onmessage = message => { received.push(message); };
  await shared.start();
  host.receive(request("initialize", "initialize"));
  const initialization = received.pop()!;
  await shared.send({ jsonrpc: "2.0", id: id(initialization), result: {
    protocolVersion: "2025-11-25", capabilities: {}, serverInfo: { name: "test", version: "1" },
  } });
  host.sent = [];
  async function panel() {
    const connection = new Connection();
    await shared.attach(connection);
    connection.receive(request("initialize", "initialize"));
    connection.sent = [];
    return connection;
  }
  return { shared, host, received, panel };
}

test("all clients can use colliding IDs, including strings matching internal IDs", async () => {
  const { shared, host, received, panel } = await router();
  const first = await panel();
  const second = await panel();
  host.receive(request("mobile-dev-shared-2"));
  first.receive(request("mobile-dev-shared-2"));
  second.receive(request("mobile-dev-shared-2"));
  const ids = received.map(id);
  assert.equal(new Set(ids).size, 3);
  for (let index = received.length - 1; index >= 0; index--) {
    await shared.send({ jsonrpc: "2.0", id: ids[index], result: { index } });
  }
  for (const [index, connection] of [host, first, second].entries()) {
    assert.deepEqual(connection.sent[0].message, { jsonrpc: "2.0", id: "mobile-dev-shared-2", result: { index } });
  }
  await shared.close();
});

test("cancellation and late responses cannot reach another client's request", async () => {
  const { shared, host, received, panel } = await router();
  const first = await panel();
  const second = await panel();
  first.receive(request(1));
  second.receive(request("1"));
  const firstId = id(received[0]);
  const secondId = id(received[1]);
  second.receive({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: firstId } });
  assert.equal(received.length, 2);
  first.receive({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 1 } });
  assert.deepEqual(received[2], { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: firstId } });
  await shared.send({ jsonrpc: "2.0", id: firstId, result: { late: true } });
  await shared.send({ jsonrpc: "2.0", id: secondId, result: {} });
  assert.equal(host.sent.length, 0);
  assert.equal(first.sent.length, 0);
  assert.deepEqual(second.sent[0].message, { jsonrpc: "2.0", id: "1", result: {} });
  await shared.close();
});

test("progress returns to the requesting tab with its original related ID", async () => {
  const { shared, host, received, panel } = await router();
  const first = await panel();
  const second = await panel();
  first.receive(request(7));
  const internal = id(received[0]);
  const progress: JSONRPCMessage = { jsonrpc: "2.0", method: "notifications/progress", params: { progressToken: "token", progress: 1 } };
  await shared.send(progress, { relatedRequestId: internal });
  assert.deepEqual(first.sent, [{ message: progress, options: { relatedRequestId: 7 } }]);
  assert.equal(host.sent.length, 0);
  assert.equal(second.sent.length, 0);
  await first.close();
  await shared.send(progress, { relatedRequestId: internal });
  assert.equal(host.sent.length, 0);
  await shared.close();
});

test("server requests accept replies only from their owner and settle on disconnect", async () => {
  const { shared, host, received, panel } = await router();
  const first = await panel();
  const second = await panel();
  first.receive(request(2));
  const internal = id(received[0]);
  await shared.send(request(9, "roots/list"), { relatedRequestId: internal });
  assert.equal(first.sent.length, 1);
  const before = received.length;
  second.receive({ jsonrpc: "2.0", id: 9, result: { forged: true } });
  host.receive({ jsonrpc: "2.0", id: 9, result: { forged: true } });
  assert.equal(received.length, before);
  first.receive({ jsonrpc: "2.0", id: 9, result: { roots: [] } });
  assert.deepEqual(received.at(-1), { jsonrpc: "2.0", id: 9, result: { roots: [] } });
  await shared.send(request(10, "roots/list"), { relatedRequestId: internal });
  await first.close();
  assert.deepEqual(received.at(-1), { jsonrpc: "2.0", id: 10, error: { code: -32603, message: "The connection closed." } });
  await shared.close();
});

test("a closed panel cannot rejoin by sending messages on its old transport", async () => {
  const { shared, received, panel } = await router();
  const first = await panel();
  await first.close();
  first.receive(request("again", "initialize"));
  first.receive(request("late"));
  assert.equal(received.length, 0);
  await shared.close();
  await assert.rejects(shared.attach(new Connection()), /chat connection has closed/);
});
