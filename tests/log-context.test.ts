import test from "node:test";
import assert from "node:assert/strict";
import type { App } from "@modelcontextprotocol/ext-apps";
import type { OpenAIExtensions, OpenAIModelContextHostState } from "@openai/mcp-extensions/app";
import { PanelContext } from "../src/ui/model-context.ts";
import { stackLogs } from "../src/shared/logs.ts";
import { UDID, PNG } from "./fixtures.ts";

const simulator = { udid: UDID, name: "iPhone", state: "Booted", runtime: "iOS 26" };
const log = stackLogs([{ timestamp: "2026-09-30T12:00:00Z", message: "Request failed", level: "error", source: "js", origin: "metro", stack: "at load (App.tsx:9:3)", sequence: 1 }])[0];

test("chat actions include the clicked log and use the prompt for its severity", async () => {
  const messages: Parameters<App["sendMessage"]>[0][] = [];
  const context = new PanelContext({
    getHostCapabilities: () => ({ message: { text: {} } }),
    async sendMessage(params: Parameters<App["sendMessage"]>[0]) { messages.push(params); return {}; },
  } as App, {} as OpenAIExtensions);
  for (const level of ["error", "warn", "info", "debug"] as const) {
    await context.sendLogToChat({ ...log, level });
    const message = messages.at(-1)!;
    assert.equal(message.role, "user");
    assert.match(JSON.stringify(message.content), level === "error" || level === "warn" ? /Help me fix/ : /Explain this log/);
    assert.match(JSON.stringify(message.content), /Request failed/);
    assert.match(JSON.stringify(message.content), /App.tsx:9:3/);
  }
});

test("chat actions report host rejection and unsupported hosts", async () => {
  const context = new PanelContext({
    getHostCapabilities: () => ({ message: { text: {} } }),
    async sendMessage() { return { isError: true }; },
  } as unknown as App, {} as OpenAIExtensions);
  await assert.rejects(context.sendLogToChat(log), /Could not send/);
  const unsupported = new PanelContext({ getHostCapabilities: () => ({}) } as App, {} as OpenAIExtensions);
  await assert.rejects(unsupported.sendLogToChat(log), /does not support chat/);
});

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
  const context = new PanelContext({ getHostCapabilities: () => ({ updateModelContext: { image: {} } }) } as App, { modelContext } as OpenAIExtensions);
  return { context, updates, clear() { current = null; context.hostChanged(); }, removeContent() { if (current) current = { ...current, content: [] }; context.hostChanged(); }, removeScreenshot(id: string) { if (current) current = { ...current, updateId: "removed", content: current.content?.filter(item => item._meta?.["mobile-dev/screenshotId"] !== id) }; context.hostChanged(); }, fail() { failure = true; }, hold(value: Promise<void>) { gate = value; } };
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

test("Android selection shares its serial and platform for agent-device control", async () => {
  const { context, updates } = fixture();
  context.selectSimulator({ udid: "emulator-5554", name: "Pixel", state: "Booted", runtime: "Android", platform: "android" });
  await context.attach(undefined);
  assert.match(JSON.stringify(updates.at(-1)?.content), /emulator-5554/);
  assert.match(JSON.stringify(updates.at(-1)?.content), /serial.*platform android/);
});

const screenshot = { id: "capture-1", data: PNG.toString("base64"), simulator };

test("screenshots append to chat alongside the log and retain their original simulator", async () => {
  const { context, updates } = fixture();
  context.selectSimulator(simulator); await context.attach(log);
  assert.equal(await context.attachScreenshot(screenshot), true);
  context.selectSimulator({ ...simulator, name: "Other simulator" });
  await context.attachScreenshot({ ...screenshot, id: "capture-2" });
  await context.attach(undefined);
  const last = updates.at(-1)!;
  const images = last.content!.filter(item => item.type === "image");
  assert.equal(images.length, 2);
  assert.equal(images[0].data, screenshot.data);
  assert.match(images[0]._meta?.["openai/title"] as string, /iPhone/);
  assert.equal(last.structuredContent?.selectedLog, null);
  assert.deepEqual(last.structuredContent?.screenshotIds, ["capture-1", "capture-2"]);
});

test("removing one screenshot preserves the other screenshot and the attached log", async () => {
  const { context, updates, removeScreenshot } = fixture();
  await context.attach(log); await context.attachScreenshot(screenshot);
  await context.attachScreenshot({ ...screenshot, id: "capture-2" });
  removeScreenshot("capture-1");
  context.selectSimulator(simulator); await context.attach(log);
  assert.deepEqual(updates.at(-1)?.structuredContent?.screenshotIds, ["capture-2"]);
  assert.deepEqual(updates.at(-1)?.structuredContent?.selectedLog, log);
});

test("a host clear during screenshot attachment wins over the pending write", async () => {
  const { context, updates, clear, hold } = fixture(); let release!: () => void;
  hold(new Promise<void>(resolve => { release = resolve; }));
  const writing = context.attachScreenshot(screenshot); await new Promise(resolve => setTimeout(resolve, 0));
  clear(); release(); assert.equal(await writing, false);
  await new Promise(resolve => setTimeout(resolve, 0));
  context.selectSimulator(simulator); await context.attach(undefined);
  assert.deepEqual(updates.at(-1)?.structuredContent?.screenshotIds, []);
  assert.equal(updates.at(-1)?.content?.some(item => item.type === "image"), false);
});

test("a failed screenshot attachment restores the prior image", async () => {
  const { context, updates, fail } = fixture(); await context.attachScreenshot(screenshot);
  fail(); await assert.rejects(context.attachScreenshot({ ...screenshot, id: "capture-2" }), /Host refused/);
  await assert.rejects(context.attach(log), /Host refused/);
  assert.deepEqual(updates.at(-1)?.structuredContent?.screenshotIds, ["capture-1"]);
});

test("a host without image attachment support rejects screenshots", async () => {
  const context = new PanelContext({ getHostCapabilities: () => ({}) } as App, { modelContext: {} } as OpenAIExtensions);
  assert.equal(context.canAttachScreenshots, false);
  await assert.rejects(context.attachScreenshot(screenshot), /does not support screenshot/);
});

test("side by side devices share both IDs while logs keep the active selection", async () => {
  const { context, updates } = fixture();
  const android = { udid: "emulator-5554", name: "Pixel", state: "Booted", runtime: "Android", platform: "android" as const };
  context.selectSimulators([simulator, android], android);
  await context.attach(log);
  const last = updates.at(-1)!;
  assert.deepEqual(last.structuredContent?.selectedSimulators, [simulator, android]);
  assert.equal(last.structuredContent?.selectedSimulator, android);
  assert.match(JSON.stringify(last.content), /Active Android simulator: Pixel/);
  assert.match(JSON.stringify(last.content), /Visible iOS simulator: iPhone/);
  context.selectSimulators([simulator], simulator);
  await context.attach(log);
  assert.deepEqual(updates.at(-1)?.structuredContent?.selectedSimulators, [simulator]);
  assert.equal(updates.at(-1)?.content?.some(item => item.type === "text" && item.text.includes("emulator-5554")), false);
  assert.deepEqual(updates.at(-1)?.structuredContent?.selectedLog, log);
});
