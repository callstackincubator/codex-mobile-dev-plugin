import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { BroadcastChannel } from "node:worker_threads";

const built = await build({
  entryPoints: ["packages/mcp-app/src/main.tsx"],
  bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
  loader: { ".css": "empty", ".woff2": "empty", ".woff": "dataurl" },
  define: { "process.env.NODE_ENV": '"production"' },
});

test("a newer workspace stops the old UI, closes its context, and still acknowledges teardown", async t => {
  const scope = "113d442f-ea1f-4427-aacb-9a6de8c21b0d";
  function workspace(sequence: number) {
    const dom = new JSDOM('<html data-view="panel"><head><meta name="mobile-dev-environment" content="development"><meta name="mobile-dev-telemetry" content="off"></head><body><div id="root"></div></body></html>', {
      pretendToBeVisual: true, runScripts: "outside-only", url: "https://mobile-dev.test/",
    });
    const window = dom.window;
    window.console.debug = () => {};
    window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    window.BroadcastChannel = BroadcastChannel;
    let initialized = false;
    let tornDown = false;
    const context: unknown[] = [];
    function send(message: object) { window.dispatchEvent(new window.MessageEvent("message", { data: { jsonrpc: "2.0", ...message }, source: window })); }
    window.postMessage = message => {
      if (message.method === "ui/initialize") send({ id: message.id, result: {
        protocolVersion: "2026-01-26", hostInfo: { name: "claude-ai", version: "1" },
        hostCapabilities: { updateModelContext: { text: {} } }, hostContext: { theme: "dark", safeAreaInsets: { top: 4, right: 16, bottom: 8, left: 12 } },
      } });
      else if (message.method === "ui/notifications/initialized") initialized = true;
      else if (message.method === "ui/update-model-context") { context.push(message.params); send({ id: message.id, result: {} }); }
      else if (message.id === "teardown") tornDown = true;
      else if (message.id !== undefined) send({ id: message.id, result: {} });
    };
    window.eval(built.outputFiles[0].text);
    async function ready() {
      for (let i = 0; i < 200 && !initialized; i++) await setTimeout(5);
      assert.ok(initialized);
      send({ method: "ui/notifications/tool-result", params: { content: [], structuredContent: { workspaceInstance: { scope, createdAt: 1, sequence } } } });
    }
    async function close() {
      send({ id: "teardown", method: "ui/resource-teardown", params: {} });
      for (let i = 0; i < 200 && !tornDown; i++) await setTimeout(5);
      assert.ok(tornDown);
      window.close();
    }
    t.after(close);
    return { window, ready, context, send };
  }
  const first = workspace(1); await first.ready();
  const second = workspace(2); await second.ready();
  for (let i = 0; i < 600 && !first.window.document.getElementById("root")?.textContent?.includes("Use the newest Mobile Dev view"); i++) await setTimeout(5);
  assert.equal(first.window.document.querySelector("main"), null);
  assert.match(first.window.document.getElementById("root")!.textContent ?? "", /Use the newest Mobile Dev view/);
  assert.ok(second.window.document.querySelector("main"));
  assert.equal(second.window.document.documentElement.style.getPropertyValue("--workspace-right-inset"), "16px");
  const previous = first.context.length;
  first.send({ method: "ui/notifications/host-context-changed", params: { theme: "light" } });
  first.window.dispatchEvent(new first.window.Event("focus"));
  await setTimeout(10);
  assert.equal(first.context.length, previous, "A retired workspace never resumes model context writes.");
});

// Devices cards saved by earlier releases go through the same bootstrap.
for (const view of ["recording", "comparison", "tracesift", "devices"] as const) test(`the ${view} card connects, styles itself and tears down`, async t => {
  const dom = new JSDOM(`<html data-view="${view}"><head><meta name="mobile-dev-environment" content="development"><meta name="mobile-dev-telemetry" content="off"></head><body><div id="root"></div></body></html>`, {
    pretendToBeVisual: true, runScripts: "outside-only", url: "https://mobile-dev.test/",
  });
  t.after(() => dom.window.close());
  const window = dom.window;
  window.console.debug = () => {};
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  let initialized = false;
  let tornDown = false;
  const calls: string[] = [];
  function send(message: object) {
    window.dispatchEvent(new window.MessageEvent("message", { data: { jsonrpc: "2.0", ...message }, source: window }));
  }
  window.postMessage = message => {
    if (message.method === "ui/initialize") send({ id: message.id, result: {
      protocolVersion: "2026-01-26", hostInfo: { name: "claude-ai", version: "1" },
      hostCapabilities: { serverTools: {}, serverResources: {} }, hostContext: { theme: "dark" },
    } });
    else if (message.method === "ui/notifications/initialized") initialized = true;
    else if (message.method === "tools/call") { calls.push(message.params.name); send({ id: message.id, result: { content: [] } }); }
    else if (message.id === "teardown") tornDown = true;
    else if (message.id !== undefined) send({ id: message.id, result: {} });
  };
  async function until(condition: () => boolean, what: string) {
    for (let attempt = 0; attempt < 200; attempt++) {
      if (condition()) return;
      await setTimeout(5);
    }
    assert.fail(`The ${view} card did not ${what}.`);
  }
  window.eval(built.outputFiles[0].text);
  await until(() => initialized, "connect");
  await until(() => window.document.documentElement.dataset.theme === "dark" || window.document.documentElement.classList.contains("dark"), "apply the host theme");
  // React commits the first render on its own schedule, which can follow the theme.
  await until(() => Boolean(window.document.getElementById("root")?.childElementCount), "render into the page");
  if (view === "devices") assert.match(window.document.getElementById("root")!.textContent ?? "", /earlier version of Mobile Dev/);
  // The card asks for no project folder; Investigate hands the finding to the chat as is.
  if (view === "tracesift") assert.equal(calls.includes("mobile_get_tracesift_project"), false);
  send({ id: "teardown", method: "ui/resource-teardown", params: {} });
  await until(() => tornDown, "acknowledge teardown");
});
