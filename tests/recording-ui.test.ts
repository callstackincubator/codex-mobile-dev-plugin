import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { recordingFixture } from "./recording-fixtures.ts";

for (const reducedMotion of [false, true]) {
  const description = reducedMotion
    ? "reduced motion skips the reveal and preserves recording interactions"
    : "charts reveal left to right once, then preserve recording interactions";
  test(description, async t => {
    const built = await build({
      stdin: { contents: `
        import { createRoot } from "react-dom/client";
        import { flushSync } from "react-dom";
        import { RecordingCard } from "./src/ui/components/recording-card.tsx";
        import { RecordingController } from "./src/ui/recording-controller.ts";
        import { startUiTelemetry, stopUiTelemetry } from "./src/ui/telemetry.ts";
        export function mount(app, result) {
          startUiTelemetry(app);
          const controller = new RecordingController(app);
          controller.hostChanged();
          controller.accept(result);
          const root = createRoot(document.getElementById("root"));
          flushSync(() => root.render(<RecordingCard controller={controller} />));
          return { controller, async close() { controller.dispose(); root.unmount(); await stopUiTelemetry(); } };
        }`, resolveDir: process.cwd(), loader: "tsx" },
      bundle: true, write: false, format: "iife", globalName: "RecordingTest", platform: "browser", jsx: "automatic",
      define: { "process.env.NODE_ENV": '"production"' },
    });
    const dom = new JSDOM('<html data-view="recording"><head><meta name="mobile-dev-environment" content="development"></head><body><div id="root"></div></body></html>', { pretendToBeVisual: true, runScripts: "outside-only", url: "https://mobile-dev.test/" });
    const window = dom.window;
    window.matchMedia = (query: string) => ({
      matches: reducedMotion, media: query, onchange: null,
      addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
      dispatchEvent() { return true; },
    });
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
        const rect = { x: 0, y: 0, left: 0, right: 640, top: 0, bottom: 170, width: 640, height: 170, toJSON() {} };
        window.setTimeout(() => { this.callback([{ target, contentRect: rect } as ResizeObserverEntry], this as unknown as ResizeObserver); }, 0);
      }
      disconnect() {}
      unobserve() {}
    };
    Object.defineProperty(window.HTMLElement.prototype, "getBoundingClientRect", { value() {
      return { x: 0, y: 0, left: 0, right: 640, top: 0, bottom: 170, width: 640, height: 170, toJSON() {} };
    } });
    window.HTMLElement.prototype.setPointerCapture = () => {};
    window.HTMLElement.prototype.releasePointerCapture = () => {};
    const messages: Array<{ role: string; content: Array<{ type: string; text: string }> }> = [];
    const app = { getHostCapabilities() { return { message: { text: {} }, serverTools: {} }; },
      async sendMessage(message: typeof messages[number]) { messages.push(message); return {}; },
      async callServerTool() { throw new Error("Finished recordings must not poll"); },
    };
    window.eval(built.outputFiles[0].text);
    const recording = recordingFixture();
    const mounted = window.RecordingTest.mount(app, { content: [], structuredContent: { recording } });
    t.after(async () => {
      await mounted.close();
      dom.window.close();
      const captured = telemetry.join("\n");
      const hasDensityTiming = captured.includes("ui.recording.change_density.mean");
      const hasRecordingSurface = captured.includes('"surface":{"value":"recording"');
      const hasRecordingView = captured.includes('"view":{"value":"recording"');
      const hasRecordingId = captured.includes(recording.id);
      const hasBundleId = captured.includes("com.example.shop");
      const hasRevealTiming = captured.includes("ui.recording.reveal.mean");
      assert.equal(hasRevealTiming, reducedMotion === false, "Only completed reveals produce timing measurements.");
      assert.ok(hasDensityTiming, "The actual chart path records highlight processing duration.");
      assert.ok(hasRecordingSurface);
      assert.ok(hasRecordingView);
      assert.equal(hasRecordingId, false, "Highlight telemetry excludes recording data.");
      assert.equal(hasBundleId, false);
    });
    const settle = async () => { await new Promise(resolve => window.setTimeout(resolve, 30)); };
    await settle();
    assert.ok(window.document.body.textContent?.includes("+6 MiB"));
    const charts = window.document.querySelectorAll<HTMLElement>(".recording-chart");
    assert.equal(charts.length, 2);
    await settle();
    const revealRect = () => charts[0].querySelector(".recharts-area defs clipPath rect");
    const initialClip = revealRect();
    if (reducedMotion) {
      assert.equal(initialClip, null, "Reduced motion shows the full curve immediately.");
    } else {
      assert.ok(initialClip, "The initial curve uses a horizontal reveal clip.");
      const initialX = initialClip.getAttribute("x");
      const initialWidthText = initialClip.getAttribute("width");
      const initialWidth = Number(initialWidthText);
      assert.equal(initialX, "52", "The reveal is anchored at the beginning of the timeline.");
      await new Promise(resolve => window.setTimeout(resolve, 200));
      const midwayClip = revealRect();
      assert.ok(midwayClip);
      const midwayWidthText = midwayClip.getAttribute("width");
      const midwayWidth = Number(midwayWidthText);
      assert.ok(midwayWidth > initialWidth, "The visible curve expands from left to right.");
      await new Promise(resolve => window.setTimeout(resolve, 750));
      const completedClip = revealRect();
      assert.equal(completedClip, null, "The completed curve is fully visible.");
    }
    const cpuChanges = charts[0].querySelectorAll(".recording-change-highlight");
    const memoryChanges = charts[1].querySelectorAll(".recording-change-highlight");
    const initialState = mounted.controller.getSnapshot();
    const initialText = window.document.body.textContent ?? "";
    const showsEntireRecording = initialText.includes("Entire recording");
    const asksEntireRecording = initialText.includes("Ask about this recording");
    const rangeForm = window.document.querySelector(".recording-range");
    const rangeInput = window.document.querySelector('input[type="number"]');
    assert.equal(cpuChanges.length, 2);
    assert.equal(memoryChanges.length, 0);
    assert.equal(initialState.range, undefined, "Automatic change highlights leave the entire recording selected.");
    assert.ok(showsEntireRecording);
    assert.ok(asksEntireRecording);
    assert.equal(rangeForm, null);
    assert.equal(rangeInput, null);
    const memoryTicks = charts[1].querySelectorAll(".recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value");
    assert.ok(memoryTicks.length > 0);
    for (const tick of memoryTicks) assert.match(tick.textContent ?? "", /^\d+$/);
    const cpuLine = charts[0].querySelector(".recharts-area-curve");
    assert.match(cpuLine?.getAttribute("d") ?? "", /^M52,/, "The first measured CPU interval begins at the timeline's left edge.");
    const pointer = (type: string, time: number) => {
      const event = new window.MouseEvent(type, { bubbles: true, clientX: 52 + time / 30 * 576, button: 0 });
      Object.defineProperty(event, "pointerId", { value: 1 });
      charts[0].dispatchEvent(event);
    };
    pointer("pointerdown", 12);
    pointer("pointermove", 18);
    await settle();
    const clipAfterDrag = revealRect();
    assert.equal(clipAfterDrag, null, "Selecting a range does not replay the entrance animation.");
    const refreshed = recordingFixture();
    mounted.controller.accept({ content: [], structuredContent: { recording: refreshed } });
    await settle();
    const clipAfterRefresh = revealRect();
    assert.equal(clipAfterRefresh, null, "Sample refreshes do not replay the entrance animation.");
    const draggedRanges = window.document.querySelectorAll(".recording-range-highlight");
    const changesDuringDrag = window.document.querySelectorAll(".recording-change-highlight");
    assert.equal(draggedRanges.length, 2, "Both charts highlight the dragged range.");
    assert.equal(changesDuringDrag.length, 2, "Change highlights remain independent of the selection.");
    pointer("pointerup", 18);
    await settle();
    assert.deepEqual(JSON.parse(JSON.stringify(mounted.controller.getSnapshot().range)), { start: 12, end: 18 });
    assert.ok(window.document.body.textContent?.includes("Selected range: 12.0s–18.0s"));
    assert.ok(window.document.body.textContent?.includes("41.0%"));
    assert.equal(messages.length, 0, "Selecting a range does not send a chat message.");
    const buttons = Array.from(window.document.querySelectorAll<HTMLButtonElement>("button"));
    const ask = buttons.find(button => button.textContent?.includes("Ask about this range"));
    assert.ok(ask);
    ask.click();
    await settle();
    assert.equal(messages.length, 1);
    assert.equal(messages[0].role, "user");
    assert.ok(messages[0].content[0].text.includes(recordingFixture().id));
    assert.ok(messages[0].content[0].text.includes('"range":{"start":12,"end":18}'));
    const open = buttons.find(button => button.textContent?.includes("Open in Mobile Dev"));
    assert.ok(open);
    open.click();
    await settle();
    assert.equal(messages.length, 2);
    assert.ok(messages[1].content[0].text.includes("mobile_open_performance_recording"));
    assert.ok(messages[1].content[0].text.includes('"range":{"start":12,"end":18}'));
    pointer("pointerup", 5);
    await settle();
    const unchangedRange = mounted.controller.getSnapshot().range;
    assert.equal(unchangedRange.start, 12, "A pointer released without starting on the chart leaves the selection intact.");
    assert.equal(unchangedRange.end, 18);
    pointer("pointerdown", 5);
    pointer("pointerup", 5);
    await settle();
    const clearedState = mounted.controller.getSnapshot();
    const clearedRanges = window.document.querySelectorAll(".recording-range-highlight");
    const changesAfterClear = window.document.querySelectorAll(".recording-change-highlight");
    assert.equal(clearedState.range, undefined, "Clicking a chart clears the manual selection.");
    assert.equal(clearedRanges.length, 0);
    assert.equal(changesAfterClear.length, 2);
    const buttonElements = window.document.querySelectorAll<HTMLButtonElement>("button");
    const currentButtons = Array.from(buttonElements);
    const fullAsk = currentButtons.find(button => button.textContent === "Ask about this recording");
    assert.ok(fullAsk);
    fullAsk.click();
    await settle();
    assert.equal(messages.length, 3);
    const asksFullRange = messages[2].content[0].text.includes('"range":{"start":0,"end":30}');
    assert.ok(asksFullRange, "Automatic highlights do not narrow the chat question.");
    mounted.controller.select({ start: 12, end: 18 });
    const next = recordingFixture();
    next.id = "bc9b6d2e-c5b5-4288-a488-bc380098d857";
    next.durationSeconds = 10;
    next.samples = next.samples.slice(0, 11);
    mounted.controller.accept({ content: [], structuredContent: { recording: next } });
    const nextState = mounted.controller.getSnapshot();
    assert.equal(nextState.range, undefined, "A different recording clears the prior selection.");
    await settle();
    const nextClip = window.document.querySelector(".recording-chart .recharts-area defs clipPath rect");
    assert.equal(nextClip === null, reducedMotion, "A different recording gets its own entrance reveal.");
  });

}
