import test from "node:test";
import assert from "node:assert/strict";
import { App } from "@modelcontextprotocol/ext-apps";
import { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { OpenAIExtensions } from "@openai/mcp-extensions/app";
import { PanelContext } from "../src/ui/model-context.ts";
import { canMessage, canUpdateTextContext, chatMessage } from "../src/ui/chat-message.ts";

test("VS Code prepares through the real bridge without message.text and retains context", async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { documentElement: { dataset: { host: "vscode" } } } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, "document", previous); else Reflect.deleteProperty(globalThis, "document"); });
  const capabilities = { serverTools: {}, serverResources: {}, updateModelContext: { image: {}, structuredContent: {} } };
  const app = new App({ name: "vscode-test", version: "1" }, {}, { autoResize: false });
  const bridge = new AppBridge(null, { name: "Visual Studio Code", version: "1" }, capabilities);
  const messages: Parameters<App["sendMessage"]>[0][] = [];
  const contexts: Parameters<App["updateModelContext"]>[0][] = [];
  let reject = false;
  bridge.onmessage = async params => { if (reject) return { isError: true }; messages.push(params); return {}; };
  bridge.onupdatemodelcontext = async params => { contexts.push(params); return {}; };
  const [appTransport, hostTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await app.close(); await bridge.close(); });
  await bridge.connect(hostTransport);
  await app.connect(appTransport);
  assert.equal(app.getHostCapabilities()?.message, undefined);
  assert.equal(canMessage(app), true);
  assert.equal(canUpdateTextContext(app), true);
  const context = new PanelContext(app, {} as OpenAIExtensions);
  const simulator = { udid: "test-device", name: "Test device", state: "Booted", runtime: "iOS" };
  await context.attachScreenshot({ id: "shot", simulator, data: "cG5n", mimeType: "image/png" });
  await context.attachAnnotation({
    id: "note", number: 1, text: "Make this button larger", simulator,
    screenshot: { id: "screen", data: "cG5n", capturedAt: "2026-10-23T00:00:00Z" },
    screen: { width: 100, height: 200, units: "points" }, point: { x: 20, y: 30 },
    component: { name: "Continue", depth: 0, bounds: { x: 10, y: 20, width: 40, height: 30 } },
  });
  await context.sendAnnotationsToChat(simulator.udid);
  assert.equal(messages.length, 1);
  assert.match(JSON.stringify(messages[0].content), /Make this button larger/);
  assert.equal(messages[0]._meta, undefined);
  assert.equal(context.attachmentCount, 2, "Preparation must not clear screenshot or annotation context");
  assert.equal(context.screenAnnotations.length, 1);
  assert.ok(contexts.at(-1)?.content?.some(item => item.type === "image"));
  reject = true;
  await assert.rejects(context.sendAnnotationsToChat(simulator.udid), /Could not send/);
  assert.equal(messages.length, 1);
  assert.equal(context.attachmentCount, 2);
  await context.clearAttachments();
  assert.equal(context.attachmentCount, 0);
  assert.ok(!contexts.at(-1)?.content?.some(item => item.type === "image"));
  assert.equal(chatMessage({ getHostCapabilities: () => ({ experimental: { "openai/message": {} } }) }, "Question")._meta, undefined);
  // A missing flag on an unrelated host does not enable the VS Code adapter.
  document.documentElement.dataset.host = "cursor";
  assert.equal(canMessage(app), false);
  assert.equal(canUpdateTextContext(app), false);
});
