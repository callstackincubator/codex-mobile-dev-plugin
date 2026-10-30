import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { runBundle } from "@mobile-dev/test-support/bundle.ts";
import { waitFor } from "@mobile-dev/test-support/wait.ts";

const built = await build({
  entryPoints: ["packages/mcp-app/src/main.tsx"],
  bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
  loader: { ".css": "empty", ".woff2": "empty", ".woff": "dataurl" },
  define: { "process.env.NODE_ENV": '"production"' },
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
  runBundle(window, built.outputFiles[0].text);
  await waitFor(() => initialized, { message: `The ${view} card did not connect` });
  await waitFor(() => window.document.documentElement.dataset.theme === "dark" || window.document.documentElement.classList.contains("dark"), { message: `The ${view} card did not apply the host theme` });
  // React commits the first render on its own schedule, which can follow the theme.
  await waitFor(() => Boolean(window.document.getElementById("root")?.childElementCount), { message: `The ${view} card did not render into the page` });
  if (view === "devices") assert.match(window.document.getElementById("root")!.textContent ?? "", /earlier version of Mobile Dev/);
  if (view === "tracesift") await waitFor(() => calls.includes("mobile_get_tracesift_project"), { message: `The ${view} card did not load the saved TraceSift project` });
  send({ id: "teardown", method: "ui/resource-teardown", params: {} });
  await waitFor(() => tornDown, { message: `The ${view} card did not acknowledge teardown` });
});
