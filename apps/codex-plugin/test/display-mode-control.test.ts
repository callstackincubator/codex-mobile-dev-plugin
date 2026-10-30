import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { runBundle } from "@mobile-dev/test-support/bundle.ts";
import { waitFor } from "@mobile-dev/test-support/wait.ts";

// Both hosts advertise inline and fullscreen. Claude has no control of its own to
// leave the expanded view, so the shared panel offers one; Codex has its own.
for (const [host, entry, shown] of [
  ["shared MCP Apps panel", "packages/mcp-app/src/main.tsx", true],
  ["Codex panel", "apps/codex-plugin/ui/main.tsx", false],
] as const) test(`the ${host} ${shown ? "offers" : "leaves out"} Back to chat in fullscreen`, async t => {
  const built = await build({
    entryPoints: [entry], bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    loader: { ".css": "empty", ".woff2": "empty", ".woff": "empty" }, define: { "process.env.NODE_ENV": '"production"' },
  });
  const dom = new JSDOM('<html data-view="workspace"><head><meta name="mobile-dev-environment" content="development"><meta name="mobile-dev-telemetry" content="off"></head><body><div id="root"></div></body></html>', {
    pretendToBeVisual: true, runScripts: "outside-only", url: "https://mobile-dev.test/",
  });
  const window = dom.window;
  window.console.debug = () => {};
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
  Object.defineProperty(window.HTMLElement.prototype, "clientWidth", { get: () => 400 });
  Object.defineProperty(window.HTMLElement.prototype, "clientHeight", { get: () => 800 });
  let initialized = false;
  let tornDown = false;
  function send(message: object) {
    window.dispatchEvent(new window.MessageEvent("message", { data: { jsonrpc: "2.0", ...message }, source: window }));
  }
  window.postMessage = message => {
    if (message.method === "ui/initialize") send({ id: message.id, result: {
      protocolVersion: "2026-01-26", hostInfo: { name: "test", version: "1" }, hostCapabilities: { serverTools: {}, serverResources: {} },
      hostContext: { displayMode: "fullscreen", availableDisplayModes: ["inline", "fullscreen"] },
    } });
    else if (message.method === "ui/notifications/initialized") initialized = true;
    else if (message.id === "teardown") tornDown = true;
    else if (message.id !== undefined) send({ id: message.id, result: { content: [] } });
  };
  t.after(async () => {
    send({ id: "teardown", method: "ui/resource-teardown", params: {} });
    await waitFor(() => tornDown);
    window.close();
  });
  runBundle(window, built.outputFiles[0].text);
  await waitFor(() => initialized);
  await waitFor(() => window.document.querySelector(".workspace-toolbar") !== null);
  // Hosts follow the handshake with context changes; the control reacts to those.
  send({ method: "ui/notifications/host-context-changed", params: { displayMode: "fullscreen", availableDisplayModes: ["inline", "fullscreen"] } });
  await setTimeout(20);
  const buttons = [...window.document.querySelectorAll(".workspace-toolbar button")].map(button => button.textContent);
  assert.equal(buttons.includes("Back to chat"), shown, buttons.join(", "));
});
