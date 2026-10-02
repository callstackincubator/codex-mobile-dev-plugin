import type { App } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { OpenAIMessageParams } from "@openai/mcp-extensions/app";
import { comparisonDuration, comparisonSchema } from "../shared/performance-comparison.ts";
import type { PerformanceComparison } from "../shared/performance-comparison.ts";
import { recordingRangeSchema } from "../shared/recordings.ts";
import type { RecordingRange } from "../shared/recordings.ts";
import { captureUiError, countUiEvent, markUiSurfaceReady, recordUiTiming, setUiGauge, setUiSurface, setUiTelemetryContext } from "./telemetry.ts";

type ComparisonState = {
  comparison?: PerformanceComparison;
  hiddenIds: ReadonlySet<string>;
  range?: RecordingRange;
  canMessage: boolean;
  busy: boolean;
  error: string;
};

export class ComparisonController {
  private readonly app: App;
  private state: ComparisonState = { hiddenIds: new Set(), canMessage: false, busy: false, error: "" };
  private listeners = new Set<() => void>();
  private disposed = false;
  private readyAt = performance.now();

  constructor(app: App) { this.app = app; }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  getSnapshot = () => this.state;
  private update(next: Partial<ComparisonState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }
  hostChanged() {
    const capabilities = this.app.getHostCapabilities();
    const canMessage = Boolean(capabilities?.message?.text);
    this.update({ canMessage });
  }
  accept(result: CallToolResult) {
    if (this.disposed) return;
    if (result.isError) {
      const texts = result.content.filter(item => item.type === "text");
      const error = texts.map(item => item.text).join("\n");
      this.update({ error });
      return;
    }
    if (result.structuredContent?.recordings === undefined) return;
    const startedAt = performance.now();
    const comparison = comparisonSchema.parse(result.structuredContent);
    setUiSurface("comparison");
    const platform = comparison.recordings[0].target.platform;
    const samePlatform = comparison.recordings.every(recording => recording.target.platform === platform);
    setUiTelemetryContext({ device_platform: samePlatform ? platform : "mixed", device_kind: "none" });
    let samples = 0;
    let fpsSamples = 0;
    let displayFrames = 0;
    for (const recording of comparison.recordings) {
      samples += recording.samples.length;
      fpsSamples += recording.fps.samples.length;
      for (const sample of recording.fps.samples) displayFrames += sample.frameTimeline?.frames.length ?? 0;
    }
    setUiGauge("ui.comparison.runs", comparison.recordings.length);
    setUiGauge("ui.comparison.samples", samples);
    setUiGauge("ui.comparison.fps_samples", fpsSamples);
    setUiGauge("ui.comparison.display_frames", displayFrames);
    const elapsed = performance.now() - startedAt;
    recordUiTiming("ui.comparison.process", elapsed);
    this.update({ comparison, range: comparison.range, hiddenIds: new Set(), error: "" });
    markUiSurfaceReady(this.readyAt);
  }
  select = (range?: RecordingRange) => {
    const comparison = this.state.comparison;
    if (comparison === undefined) return;
    if (range !== undefined) {
      recordingRangeSchema.parse(range);
      const duration = comparisonDuration(comparison.recordings);
      if (range.end > duration) throw new Error("The range exceeds the comparison's duration.");
    }
    this.update({ range });
    countUiEvent("ui.comparison.range_selected");
  };
  toggle = (id: string) => {
    const comparison = this.state.comparison;
    const exists = comparison?.recordings.some(recording => recording.id === id);
    if (exists !== true) return;
    const hiddenIds = new Set(this.state.hiddenIds);
    if (hiddenIds.has(id)) hiddenIds.delete(id);
    else hiddenIds.add(id);
    this.update({ hiddenIds });
    countUiEvent("ui.comparison.run_toggled");
  };
  async ask() {
    const { comparison, range, canMessage, busy } = this.state;
    if (comparison === undefined || canMessage === false || busy || this.disposed) return;
    this.update({ busy: true, error: "" });
    const recordingIds = comparison.recordings.map(recording => recording.id);
    const reference = JSON.stringify({ recordingIds, title: comparison.title, ...(range ? { range } : {}) });
    const interval = range ? `${range.start}–${range.end}s` : "the entire runs";
    const prompt = `Compare CPU, memory, and device-wide Display FPS for ${interval}, aligned at recording start. Read the original runs and summaries with mobile_compare_performance_recordings using ${reference}. Account for different durations, devices, apps and memory definitions. Distinguish measurements from hypotheses about their cause; device-wide display data cannot attribute a slowdown to one app.`;
    const message: OpenAIMessageParams = { role: "user", content: [{ type: "text", text: prompt }], _meta: { "openai/message": { target: "active", send: true } } };
    const startedAt = performance.now();
    try {
      const result = await this.app.sendMessage(message);
      if (result.isError) throw new Error("The host could not send this comparison to chat.");
      countUiEvent("ui.comparison.ask");
      const elapsed = performance.now() - startedAt;
      recordUiTiming("ui.comparison.message_ack", elapsed);
    } catch (error) {
      captureUiError(error, "comparison.ask");
      const text = error instanceof Error ? error.message : "Could not send this comparison to chat.";
      this.update({ error: text });
    } finally { this.update({ busy: false }); }
  }
  dispose() { this.disposed = true; this.listeners.clear(); }
}
