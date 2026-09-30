import test from "node:test";
import assert from "node:assert/strict";
import type { App } from "@modelcontextprotocol/ext-apps";
import type { OpenAIExtensions, OpenAIModelContextHostState } from "@openai/mcp-extensions/app";
import { PanelContext } from "../src/ui/model-context.ts";
import { stackLogs } from "../src/shared/logs.ts";
import { UDID } from "./fixtures.ts";

const simulator = { udid: UDID, name: "iPhone", state: "Booted", runtime: "iOS 26" };
const log = stackLogs([{ timestamp: "2026-09-30T12:00:00Z", message: "Request failed", level: "error", source: "js", origin: "metro", stack: "at load (App.tsx:9:3)", sequence: 1 }])[0];

function fixture() {
  let current: OpenAIModelContextHostState | undefined;
  const updates: Parameters<App["updateModelContext"]>[0][] = [];
  let gate: Promise<void> | undefined;
  let failure = false;
  const modelContext = {
    getCurrent: () => current,
    async update(params: Parameters<App["updateModelContext"]>[0]) {
      updates.push(params); await gate;
      if (failure) throw new Error("Host refused context");
      current = { ...params, updateId: String(updates.length) };
      return { updateId: current.updateId };
    },
  };
  const context = new PanelContext({} as App, { modelContext } as OpenAIExtensions);
  return { context, updates, clear() { current = null; context.hostChanged(); }, removeContent() { if (current) current = { ...current, content: [] }; context.hostChanged(); }, fail() { failure = true; }, hold(value: Promise<void>) { gate = value; } };
}

test("attaching a log preserves simulator context and contains the full message and stack", async () => {
  const { context, updates } = fixture(); context.selectSimulator(simulator); await context.attach(log);
  const last = updates.at(-1)!;
  assert.equal(last.structuredContent?.selectedSimulator, simulator);
  assert.deepEqual(last.structuredContent?.selectedLog, log);
  assert.equal(last.content?.length, 2);
  assert.match(JSON.stringify(last.content), /App.tsx:9:3/);
  context.selectSimulator({ ...simulator, name: "Other simulator" });
  await context.attach(log);
  assert.deepEqual(updates.at(-1)?.structuredContent?.selectedLog, log);
});

test("clearing an attachment in the host prevents a later simulator refresh from restoring it", async () => {
  const { context, updates, clear, removeContent } = fixture();
  await context.attach(log); clear(); assert.equal(context.attachedKey, undefined);
  context.selectSimulator(simulator); await context.attach(undefined);
  assert.equal(updates.at(-1)?.structuredContent?.selectedLog, null);
  await context.attach(log); removeContent(); assert.equal(context.attachedKey, undefined);
});

test("failed context writes restore the previous attachment and do not report success", async () => {
  const { context, fail } = fixture(); await context.attach(log); const key = context.attachedKey;
  fail(); await assert.rejects(context.attach({ ...log, message: "Other error" }), /Host refused/);
  assert.equal(context.attachedKey, key);
});

test("a host clear during an attachment write queues a removal without deadlock", async () => {
  const { context, updates, clear, hold } = fixture(); let release!: () => void;
  hold(new Promise<void>(resolve => { release = resolve; }));
  const writing = context.attach(log); await new Promise(resolve => setTimeout(resolve, 0));
  clear(); release(); await writing;
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(context.attachedKey, undefined); assert.equal(updates.at(-1)?.structuredContent?.selectedLog, null);
});
