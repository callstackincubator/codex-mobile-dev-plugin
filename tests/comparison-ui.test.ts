import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { recordingWithFramesFixture } from "./recording-fixtures.ts";

test("comparison overlays, toggles, shared selections and Ask retain original run references and private telemetry", async t => {
  const built = await build({
    stdin: { contents: `
      import { createRoot } from "react-dom/client";
      import { flushSync } from "react-dom";
      import { ComparisonCard } from "./src/ui/components/comparison-card.tsx";
      import { ComparisonController } from "./src/ui/comparison-controller.ts";
      import { startUiTelemetry, stopUiTelemetry } from "./src/ui/telemetry.ts";
      export function mount(app, result) {
        startUiTelemetry(app);
        const controller = new ComparisonController(app);
        controller.hostChanged();
        controller.accept(result);
        const root = createRoot(document.getElementById("root"));
        flushSync(() => root.render(<ComparisonCard controller={controller} />));
        return { controller, async close() { controller.dispose(); root.unmount(); await stopUiTelemetry(); } };
      }`, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, format: "iife", globalName: "ComparisonTest", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const html = '<html data-view="comparison"><head><meta name="mobile-dev-environment" content="development"><meta name="mobile-dev-user-id" content="anon_0123456789abcdef0123456789abcdef"><meta name="mobile-dev-session-id" content="run_1234567890abcdef1234567890abcdef"></head><body><div id="root"></div></body></html>';
  const dom = new JSDOM(html, { pretendToBeVisual: true, runScripts: "outside-only", url: "https://mobile-dev.test/" });
  const window = dom.window;
  Object.defineProperty(window.performance, "getEntriesByType", { value: () => [] });
  Object.defineProperty(window.performance, "getEntries", { value: () => [] });
  const telemetry: string[] = [];
  window.fetch = async (_url, options) => {
    const body = String(options?.body ?? "");
    telemetry.push(body);
    return new Response("", { status: 200 });
  };
  window.ResizeObserver = class {
    private callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) { this.callback = callback; }
    observe(target: Element) {
      const rect = { x: 0, y: 0, left: 0, right: 640, top: 0, bottom: 190, width: 640, height: 190, toJSON() {} };
      window.setTimeout(() => { this.callback([{ target, contentRect: rect } as ResizeObserverEntry], this as unknown as ResizeObserver); }, 0);
    }
    disconnect() {}
    unobserve() {}
  };
  Object.defineProperty(window.HTMLElement.prototype, "getBoundingClientRect", { value() {
    return { x: 0, y: 0, left: 0, right: 640, top: 0, bottom: 190, width: 640, height: 190, toJSON() {} };
  } });
  window.HTMLElement.prototype.setPointerCapture = () => {};
  window.HTMLElement.prototype.releasePointerCapture = () => {};
  const messages: Array<{ content: Array<{ text: string }> }> = [];
  const app = {
    getHostCapabilities() { return { message: { text: {} } }; },
    async sendMessage(message: typeof messages[number]) { messages.push(message); return {}; },
    async callServerTool() { throw new Error("Completed comparisons must not poll"); },
  };
  window.eval(built.outputFiles[0].text);
  const first = recordingWithFramesFixture();
  first.title = "PRIVATE_BEFORE";
  const second = recordingWithFramesFixture();
  second.id = "44b7030b-a74e-466f-aeb0-bcd3ae8af972";
  second.title = "PRIVATE_AFTER";
  second.durationSeconds = 15;
  second.samples = second.samples.slice(0, 16);
  second.fps.samples = second.fps.samples.slice(0, 15);
  const mounted = window.ComparisonTest.mount(app, { content: [], structuredContent: { title: "Before / after", recordings: [first, second] } });
  t.after(async () => {
    await mounted.close();
    window.close();
    const encoded = telemetry.join("\n");
    for (const fragment of ["ui.comparison.process.mean", "ui.comparison.derive.mean", "ui.comparison.summary.mean", "ui.comparison.commit.mean", "ui.comparison.runs", "ui.comparison.run_toggled", "ui.comparison.message_ack.mean", "ui.surface.ready.mean", '"surface":{"value":"comparison"', '"view":{"value":"comparison"']) {
      assert.ok(encoded.includes(fragment), `Missing telemetry: ${fragment}`);
    }
    for (const fragment of [first.id, second.id, "PRIVATE_", "com.example.shop", "jankRatePercent", "p95FrameIntervalMs", "averageCpuPercent"]) {
      assert.equal(encoded.includes(fragment), false, `Private data reached telemetry: ${fragment}`);
    }
  });
  async function settle() { await new Promise(resolve => window.setTimeout(resolve, 60)); }
  await settle();
  const charts = window.document.querySelectorAll<HTMLElement>(".recording-chart");
  assert.equal(charts.length, 3);
  assert.equal(charts[0].querySelectorAll(".recharts-line-curve").length, 2);
  const toggles = window.document.querySelectorAll<HTMLButtonElement>(".comparison-run");
  toggles[1].click();
  await settle();
  assert.equal(toggles[1].getAttribute("aria-pressed"), "false");
  assert.equal(charts[0].querySelectorAll(".recharts-line-curve").length, 1);
  toggles[1].click();
  await settle();
  assert.equal(charts[0].querySelectorAll(".recharts-line-curve").length, 2);
  function pointer(type: string, time: number) {
    const event = new window.MouseEvent(type, { bubbles: true, clientX: 52 + time / 30 * 576, button: 0 });
    Object.defineProperty(event, "pointerId", { value: 1 });
    charts[0].dispatchEvent(event);
  }
  pointer("pointerdown", 12);
  pointer("pointermove", 18);
  await settle();
  assert.equal(window.document.querySelectorAll(".recording-range-highlight").length, 3);
  pointer("pointerup", 18);
  await settle();
  const range = JSON.parse(JSON.stringify(mounted.controller.getSnapshot().range));
  assert.deepEqual(range, { start: 12, end: 18 });
  const rows = window.document.querySelectorAll(".comparison-table tbody tr");
  assert.ok(rows[0].textContent?.includes("12.0s–18.0s"));
  assert.ok(rows[1].textContent?.includes("12.0s–15.0s"));
  const ask = window.document.querySelector<HTMLButtonElement>(".comparison-actions button");
  assert.ok(ask);
  ask.click();
  await settle();
  assert.equal(messages.length, 1);
  const prompt = messages[0].content[0].text;
  assert.ok(prompt.includes(first.id));
  assert.ok(prompt.includes(second.id));
  assert.ok(prompt.includes('"range":{"start":12,"end":18}'));
  const before = mounted.controller.getSnapshot();
  pointer("pointerdown", 20);
  pointer("pointerup", 20);
  await settle();
  assert.equal(mounted.controller.getSnapshot().range, undefined);
  mounted.controller.hostChanged();
  assert.equal(mounted.controller.getSnapshot().comparison, before.comparison);
  mounted.controller.select({ start: 20, end: 25 });
  await settle();
  assert.ok(rows[1].textContent?.includes("Outside run"));
  second.memoryMetric = "physical-footprint";
  second.target = { platform: "ios", kind: "simulator", deviceId: "B5C969F6-58A4-4C31-AB12-FB9E56D681DE", bundleId: "com.example.shop" };
  second.fps = { status: "unavailable", samples: [] };
  mounted.controller.accept({ content: [], structuredContent: { title: "Mixed memory definitions", recordings: [first, second] } });
  await settle();
  assert.equal(window.document.querySelectorAll(".recording-track").length, 4);
  assert.ok(window.document.body.textContent?.includes("Memory · RSS · MiB"));
  assert.ok(window.document.body.textContent?.includes("Memory · Physical footprint · MiB"));
  const fpsChart = window.document.querySelector('[aria-label="Display FPS · device-wide"]');
  const fpsCurves = fpsChart?.querySelectorAll(".recharts-line-curve") ?? [];
  const renderedFpsCurves = Array.from(fpsCurves).filter(curve => {
    const path = curve.getAttribute("d");
    return Boolean(path);
  });
  assert.equal(renderedFpsCurves.length, 1);
  assert.equal(mounted.controller.getSnapshot().range, undefined);
});
