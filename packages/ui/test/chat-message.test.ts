import test from "node:test";
import assert from "node:assert/strict";
import { chatMessage } from "../src/chat-message.ts";

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
  const text = "👩‍💻 فارسی\u200c हिंदी\r\n\u200b\u00ad\n\n\n\n" + " ".repeat(80) + "hello";
  const message = chatMessage(host, text);
  assert.equal(message.content[0].type, "text");
  assert.deepEqual(message.content, [{ type: "text", text: "👩‍💻 فارسی\u200c हिंदी\n\n\n" + " ".repeat(64) + "hello" }]);
  assert.throws(() => chatMessage(host, "\u200b\t\n"), /Add some text/);
  assert.doesNotThrow(() => chatMessage(host, "x".repeat(8000)));
  assert.throws(() => chatMessage(host, '{"input":"' + "x".repeat(8000) + '"}'), /8,000-character/);
  assert.deepEqual(chatMessage({ getHostCapabilities: () => ({ experimental: { "openai/message": {} } }) }, "x".repeat(9000)).content, [{ type: "text", text: "x".repeat(9000) }]);
});
