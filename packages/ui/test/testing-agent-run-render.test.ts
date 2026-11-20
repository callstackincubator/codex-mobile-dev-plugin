import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

/** Mounts the real Testing view on a panel in the state an agent's two-device run leaves it in. */
test("the Testing view renders while an agent runs a pinned iOS test on iOS and Android", async t => {
  const built = await build({
    stdin: { contents: `
      import { createRoot } from "react-dom/client";
      import { flushSync } from "react-dom";
      import { TestingPanel } from "./packages/ui/src/testing-panel.ts";
      import { TestingView } from "./packages/ui/src/components/testing-view.tsx";
      export function mount(scenario) {
        const host = { async callServerTool() { return { content: [], structuredContent: {} }; }, getHostCapabilities() { return undefined; } };
        const state = { device: scenario.device, apps: [], foregroundApp: scenario.front, ready: true };
        const deviceApps = { subscribe: () => () => undefined, getSnapshot: () => state };
        const panel = new TestingPanel(host, deviceApps, { heartbeatMs: 1e9 });
        panel.update({ projectPath: "/studio" });
        panel.update({ available: true, open: true, studioPath: "/studio", runtimeMode: "bundled", ...scenario.before });
        const errors = [];
        const root = createRoot(document.getElementById("root"), { onUncaughtError: e => errors.push(String(e)), onCaughtError: e => errors.push(String(e)) });
        flushSync(() => root.render(<TestingView panel={panel} deviceApps={deviceApps} />));
        return { errors, panel, apply: () => panel.update(scenario.fields), close: () => { root.unmount(); panel.dispose?.(); } };
      }`, resolveDir: process.cwd().replace(/packages\/ui$/, ""), loader: "tsx" },
    bundle: true, write: false, format: "iife", globalName: "RenderTest", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent",
  });
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, runScripts: "outside-only", url: "https://mobile-dev.test/" });
  const window = dom.window;
  window.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
  window.eval(built.outputFiles[0].text);
  const lane = (platform: string, state: string) => ({ runId: `r-${platform}`, deviceId: `d-${platform}`, deviceName: platform, platform, state, progress: [], ...(state === "failed" ? { result: { status: "failed", steps: [{ line: 4, status: "failed", error: "nope" }] } } : {}) });
  const source = 'import { test } from "@e2e-dev/mobile";\n\ntest("flow", async ({ app, screen }) => {\n  await app.open();\n  await screen.getByText("Go").tap();\n});\n';
  const scenario = {
    device: { udid: "u", name: "Pixel", state: "Booted", platform: "android", kind: "emulator" },
    front: { bundleId: "com.example.android", pid: 1 },
    fields: {
      tests: [{ relativePath: "flow.e2e.ts", name: "flow", updatedAt: new Date().toISOString(), sizeBytes: 10, target: { platform: "ios", bundleId: "com.example", apps: { android: "com.example.android" } } }],
      selectedTestPath: "flow.e2e.ts", selectedTestSource: source, agentRun: true,
      matrix: { matrixId: "m", testPath: "flow.e2e.ts", limit: 3, startedAt: 1, lanes: [lane("ios", "passed"), lane("android", "failed")] },
      selectedLane: "r-android",
    },
    before: {},
  };
  const mounted = window.RenderTest.mount(scenario);
  t.after(() => { mounted.close(); window.close(); });
  await new Promise(resolve => window.setTimeout(resolve, 25));
  mounted.apply();
  await new Promise(resolve => window.setTimeout(resolve, 25));
  assert.equal(mounted.errors.length, 0, [...mounted.errors].join("\n"));
  assert.ok(window.document.querySelector("[data-testing-lanes]"), "the lanes render");
});

test("the panel adopts an agent run through its own polling and keeps rendering", async t => {
  const built = await build({
    stdin: { contents: `
      import { createRoot } from "react-dom/client";
      import { flushSync } from "react-dom";
      import { TestingPanel } from "./packages/ui/src/testing-panel.ts";
      import { TestingView } from "./packages/ui/src/components/testing-view.tsx";
      export function mount(scenario) {
        const host = { async callServerTool({ name }) { return { content: [], structuredContent: scenario.responses[name] ?? {} }; }, getHostCapabilities() { return undefined; } };
        const state = { device: scenario.device, apps: [], foregroundApp: scenario.front, ready: true };
        const deviceApps = { subscribe: () => () => undefined, getSnapshot: () => state };
        const panel = new TestingPanel(host, deviceApps, { heartbeatMs: 1e9 });
        const errors = [];
        const root = createRoot(document.getElementById("root"), { onUncaughtError: e => errors.push(String(e)), onCaughtError: e => errors.push(String(e)) });
        flushSync(() => root.render(<TestingView panel={panel} deviceApps={deviceApps} />));
        panel.show();
        panel.setAvailable(true);
        return { errors, panel, close: () => { root.unmount(); panel.dispose?.(); } };
      }`, resolveDir: process.cwd().replace(/packages\/ui$/, ""), loader: "tsx" },
    bundle: true, write: false, format: "iife", globalName: "RenderTest2", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent",
  });
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, runScripts: "outside-only", url: "https://mobile-dev.test/" });
  const window = dom.window;
  window.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
  window.eval(built.outputFiles[0].text);
  const lane = (platform: string, state: string) => ({ runId: `r-${platform}`, deviceId: `d-${platform}`, deviceName: platform, platform, state, progress: [{ stepIndex: 0, phase: "start" }], ...(state === "failed" ? { result: { status: "failed", steps: [{ line: 4, status: "failed", error: "nope" }] } } : {}) });
  const source = 'import { test } from "@e2e-dev/mobile";\n\ntest("flow", async ({ app, screen }) => {\n  await app.open();\n  await screen.getByText("Go").tap();\n});\n';
  const mounted = window.RenderTest2.mount({
    device: { udid: "u", name: "Pixel", state: "Booted", platform: "android", kind: "emulator" },
    front: { bundleId: "com.example.android", pid: 1 },
    responses: {
      mobile_testing_projects: { projects: [{ path: "/studio", name: "Testing Studio" }], studioPath: "/studio" },
      mobile_testing_project_config: { runtimeMode: "bundled", targets: [], setupState: "available" },
      mobile_testing_tests: { tests: [{ relativePath: "flow.e2e.ts", name: "flow", updatedAt: new Date().toISOString(), sizeBytes: 10, target: { platform: "ios", bundleId: "com.example", apps: { android: "com.example.android" } } }] },
      mobile_testing_read_file: { source, originalHash: "h" },
      mobile_testing_run_progress: { running: true, matrixId: "m", testPath: "flow.e2e.ts", limit: 3, startedAt: 1, lanes: [lane("ios", "passed"), lane("android", "running")] },
    },
  });
  t.after(() => { mounted.close(); window.close(); });
  await new Promise(resolve => window.setTimeout(resolve, 300));
  await (mounted.panel as unknown as { readAgentState(): Promise<void> }).readAgentState();
  await new Promise(resolve => window.setTimeout(resolve, 300));
  assert.equal(mounted.errors.length, 0, [...mounted.errors].join("\n"));
  const s = mounted.panel.getSnapshot();
  assert.equal(s.agentRun, true, JSON.stringify({ p: s.projectPath, t: s.selectedTestPath, e: s.error, m: !!s.matrix, tests: s.tests.length }));
});
