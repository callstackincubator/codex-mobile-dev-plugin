import test from "node:test";
import assert from "node:assert/strict";
import type { App } from "@modelcontextprotocol/ext-apps";
import type { PanelContext } from "../src/ui/model-context.ts";
import { LogsPanel } from "../src/ui/logs-panel.ts";

const device = { udid: "emulator-5554", name: "Pixel", state: "Booted", runtime: "Android", platform: "android" as const };
async function waitFor(predicate: () => boolean) {
  const end = Date.now() + 2000;
  while (!predicate()) { assert.ok(Date.now() < end); await new Promise(resolve => setTimeout(resolve, 5)); }
}

test("pausing closes a log session, and a late session cannot restore a closed panel", async t => {
  const calls: { name: string; arguments: Record<string, unknown> }[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const app = {
    async callServerTool(call: { name: string; arguments: Record<string, unknown> }) {
      calls.push(call);
      if (call.name === "mobile_logs_session") { await gate; return { content: [], _meta: { sessionId: "late", logsUri: "logs://mobile-dev/late" } }; }
      return { content: [] };
    },
    async readServerResource() { throw new Error("A late session must not read resources"); },
  } as unknown as App;
  const panel = new LogsPanel(app, { canAttach: true } as PanelContext);
  t.after(() => panel.dispose());
  panel.selectSimulator(device); panel.setAvailable(true); panel.show();
  await waitFor(() => calls.some(call => call.name === "mobile_logs_session"));
  assert.deepEqual(calls[0].arguments, { options: { native: { platform: "android", deviceId: device.udid } } });
  panel.togglePause(); assert.equal(panel.getSnapshot().status, "Paused");
  panel.toggle(); release();
  await waitFor(() => calls.some(call => call.name === "mobile_logs_close"));
  assert.equal(panel.getSnapshot().open, false);
  assert.equal(panel.getSnapshot().status, "Closed");
});

test("source discovery ignores results for an old Metro URL and preserves explicit none", async t => {
  let release!: () => void;
  let hold = true;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const app = { async callServerTool() {
    if (hold) await gate;
    return { content: [], structuredContent: { android: [{ id: device.udid, name: device.name }], metro: [{ id: "metro-1", title: "App" }], errors: [] } };
  } } as unknown as App;
  const panel = new LogsPanel(app, { canAttach: true } as PanelContext);
  t.after(() => panel.dispose()); panel.setAvailable(true); panel.configure({ native: "none" });
  const discovering = panel.discover();
  panel.configure({ metroUrl: "http://127.0.0.1:8082" }); release(); await discovering;
  assert.equal(panel.getSnapshot().metro.length, 0);
  assert.equal(panel.getSnapshot().discovering, false);
  hold = false; await panel.discover();
  assert.equal(panel.getSnapshot().native, "none");
  assert.equal(panel.getSnapshot().metro[0].id, "metro-1");
});
