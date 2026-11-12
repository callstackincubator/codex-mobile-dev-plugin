import test from "node:test";
import assert from "node:assert/strict";
import { ChatDeliveryUnconfirmed, chatMessage, sendChatMessage } from "../src/chat-message.ts";

test("standard hosts receive a complete message without OpenAI routing", () => {
  const message = chatMessage({ getHostCapabilities: () => ({ message: { text: {} } }) }, "Explain this log: failed request");
  assert.deepEqual(message, { role: "user", content: [{ type: "text", text: "Explain this log: failed request" }] });
});

test("advertised OpenAI routing is preserved", () => {
  const message = chatMessage({ getHostCapabilities: () => ({ experimental: { "openai/message": {} } }) }, "Explain this log");
  assert.deepEqual(message._meta, { "openai/message": { target: "active", send: true } });
});

test("standard messages stay within the host's text rules without damaging joiners", () => {
  const host = { getHostCapabilities: () => ({ message: { text: {} } }) };
  const text = "👩‍💻 فارسی\u200c हिंदी\r\n\n\n" + " ".repeat(64) + "hello";
  const message = chatMessage(host, text);
  assert.equal(message.content[0].type, "text");
  assert.deepEqual(message.content, [{ type: "text", text }]);
  assert.throws(() => chatMessage(host, "\u200b\t\n"), /Add some text/);
  assert.throws(() => chatMessage(host, "\u200c\u200d"), /Add some text/);
  assert.doesNotThrow(() => chatMessage(host, "x".repeat(8000)));
  assert.throws(() => chatMessage(host, '{"input":"' + "x".repeat(8000) + '"}'), /8,000-character/);
  assert.deepEqual(chatMessage({ getHostCapabilities: () => ({ experimental: { "openai/message": {} } }) }, "x".repeat(9000)).content, [{ type: "text", text: "x".repeat(9000) }]);
});

test("host text rules never silently alter an exact JSON argument", () => {
  const host = { getHostCapabilities: () => ({}) };
  for (const path of ["/projects/with\u200bspace", "/projects/" + " ".repeat(65) + "app", "/projects/with\u00adhyphen"]) {
    const text = `Use these exact arguments: ${JSON.stringify({ projectPath: path })}`;
    assert.throws(() => chatMessage(host, text), /Copy it into chat to preserve the exact text/);
  }
  assert.throws(() => chatMessage(host, "a\n\n\n\nb"), /whitespace/);
  assert.throws(() => chatMessage(host, "a\r\n\r\n\r\n\r\nb"), /whitespace/);
});

test("every rejected host request has uncertain delivery and never retries", async () => {
  for (const error of [new Error("Transport closed"), Object.assign(new Error("Timeout"), { code: -32001 }), new Error("No active composer")]) {
    let calls = 0;
    await assert.rejects(sendChatMessage({
      getHostCapabilities: () => ({}),
      async sendMessage() { calls++; throw error; },
    }, "Explain this log"), e => e instanceof ChatDeliveryUnconfirmed && e.timedOut === ("code" in error));
    assert.equal(calls, 1);
  }
});

test("validation failures send nothing and explicit refusals stay distinct", async () => {
  let calls = 0;
  const app = { getHostCapabilities: () => ({}), async sendMessage() { calls++; return { isError: true }; } };
  await assert.rejects(sendChatMessage(app, "x".repeat(8001)), /8,000-character/);
  assert.equal(calls, 0);
  assert.deepEqual(await sendChatMessage(app, "Explain this log"), { isError: true });
  assert.equal(calls, 1);
});
