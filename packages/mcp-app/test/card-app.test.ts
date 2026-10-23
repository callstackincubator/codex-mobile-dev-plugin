import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const built = await build({
  entryPoints: ["packages/mcp-app/src/main.tsx"],
  bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
  loader: { ".css": "empty", ".woff2": "empty", ".woff": "dataurl" },
  define: { "process.env.NODE_ENV": '"production"' },
});

// Every chat card shares one bootstrap: it renders, connects to the host, applies the
// host's styles, labels telemetry, and tears down when the host asks.
for (const view of ["recording", "comparison", "tracesift"] as const) test(`the ${view} card connects, styles itself and tears down`, async t => {
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
  assert.ok(window.document.getElementById("root")?.childElementCount, "The card renders into the page.");
  if (view === "tracesift") await until(() => calls.includes("mobile_get_tracesift_project"), "load the saved TraceSift project");
  send({ id: "teardown", method: "ui/resource-teardown", params: {} });
  await until(() => tornDown, "acknowledge teardown");
});
