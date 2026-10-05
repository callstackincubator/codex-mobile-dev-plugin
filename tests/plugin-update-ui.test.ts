import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const update = { status: "available", currentVersion: "0.1.131", latestVersion: "0.1.132" };

async function banner(t: test.TestContext, app: unknown) {
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, runScripts: "outside-only", url: "https://mobile-dev.test" });
  const bundle = await build({
    stdin: { contents: `
      import { createElement } from "react";
      import { createRoot } from "react-dom/client";
      import { flushSync } from "react-dom";
      import { PluginUpdateController } from "./src/ui/plugin-updates.ts";
      import { PluginUpdateBanner } from "./src/ui/components/plugin-update-banner.tsx";
      export function mount(app) {
        const controller = new PluginUpdateController(app);
        const element = document.getElementById("root");
        const root = createRoot(element);
        const banner = createElement(PluginUpdateBanner, { controller });
        flushSync(() => { root.render(banner); });
        return { controller, dispose() { controller.dispose(); root.unmount(); } };
      }
    `, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, format: "iife", globalName: "UpdateUI", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  dom.window.eval(bundle.outputFiles[0].text);
  const mounted = dom.window.UpdateUI.mount(app);
  t.after(() => { mounted.dispose(); dom.window.close(); });
  const settle = () => new Promise(resolve => { dom.window.setTimeout(resolve, 0); });
  function button(text: string): HTMLButtonElement {
    const buttons = dom.window.document.querySelectorAll("button");
    for (const button of buttons) if (button.textContent === text) return button;
    throw new Error(`Missing ${text} button`);
  }
  return { dom, ...mounted, settle, button };
}

test("the banner handles progress, failures, retry, release notes, and restart instructions", async t => {
  let installs = 0;
  let finish: (value: unknown) => void = () => {};
  const links: string[] = [];
  const app = {
    async callServerTool({ name }: { name: string }) {
      if (name === "mobile_check_plugin_update") return { content: [], structuredContent: { update } };
      installs++;
      return new Promise(resolve => { finish = resolve; });
    },
    async openLink({ url }: { url: string }) { links.push(url); return {}; },
  };
  const view = await banner(t, app);
  view.controller.setAvailable(true);
  await view.settle();
  assert.match(view.dom.window.document.body.textContent!, /Mobile Dev 0.1.132 is available/);
  const releaseNotes = view.button("Release notes");
  releaseNotes.click();
  await view.settle();
  assert.deepEqual(links, ["https://github.com/callstackincubator/codex-mobile-dev-plugin/releases/tag/v0.1.132"]);
  const install = view.button("Update");
  install.click();
  install.click();
  await view.settle();
  assert.equal(installs, 1);
  const updating = view.button("Updating…");
  assert.equal(updating.disabled, true);
  finish({ isError: true, content: [{ type: "text", text: "Network unavailable" }] });
  await view.settle();
  assert.match(view.dom.window.document.body.textContent!, /Network unavailable/);
  const retry = view.button("Retry update");
  retry.click();
  await view.settle();
  finish({ content: [], structuredContent: { update: { ...update, status: "updated" } } });
  await view.settle();
  assert.equal(installs, 2);
  assert.match(view.dom.window.document.body.textContent!, /Quit and reopen Codex to use the new version/);
  const busy = view.dom.window.document.querySelector('[aria-busy="true"]');
  assert.equal(busy, null);
  await view.controller.check();
  const dismiss = view.dom.window.document.querySelector('[aria-label="Dismiss update notice"]') as HTMLButtonElement;
  dismiss.click();
  await view.settle();
  const dismissed = view.dom.window.document.querySelector("aside");
  assert.equal(dismissed, null);
});

test("hidden workspaces do not check, dismissed versions stay hidden, and teardown cancels requests", async t => {
  let checks = 0;
  let signal: AbortSignal | undefined;
  const app = {
    async callServerTool(_params: unknown, options: { signal: AbortSignal }) {
      checks++;
      signal = options.signal;
      return { content: [], structuredContent: { update } };
    },
    async openLink() { return {}; },
  };
  const view = await banner(t, app);
  Object.defineProperty(view.dom.window.document, "visibilityState", { value: "hidden", configurable: true });
  view.controller.setAvailable(true);
  await view.settle();
  assert.equal(checks, 0);
  Object.defineProperty(view.dom.window.document, "visibilityState", { value: "visible", configurable: true });
  const change = new view.dom.window.Event("visibilitychange");
  view.dom.window.document.dispatchEvent(change);
  await view.settle();
  assert.equal(checks, 1);
  view.controller.dismiss();
  await view.controller.check();
  await view.settle();
  const dismissed = view.dom.window.document.querySelector("aside");
  assert.equal(dismissed, null);
  view.controller.dispose();
  assert.equal(signal?.aborted, true);
  view.dom.window.document.dispatchEvent(change);
  assert.equal(checks, 2);
});
