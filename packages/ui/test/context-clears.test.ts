import test from "node:test";
import assert from "node:assert/strict";
import type { App } from "@modelcontextprotocol/ext-apps";
import type { ScreenAnnotation } from "../../shared/src/screen-annotations.ts";
import { CONTEXT_CLEARS } from "../../shared/src/panel-target.ts";
import { PanelContext } from "../src/model-context.ts";

const annotation: ScreenAnnotation = {
  id: "note", number: 1, text: "Make this smaller.",
  simulator: { udid: "test-device", name: "iPhone", runtime: "iOS 26", state: "Booted", platform: "ios" },
  component: { name: "Title", depth: 1, bounds: { x: 0, y: 0, width: 10, height: 10 } },
  point: { x: 1, y: 1 }, screen: { width: 402, height: 874, units: "points" },
  screenshot: { id: "capture", data: "local-only", capturedAt: "2026-10-01T10:00:00Z" },
};

// A browser panel: no host attachments, model context goes to the server.
function browser() {
  let hostContext: Record<string, unknown> = {};
  const updates: Parameters<App["updateModelContext"]>[0][] = [];
  const context = new PanelContext({
    getHostCapabilities: () => ({ updateModelContext: { text: {}, image: {} } }),
    getHostContext: () => hostContext,
    async updateModelContext(params: Parameters<App["updateModelContext"]>[0]) { updates.push(params); return {}; },
  } as unknown as App);
  return { context, updates, host(clears?: number) { hostContext = clears === undefined ? {} : { [CONTEXT_CLEARS]: clears }; context.hostChanged(); } };
}

test("a clear from the agent drops the notes a browser panel still shows", async () => {
  const f = browser();
  f.host(0);
  await f.context.attachAnnotation(annotation);
  assert.equal(f.context.attachmentCount, 1);
  f.host(0);
  assert.equal(f.context.attachmentCount, 1, "an unchanged count keeps the notes");
  f.host(1);
  assert.equal(f.context.attachmentCount, 0);
  assert.equal(f.context.screenAnnotations.length, 0);
});

test("the count a panel opens with is not a clear", async () => {
  const f = browser();
  f.host(3);
  await f.context.attachAnnotation(annotation);
  assert.equal(f.context.attachmentCount, 1);
  f.host(3);
  assert.equal(f.context.attachmentCount, 1);
  f.host(4);
  assert.equal(f.context.attachmentCount, 0);
});

test("notes added after a clear are kept", async () => {
  const f = browser();
  f.host(0);
  f.host(1);
  await f.context.attachAnnotation(annotation);
  f.host(1);
  assert.equal(f.context.attachmentCount, 1);
});

test("a host without the count leaves the notes alone", async () => {
  const f = browser();
  f.host();
  await f.context.attachAnnotation(annotation);
  f.host();
  assert.equal(f.context.attachmentCount, 1);
});
