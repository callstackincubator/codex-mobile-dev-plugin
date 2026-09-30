import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import type { App } from "@modelcontextprotocol/ext-apps";
import { startLiveReload } from "../src/ui/live-reload.ts";

test("live reload waits for stream cleanup and keeps the workspace view", async t => {
  const revision = "a".repeat(64);
  const dom = new JSDOM(`<html data-view="workspace"><head><meta name="mobile-dev-live-revision" content="${revision}"></head><body>old</body></html>`, { runScripts: "dangerously" });
  t.after(() => dom.window.close());
  const events: string[] = [];
  let finishCleanup!: () => void;
  let finishReload!: () => void;
  const completed = new Promise<void>(resolve => { finishReload = resolve; });
  const cleanup = new Promise<void>(resolve => { finishCleanup = resolve; });
  let hostEvents = 0;
  dom.window.addEventListener("mobile-dev-host-probe", () => { hostEvents++; });
  const app = {
    async readServerResource({ uri }: { uri: string }) {
      assert.equal(uri, `ui://mobile-dev/live?after=${revision}`);
      return { contents: [{ text: JSON.stringify({ revision: "b".repeat(64), html: '<html data-view="panel" data-layout="stacked"><head></head><body><div id="root">jonas</div><script>window.dispatchEvent(new Event("mobile-dev-host-probe"))</script></body></html>' }) }] };
    },
    async close() { events.push("closed"); },
  } as unknown as App;
  const replace = dom.window.document.body.replaceChildren.bind(dom.window.document.body);
  dom.window.document.body.replaceChildren = (...nodes) => { events.push("written"); replace(...nodes); finishReload(); };
  const stop = startLiveReload(app, async () => { events.push("disposing"); await cleanup; events.push("disposed"); }, dom.window.document);
  t.after(stop);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ["disposing"]);
  assert.equal(dom.window.document.body.textContent, "old");
  finishCleanup();
  await completed;
  assert.deepEqual(events, ["disposing", "disposed", "closed", "written"]);
  assert.equal(dom.window.document.documentElement.dataset.view, "workspace");
  assert.equal(dom.window.document.documentElement.dataset.layout, "split");
  assert.equal(dom.window.document.getElementById("root")?.textContent, "jonas");
  assert.equal(hostEvents, 1, "The new script runs and the host's window listener survives");
});

test("closing the panel ignores a late live update", async t => {
  const dom = new JSDOM(`<head><meta name="mobile-dev-live-revision" content="${"a".repeat(64)}"></head><body>old</body>`);
  t.after(() => dom.window.close());
  let finishRead!: (value: unknown) => void;
  const pending = new Promise(resolve => { finishRead = resolve; });
  let disposed = false;
  const app = { readServerResource: () => pending } as unknown as App;
  const stop = startLiveReload(app, async () => { disposed = true; }, dom.window.document);
  stop();
  finishRead({ contents: [{ text: JSON.stringify({ revision: "b".repeat(64), html: "new" }) }] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(disposed, false);
  assert.equal(dom.window.document.body.textContent, "old");
});
