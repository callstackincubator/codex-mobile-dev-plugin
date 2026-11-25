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
  let profilerInstalled = false;
  let appLaunched = false;
  const app = {
    getHostCapabilities: () => ({ serverTools: {} }),
    getHostContext: () => ({ theme: "dark", availableDisplayModes: ["inline", "fullscreen"] }),
    async callServerTool(input: { name: string }) {
      if (input.name === "mobile_tracesift_recorded_profiles") return { content: [], structuredContent: { profiles: [{ path: "/saved/profile.json.gz", name: "profile.json.gz", recordedAt: "2026-11-25T08:00:00.000Z", sizeBytes: 100 }] } };
      if (input.name === "mobile_get_tracesift_project") return { content: [], structuredContent: { path: "/project/expoapp57" } };
      if (input.name === "mobile_tracesift_profiler_setup") return { content: [], structuredContent: { installed: profilerInstalled, command: "npm install @callstack/tracesift-rn-profiler", platforms: ["ios"] } };
      if (input.name === "mobile_tracesift_install_profiler") { profilerInstalled = true; return { content: [], structuredContent: {} }; }
      if (input.name === "mobile_tracesift_profile_devices") return { content: [], structuredContent: { devices: [{ kind: "simulator", id: "sim-1", name: "iPhone Simulator", note: "booted" }] } };
      if (input.name === "mobile_tracesift_profile_build") return { content: [], structuredContent: { runId: "build-1", status: "running" } };
      if (input.name === "mobile_tracesift_profile_build_status") { appLaunched = true; return { content: [], structuredContent: { runId: "build-1", status: "completed" } }; }
      if (input.name === "mobile_tracesift_list_react_native_targets") return { content: [], structuredContent: {
        apiVersion: 1, platform: "rn", metro: "http://127.0.0.1:8081",
        targets: appLaunched ? [{ id: "running-app", title: "Test app", deviceName: "iPhone Simulator", supportsMultipleDebuggers: true, recommended: true }] : [],
      } };
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
  assert.match(workspace.textContent ?? "", /A profileable running app/);
  assert.match(workspace.textContent ?? "", /Prepare a profiling build/);
  assert.match(workspace.textContent ?? "", /Select a running app/);
  assert.match(workspace.textContent ?? "", /Follow the steps above to prepare and run a profiling app, then refresh/);
  assert.doesNotMatch(workspace.textContent ?? "", /TraceSift returned an invalid React Native target list/);
  assert.match(workspace.textContent ?? "", /React Native/);
  assert.doesNotMatch(workspace.textContent ?? "", /Web app/);
  assert.match(workspace.textContent ?? "", /Install TraceSift profiler/);
  const runButton = () => [...dom.window.document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.includes("Run with TraceSift"));
  assert.ok(runButton()?.disabled);
  const installButton = [...dom.window.document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.trim() === "Install");
  assert.ok(installButton);
  mounted.flushSync(() => installButton.click());
  await settle();
  await settle();
  assert.doesNotMatch(workspace.textContent ?? "", /Install TraceSift profiler/);
  assert.equal(runButton()?.disabled, false);
  assert.match(workspace.textContent ?? "", /Read about TraceSift/);
  assert.doesNotMatch(workspace.textContent ?? "", /How to export a profile/);
  assert.deepEqual(tabs().map(tab => tab.textContent?.trim()), ["Record", "Upload"]);
  assert.equal(tabs().filter(disabled).length, 0);
  mounted.flushSync(() => tabs()[1]!.click());
  assert.match(workspace.textContent ?? "", /Recorded profiles/);
  assert.match(workspace.querySelector("#tracesift-saved-profile")?.textContent ?? "", /profile\.json\.gz/);
  mounted.flushSync(() => tabs()[0]!.click());

  const sections = () => [...dom.window.document.querySelectorAll<HTMLButtonElement>(".tracesift-record-section-toggle")];
  assert.equal(sections().length, 2);
  assert.deepEqual(sections().map(button => button.getAttribute("aria-expanded")), ["true", "true"]);
  mounted.flushSync(() => sections()[0]!.click());
  assert.deepEqual(sections().map(button => button.getAttribute("aria-expanded")), ["false", "true"]);
  assert.equal(dom.window.document.querySelector("#tracesift-build-steps"), null);
  mounted.flushSync(() => sections()[0]!.click());
  mounted.flushSync(() => sections()[1]!.click());
  assert.equal(dom.window.document.querySelector("#tracesift-running-app"), null);

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

  await mounted.panel.controller.openRun();
  assert.equal(mounted.panel.controller.getSnapshot().run.open, true);
  await mounted.panel.controller.buildForTarget({ platform: "ios", kind: "simulator", id: "sim-1", name: "iPhone Simulator", note: "booted" });
  await settle();
  assert.equal(mounted.panel.controller.getSnapshot().run.open, false);
  assert.deepEqual(sections().map(button => button.getAttribute("aria-expanded")), ["false", "true"]);
  assert.match(dom.window.document.querySelector("#tracesift-running-app")?.textContent ?? "", /Launched on iPhone Simulator/);
  assert.match(dom.window.document.querySelector("#tracesift-running-app")?.textContent ?? "", /Test app/);
});
