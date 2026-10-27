import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const update = { status: "available", currentVersion: "0.1.164", latestVersion: "0.1.165" };

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

test("store updates open the exact listing without installing through GitHub", async t => {
  const links: string[] = [];
  const tools: string[] = [];
  const app = {
    async callServerTool({ name }: { name: string }) {
      tools.push(name);
      return { content: [], structuredContent: { update } };
    },
    async openLink({ url }: { url: string }) { links.push(url); return {}; },
  };
  const view = await banner(t, app);
  view.controller.setAvailable(true);
  await view.settle();
  assert.match(view.dom.window.document.body.textContent!, /0.1.165 is available in the plugin store/);
  const open = view.button("Open plugin store");
  open.click();
  await view.settle();
  assert.deepEqual(links, ["https://chatgpt.com/plugins/plugins_6ac4c117f76881918d3676e851fa4005"]);
  assert.deepEqual(tools, ["mobile_check_plugin_update"]);
});

test("migration installs through the store before cleanup and handles progress, retry and restart", async t => {
  let migrations = 0;
  let finish: (value: unknown) => void = () => {};
  const links: string[] = [];
  const migration = { ...update, status: "migration", storeInstalled: false };
  const app = {
    async callServerTool({ name }: { name: string }) {
      if (name === "mobile_check_plugin_update") return { content: [], structuredContent: { update: migration } };
      assert.equal(name, "mobile_migrate_plugin_to_store");
      migrations++;
      return new Promise(resolve => { finish = resolve; });
    },
    async openLink({ url }: { url: string }) { links.push(url); return {}; },
  };
  const view = await banner(t, app);
  view.controller.setAvailable(true);
  await view.settle();
  const open = view.button("Install from plugin store");
  open.click();
  await view.settle();
  assert.equal(links.length, 1);
  assert.equal(migrations, 0);
  const migrate = view.button("Finish migration");
  migrate.click();
  migrate.click();
  await view.settle();
  assert.equal(migrations, 1);
  const finishing = view.button("Finishing…");
  assert.equal(finishing.disabled, true);
  finish({ isError: true, content: [{ type: "text", text: "Install and enable the store version first" }] });
  await view.settle();
  assert.match(view.dom.window.document.body.textContent!, /Install and enable the store version first/);
  const retry = view.button("Finish migration");
  retry.click();
  await view.settle();
  finish({ content: [], structuredContent: { update: { ...migration, status: "migrated", storeInstalled: true } } });
  await view.settle();
  assert.equal(migrations, 2);
  assert.match(view.dom.window.document.body.textContent!, /Quit and reopen Codex to use the store version/);
  const busy = view.dom.window.document.querySelector('[aria-busy="true"]');
  assert.equal(busy, null);
  await view.controller.check();
  const dismiss = view.dom.window.document.querySelector('[aria-label="Dismiss update notice"]') as HTMLButtonElement;
  dismiss.click();
  await view.settle();
  const dismissed = view.dom.window.document.querySelector("aside");
  assert.equal(dismissed, null);
});

test("failed store links stay retryable and an installed store copy can go straight to cleanup", async t => {
  let available = false;
  const app = {
    async callServerTool() { return { content: [], structuredContent: { update: { ...update, status: "migration", storeInstalled: available } } }; },
    async openLink() { return { isError: true }; },
  };
  const view = await banner(t, app);
  view.controller.setAvailable(true);
  await view.settle();
  const open = view.button("Install from plugin store");
  open.click();
  await view.settle();
  assert.match(view.dom.window.document.body.textContent!, /Could not open the plugin store/);
  assert.equal(view.controller.getSnapshot().storeOpened, undefined);
  available = true;
  await view.controller.check();
  await view.settle();
  const finish = view.button("Finish migration");
  assert.equal(finish.disabled, false);
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
