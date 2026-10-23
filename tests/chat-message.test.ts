import test from "node:test";
import assert from "node:assert/strict";
import { chatMessage } from "../src/ui/chat-message.ts";

test("standard hosts receive a complete message without OpenAI routing", () => {
  const message = chatMessage({ getHostCapabilities: () => ({ message: { text: {} } }) }, "Explain this log: failed request");
  assert.deepEqual(message, { role: "user", content: [{ type: "text", text: "Explain this log: failed request" }] });
});

test("advertised OpenAI routing is preserved", () => {
  const message = chatMessage({ getHostCapabilities: () => ({ experimental: { "openai/message": {} } }) }, "Explain this log");
  assert.deepEqual(message._meta, { "openai/message": { target: "active", send: true } });
});
