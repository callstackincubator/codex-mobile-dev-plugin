import test from "node:test";
import assert from "node:assert/strict";
import { canMessage, chatMessage, ChatDeliveryError, sendChat } from "../src/chat-message.ts";
import { errorCategory } from "@mobile-dev/shared/error-reporting.ts";

test("standard hosts receive a complete message without OpenAI routing", () => {
  const message = chatMessage({ getHostCapabilities: () => ({ message: { text: {} } }) }, "Explain this log: failed request");
  assert.deepEqual(message, { role: "user", content: [{ type: "text", text: "Explain this log: failed request" }] });
});

test("advertised OpenAI routing is preserved", () => {
  const message = chatMessage({ getHostCapabilities: () => ({ experimental: { "openai/message": {} } }) }, "Explain this log");
  assert.deepEqual(message._meta, { "openai/message": { target: "active", send: true } });
});

test("only hosts that advertise text messages can be messaged", () => {
  assert.equal(canMessage({ getHostCapabilities: () => ({ message: { text: {} } }) }), true);
  assert.equal(canMessage({ getHostCapabilities: () => ({ serverTools: {} }) }), false);
  assert.equal(canMessage({ getHostCapabilities: () => undefined }), false);
});

function host(send: () => Promise<{ isError?: boolean }>) {
  const options: unknown[] = [];
  return { options, getHostCapabilities: () => ({ message: { text: {} } }), async sendMessage(_message: unknown, option: unknown) { options.push(option); return send(); } };
}

async function failure(promise: Promise<unknown>) {
  try { await promise; } catch (error) { return error; }
  assert.fail("The send did not fail.");
}

test("sendChat waits for the composer, bounds each send, and names why the host did not take it", async () => {
  let attempts = 0;
  const arriving = host(async () => {
    if (++attempts < 3) throw new Error("No active composer is available.");
    return {};
  });
  await sendChat(arriving, "Explain this");
  assert.equal(attempts, 3);
  assert.deepEqual(arriving.options[0], { timeout: 5000, maxTotalTimeout: 5000 });

  const timeout = Object.assign(new Error("MCP error -32001: Request timed out"), { code: -32001 });
  const unconfirmed = await failure(sendChat(host(async () => { throw timeout; }), "Explain this"));
  assert.ok(unconfirmed instanceof ChatDeliveryError);
  assert.equal(unconfirmed.reason, "unconfirmed");
  assert.equal(unconfirmed.message, timeout.message);
  assert.equal(errorCategory(unconfirmed), "timeout", "Reports keep the host error's category.");
  const rejected = await failure(sendChat(host(async () => ({ isError: true })), "Explain this"));
  assert.ok(rejected instanceof ChatDeliveryError);
  assert.equal(rejected.reason, "rejected");
  const changed = await failure(sendChat(host(async () => ({})), "Explain this", { check: () => { throw new Error("The log changed."); } }));
  assert.equal(changed instanceof ChatDeliveryError, false);
  assert.match(String(changed), /The log changed/);
});
