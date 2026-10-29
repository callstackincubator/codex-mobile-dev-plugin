import { chatMessage } from "./chat-message.ts";
import { cardsCallTools } from "./host-bridge.ts";
import type { HostBridge } from "./host-bridge.ts";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { comparisonDuration, comparisonReferenceSchema, comparisonSchema } from "@mobile-dev/shared/performance-comparison.ts";
import type { PerformanceComparison } from "@mobile-dev/shared/performance-comparison.ts";
import { recordingRangeSchema } from "@mobile-dev/shared/recordings.ts";
import type { RecordingRange } from "@mobile-dev/shared/recordings.ts";
import { captureUiError, countUiEvent, markUiSurfaceReady, recordUiTiming, setUiGauge, setUiSurface, setUiTelemetryContext } from "./telemetry.ts";
import { readRecording, RecordingReadError, toolResultText } from "./recording-reader.ts";
import { Store } from "./store.ts";

type ComparisonState = {
  comparison?: PerformanceComparison;
  hiddenIds: ReadonlySet<string>;
  range?: RecordingRange;
  /** Showing previews without frame detail: the full recordings are loading, or this host cannot load them. */
  preview?: "loading" | "only";
  canMessage: boolean;
  /** The server has Mobile Dev's workspace, where recordings show in full. */
  workspace: boolean;
  busy: boolean;
  error: string;
};

export class ComparisonController extends Store<ComparisonState> {
  private readonly app: HostBridge;
  private disposed = false;
  private readyAt = performance.now();
  /** The full recordings being read; a newer comparison replaces them. */
  private loading?: AbortController;

  constructor(app: HostBridge, { workspace = false }: { workspace?: boolean } = {}) {
    super({ hiddenIds: new Set(), canMessage: false, workspace, busy: false, error: "" });
    this.app = app;
  }
  hostChanged() {
    const capabilities = this.app.getHostCapabilities();
    const canMessage = Boolean(capabilities?.message?.text);
    this.update({ canMessage });
  }
  accept(result: CallToolResult) {
    if (this.disposed) return;
    if (result.isError) {
      this.update({ error: toolResultText(result) });
      return;
    }
    const data = result.structuredContent;
    if (data === undefined) return;
    this.loading?.abort();
    // Results saved before recordings were sent by reference carry the full recordings.
    if (data.recordings !== undefined) {
      this.show(comparisonSchema.parse(data));
      return;
    }
    const reference = comparisonReferenceSchema.safeParse(data);
    if (reference.success === false) return;
    const { title, recordingIds, range, previews } = reference.data;
    // The previews draw at once; hosts that let cards call tools then read the full recordings.
    const canLoad = cardsCallTools(this.app);
    if (previews) {
      countUiEvent("ui.comparison.preview");
      this.show(comparisonSchema.parse({ title, recordings: previews, ...(range ? { range } : {}) }), canLoad ? "loading" : "only");
    }
    if (canLoad) void this.load(title, recordingIds, range, previews !== undefined);
    else if (previews === undefined) this.update({ error: "This app cannot load long recordings into a comparison card." });
  }
  /** Reads the full recordings. Replacing previews keeps the runs hidden and the range selected meanwhile. */
  private async load(title: string, recordingIds: string[], range: RecordingRange | undefined, replacesPreviews: boolean) {
    const loading = this.loading = new AbortController();
    const startedAt = performance.now();
    try {
      const recordings = await Promise.all(recordingIds.map(recordingId => readRecording(this.app, recordingId, loading.signal)));
      if (loading.signal.aborted) return;
      recordUiTiming("ui.comparison.load", performance.now() - startedAt);
      this.show(comparisonSchema.parse({ title, recordings, ...(range ? { range } : {}) }), undefined, replacesPreviews);
    } catch (error) {
      if (loading.signal.aborted || this.disposed) return;
      if (error instanceof RecordingReadError === false) captureUiError(error, "comparison.load");
      // Previews already on screen stay; the card only lacks frame detail.
      if (this.state.preview) this.update({ preview: "only" });
      else this.update({ error: error instanceof RecordingReadError ? error.message : "Could not load these recordings. Reopen the comparison to try again." });
    }
  }
  private show(comparison: PerformanceComparison, preview?: ComparisonState["preview"], keepSelection = false) {
    const startedAt = performance.now();
    setUiSurface("comparison");
    const platform = comparison.recordings[0].target.platform;
    const samePlatform = comparison.recordings.every(recording => recording.target.platform === platform);
    setUiTelemetryContext({ device_platform: samePlatform ? platform : "mixed", device_kind: "none" });
    // Processing and size measure full recordings, comparable with releases that sent them; previews are counted.
    if (preview === undefined) {
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
      recordUiTiming("ui.comparison.process", performance.now() - startedAt);
    }
    this.update(keepSelection
      ? { comparison, preview, error: "" }
      : { comparison, preview, range: comparison.range, hiddenIds: new Set(), error: "" });
    if (keepSelection === false) markUiSurfaceReady(this.readyAt);
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
    const message = chatMessage(this.app, prompt);
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
  dispose() { this.disposed = true; this.loading?.abort(); this.close(); }
}
