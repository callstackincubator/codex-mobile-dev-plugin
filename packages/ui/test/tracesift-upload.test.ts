import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

test("TraceSift keeps one workspace while readiness changes its inspector", async t => {
  const built = await build({
    stdin: { contents: `
      import { createRoot } from "react-dom/client";
      import { flushSync } from "react-dom";
      import { TraceSiftView } from "./packages/ui/src/components/tracesift-view.tsx";
      import { TraceSiftPanel } from "./packages/ui/src/tracesift-panel.ts";
      export function mount(app) {
        const panel = new TraceSiftPanel(app);
        panel.setAvailable(true);
        panel.show();
        const root = createRoot(document.getElementById("root"));
        flushSync(() => root.render(<TraceSiftView panel={panel} />));
        return { panel, flushSync, close() { root.unmount(); panel.dispose(); } };
      }`, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, format: "iife", globalName: "TraceSiftUploadTest", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', {
    pretendToBeVisual: true, runScripts: "outside-only", url: "https://mobile-dev.test/",
  });
  t.after(() => dom.window.close());
  dom.window.eval(built.outputFiles[0].text);

  let status: "setup_required" | "ready" = "setup_required";
  const app = {
    getHostCapabilities: () => ({ serverTools: {} }),
    getHostContext: () => ({ theme: "dark", availableDisplayModes: ["inline", "fullscreen"] }),
    async callServerTool() {
      return status === "ready"
        ? { content: [], structuredContent: { apiVersion: 1, status: "ready" } }
        : { content: [], structuredContent: { apiVersion: 1, status: "setup_required", reason: "missing_cli", message: "Install TraceSift." } };
    },
  };
  const mounted = dom.window.TraceSiftUploadTest.mount(app);
  t.after(() => mounted.close());
  const settle = async () => {
    await new Promise(resolve => dom.window.setTimeout(resolve, 0));
    mounted.flushSync(() => undefined);
  };

  await settle();
  const workspace = dom.window.document.querySelector(".tracesift-workspace");
  assert.ok(workspace);
  assert.match(workspace.textContent ?? "", /Finish setup to add a profile/);
  assert.match(workspace.textContent ?? "", /TraceSift setup/);
  assert.equal(dom.window.document.querySelectorAll(".tracesift-workspace").length, 1);
  // The panel opens on Record, so the mode pair is what readiness gates here.
  const tabs = () => [...dom.window.document.querySelectorAll<HTMLElement>('[role="tab"]')];
  const disabled = (tab: HTMLElement) => tab.hasAttribute("disabled") || tab.getAttribute("aria-disabled") === "true";
  assert.equal(tabs().length, 2);
  assert.equal(tabs().filter(disabled).length, 2);

  status = "ready";
  await mounted.panel.controller.checkReadiness();
  await settle();
  assert.equal(dom.window.document.querySelector(".tracesift-workspace"), workspace);
  assert.match(workspace.textContent ?? "", /TraceSift ready/);
  assert.match(workspace.textContent ?? "", /Before you record/);
  assert.match(workspace.textContent ?? "", /Read about TraceSift/);
  assert.doesNotMatch(workspace.textContent ?? "", /How to export a profile/);
  assert.deepEqual(tabs().map(tab => tab.textContent?.trim()), ["Record", "Upload"]);
  assert.equal(tabs().filter(disabled).length, 0);

  // The side panel closes to the right rather than unmounting, so what it holds
  // stays in the document; the choice is remembered for the next time the panel opens.
  const toggle = dom.window.document.querySelector<HTMLButtonElement>(".tracesift-inspector-toggle");
  assert.ok(toggle);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.equal(workspace.getAttribute("data-inspector"), "shown");
  mounted.flushSync(() => toggle.click());
  assert.equal(workspace.getAttribute("data-inspector"), "hidden");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(dom.window.document.querySelector("#tracesift-inspector")?.getAttribute("aria-hidden"), "true");
  assert.match(workspace.textContent ?? "", /TraceSift ready/);
  assert.equal(dom.window.localStorage.getItem("tracesift.detailsHidden"), "1");
});
