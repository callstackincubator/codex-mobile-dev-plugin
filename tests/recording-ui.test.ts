import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { recordingFixture, recordingWithFramesFixture } from "./recording-fixtures.ts";

for (const reducedMotion of [false, true]) {
  const description = reducedMotion
    ? "reduced motion skips the reveal and preserves recording interactions"
    : "charts draw their curves once with the fill following, then preserve recording interactions";
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
    const html = '<html data-view="recording"><head><meta name="mobile-dev-environment" content="development"><meta name="mobile-dev-user-id" content="anon_0123456789abcdef0123456789abcdef"><meta name="mobile-dev-session-id" content="run_1234567890abcdef1234567890abcdef"></head><body><div id="root"></div></body></html>';
    const dom = new JSDOM(html, { pretendToBeVisual: true, runScripts: "outside-only", url: "https://mobile-dev.test/" });
    const window = dom.window;
    const styles = await readFile("src/ui/style.css", "utf8");
    const style = window.document.createElement("style");
    style.textContent = styles;
    window.document.head.append(style);
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
    const recording = recordingWithFramesFixture();
    const mounted = window.RecordingTest.mount(app, { content: [], structuredContent: { recording } });
    t.after(async () => {
      await mounted.close();
      dom.window.close();
      const captured = telemetry.join("\n");
      const hasDensityTiming = captured.includes("ui.recording.change_density.mean");
      const hasDeriveTiming = captured.includes("ui.recording.derive.mean");
      const hasRecordingSurface = captured.includes('"surface":{"value":"recording"');
      const hasRecordingView = captured.includes('"view":{"value":"recording"');
      const hasFpsGauge = captured.includes("ui.recording.fps_samples");
      const hasMeasuredFps = captured.includes("averageFps");
      const hasMeasuredJank = captured.includes("jankRatePercent");
      const hasMeasuredPacing = captured.includes("p95FrameIntervalMs");
      const hasRecordingId = captured.includes(recording.id);
      const hasBundleId = captured.includes("com.example.shop");
      const hasRevealTiming = captured.includes("ui.recording.reveal.mean");
      assert.equal(hasRevealTiming, reducedMotion === false, "Only completed reveals produce timing measurements.");
      if (reducedMotion === false) {
        for (const body of telemetry) {
          const lines = body.split("\n");
          for (const line of lines) {
            if (line.includes("ui.recording.reveal.mean") === false) continue;
            const payload: { items: Array<{ name: string; value: number }> } = JSON.parse(line);
            const reveal = payload.items.find(item => item.name === "ui.recording.reveal.mean");
            assert.ok(reveal);
            assert.ok(reveal.value >= 700 && reveal.value < 1400, "Reveal timing measures the drawing duration and excludes the intentional pause.");
          }
        }
      }
      assert.ok(hasFpsGauge, "Recording telemetry counts FPS samples on the active surface.");
      assert.equal(hasMeasuredFps, false, "Device FPS values stay local.");
      assert.equal(hasMeasuredJank, false, "Device jank statistics stay local.");
      assert.equal(hasMeasuredPacing, false, "Device pacing statistics stay local.");
      assert.ok(hasDensityTiming, "The actual chart path records highlight processing duration.");
      assert.ok(hasDeriveTiming, "The active chart path records whole-run and range-statistics derivation.");
      assert.ok(hasRecordingSurface);
      assert.ok(hasRecordingView);
      assert.equal(hasRecordingId, false, "Highlight telemetry excludes recording data.");
      assert.equal(hasBundleId, false);
    });
    const settle = async () => { await new Promise(resolve => window.setTimeout(resolve, 30)); };
    await settle();
    assert.ok(window.document.body.textContent?.includes("+6 MiB"));
    const metrics = window.document.querySelector(".recording-metrics");
    assert.ok(metrics?.textContent?.includes("Jank rate33.3%"));
    assert.ok(metrics?.textContent?.includes("Dropped frames1"));
    const charts = window.document.querySelectorAll<HTMLElement>(".recording-chart");
    assert.equal(charts.length, 3);
    await settle();
    const curve = () => window.document.querySelector(".recording-chart .recharts-area-curve");
    const curvePath = () => curve()?.getAttribute("d") ?? "";
    const revealState = () => charts[0].closest(".recording-track")?.getAttribute("data-reveal");
    const highlightOpacity = () => {
      const highlight = charts[0].querySelector(".recording-change-highlight");
      assert.ok(highlight);
      const computed = window.getComputedStyle(highlight);
      return computed.opacity || "1";
    };
    const curveEnd = () => {
      const path = curvePath();
      const matches = path.matchAll(/[ML]([\d.]+),([\d.]+)/g);
      const coordinates = Array.from(matches);
      const last = coordinates[coordinates.length - 1];
      assert.ok(last);
      return Number(last[1]);
    };
    const assertFillFollows = () => {
      const path = curvePath();
      const fill = charts[0].querySelector(".recharts-area-area");
      const fillPath = fill?.getAttribute("d") ?? "";
      const follows = fillPath.startsWith(path);
      assert.ok(follows, "The fill follows exactly the portion of the line already drawn.");
    };
    if (reducedMotion === false) {
      await new Promise(resolve => window.setTimeout(resolve, 250));
      const pendingPath = curvePath();
      assert.equal(pendingPath, "", "The card has time to appear before any of the line is drawn.");
      assert.equal(highlightOpacity(), "0", "Automatic highlights stay hidden during the entrance pause.");
    } else {
      assert.equal(highlightOpacity(), "1", "Reduced motion shows the highlights immediately with the full curve.");
      assert.equal(revealState(), "settled");
    }
    for (let attempt = 0; attempt < 50 && curvePath() === ""; attempt += 1) await settle();
    const initialEnd = curveEnd();
    const initialPath = curvePath();
    const revealClip = charts[0].querySelector(".recharts-area defs clipPath rect");
    assert.equal(revealClip, null, "Drawing the curve does not use a horizontal wipe.");
    assert.match(initialPath, /^M52,/, "The drawing starts at the beginning of the timeline.");
    assertFillFollows();
    if (reducedMotion === false) {
      assert.ok(initialEnd < 628, "Only the beginning of the curve is drawn initially.");
      await new Promise(resolve => window.setTimeout(resolve, 200));
      const midwayEnd = curveEnd();
      assert.ok(midwayEnd > initialEnd, "The line tip advances along the measured curve.");
      assertFillFollows();
      assert.equal(highlightOpacity(), "0", "Automatic highlights remain hidden while the line is drawing.");
      for (let attempt = 0; attempt < 50 && revealState() === "pending"; attempt += 1) await settle();
      assert.equal(revealState(), "finished", "Only a completed line starts the delayed highlight fade.");
    }
    const completedEnd = curveEnd();
    assert.equal(completedEnd, 628, "The completed curve reaches the end of the timeline.");
    assertFillFollows();
    const completedPath = curvePath();
    const cpuChanges = charts[0].querySelectorAll(".recording-change-highlight");
    const memoryChanges = charts[1].querySelectorAll(".recording-change-highlight");
    const initialState = mounted.controller.getSnapshot();
    const initialText = window.document.body.textContent ?? "";
    const showsEntireRecording = initialText.includes("Entire recording");
    const asksEntireRecording = initialText.includes("Ask about recording");
    const rangeForm = window.document.querySelector(".recording-range");
    const rangeInput = window.document.querySelector('input[type="number"]');
    assert.equal(cpuChanges.length, 2);
    assert.equal(memoryChanges.length, 0);
    assert.equal(initialState.range, undefined, "Automatic change highlights leave the entire recording selected.");
    assert.equal(window.document.querySelector(".recording-overview-range"), null, "The overview does not treat automatic highlights as a selection.");
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
    const pathAfterDrag = curvePath();
    assert.equal(pathAfterDrag, completedPath, "Selecting a range does not replay the entrance animation.");
    assert.equal(revealState(), "settled", "Selection ends the highlight entrance so user interaction stays immediate.");
    assert.equal(highlightOpacity(), "1");
    const refreshed = recordingWithFramesFixture();
    mounted.controller.accept({ content: [], structuredContent: { recording: refreshed } });
    await settle();
    const pathAfterRefresh = curvePath();
    assert.equal(pathAfterRefresh, completedPath, "Sample refreshes do not replay the entrance animation.");
    assert.equal(revealState(), "settled", "Sample refreshes do not replay the highlight entrance.");
    const draggedRanges = window.document.querySelectorAll(".recording-range-highlight");
    const changesDuringDrag = window.document.querySelectorAll(".recording-change-highlight");
    assert.equal(draggedRanges.length, 3, "All charts highlight the dragged range.");
    assert.equal(changesDuringDrag.length, 4, "Change highlights remain independent of the selection.");
    pointer("pointerup", 18);
    await settle();
    assert.deepEqual(JSON.parse(JSON.stringify(mounted.controller.getSnapshot().range)), { start: 12, end: 18 });
    assert.equal(window.document.querySelector(".recording-overview-bar")?.getAttribute("aria-label"), "Selected range: 12.0s–18.0s");
    const overviewRange = window.document.querySelector<HTMLElement>(".recording-overview-range");
    assert.equal(overviewRange?.style.left, "40%");
    assert.equal(overviewRange?.style.width, "20%");
    assert.ok(window.document.body.textContent?.includes("41.0%"));
    const frameStats = window.document.querySelector(".recording-frame-stats");
    assert.ok(frameStats?.textContent?.includes("Jank rate: 50.0%"));
    assert.ok(frameStats?.textContent?.includes("Janky presented frames: 1/2"));
    assert.ok(frameStats?.textContent?.includes("Classification coverage: 66.7%"));
    assert.ok(frameStats?.textContent?.includes("Dropped frames: 1 (25.0%)"));
    assert.ok(frameStats?.textContent?.includes("P95: 250.00 ms"));
    assert.equal(messages.length, 0, "Selecting a range does not send a chat message.");
    const buttons = Array.from(window.document.querySelectorAll<HTMLButtonElement>("button"));
    const ask = buttons.find(button => button.textContent?.includes("Ask about this range"));
    assert.ok(ask);
    ask.click();
    await settle();
    assert.equal(messages.length, 1);
    assert.equal(messages[0].role, "user");
    assert.ok(messages[0].content[0].text.includes(recordingFixture().id));
    assert.ok(messages[0].content[0].text.includes("device-wide Display FPS"));
    assert.ok(messages[0].content[0].text.includes("summary.frameStats"));
    assert.ok(messages[0].content[0].text.includes("mobile_read_performance_frames"));
    assert.ok(messages[0].content[0].text.includes("mobile_render_performance_recording"));
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
    assert.equal(changesAfterClear.length, 4);
    mounted.controller.select({ start: 12, end: 18 });
    await settle();
    const clear = Array.from(window.document.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === "Clear");
    assert.ok(clear);
    clear.click();
    await settle();
    assert.equal(mounted.controller.getSnapshot().range, undefined, "The overview Clear control restores the entire recording.");
    assert.equal(window.document.querySelectorAll(".recording-range-highlight").length, 0);
    assert.equal(window.document.querySelector(".recording-overview-range"), null);
    assert.equal(window.document.querySelector(".recording-overview-bar")?.getAttribute("aria-label"), "Entire recording: 0.0s–30.0s");
    assert.equal(messages.length, 2, "Clearing a range does not send a chat message.");
    const buttonElements = window.document.querySelectorAll<HTMLButtonElement>("button");
    const currentButtons = Array.from(buttonElements);
    const fullAsk = currentButtons.find(button => button.textContent === "Ask about recording");
    assert.ok(fullAsk);
    fullAsk.click();
    await settle();
    assert.equal(messages.length, 3);
    const asksFullRange = messages[2].content[0].text.includes('"range":{"start":0,"end":30}');
    assert.ok(asksFullRange, "Automatic highlights do not narrow the chat question.");
    const partial = recordingFixture();
    partial.fps = { status: "unavailable", samples: [], error: "Unsupported device" };
    mounted.controller.accept({ content: [], structuredContent: { recording: partial } });
    await settle();
    const partialCharts = window.document.querySelectorAll(".recording-chart");
    assert.equal(partialCharts.length, 2);
    const partialText = window.document.body.textContent ?? "";
    assert.equal(partialText.includes("FPS"), false, "Unrecorded FPS is omitted entirely.");
    const partialFrameStats = window.document.querySelector(".recording-frame-stats");
    assert.equal(partialFrameStats, null, "Unavailable per-frame capture omits Android jank statistics.");
    for (const sample of partial.samples) sample.memoryBytes = null;
    mounted.controller.accept({ content: [], structuredContent: { recording: partial } });
    await settle();
    const cpuOnlyCharts = window.document.querySelectorAll(".recording-chart");
    assert.equal(cpuOnlyCharts.length, 1, "Unrecorded memory is omitted as well.");
    mounted.controller.select({ start: 12, end: 18 });
    const next = recordingFixture();
    next.id = "bc9b6d2e-c5b5-4288-a488-bc380098d857";
    next.durationSeconds = 10;
    next.samples = next.samples.slice(0, 11);
    mounted.controller.accept({ content: [], structuredContent: { recording: next } });
    const nextState = mounted.controller.getSnapshot();
    assert.equal(nextState.range, undefined, "A different recording clears the prior selection.");
    await settle();
    const nextPath = curvePath();
    assert.equal(nextPath === "", reducedMotion === false, "A different recording gets its own entrance pause; reduced motion shows the full curve immediately.");
    const updated = { ...next, samples: [...next.samples] };
    mounted.controller.accept({ content: [], structuredContent: { recording: updated } });
    await settle();
    const refreshedEnd = curveEnd();
    assert.equal(refreshedEnd, 628, "Updating samples during the entrance pause shows the current data without starting another drawing.");
  });

}
