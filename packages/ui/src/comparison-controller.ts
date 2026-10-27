import { chatMessage } from "./chat-message.ts";
import type { HostBridge } from "./host-bridge.ts";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { comparisonDuration, comparisonReferenceSchema, comparisonSchema } from "@mobile-dev/shared/performance-comparison.ts";
import type { PerformanceComparison } from "@mobile-dev/shared/performance-comparison.ts";
import { recordingRangeSchema } from "@mobile-dev/shared/recordings.ts";
import type { RecordingRange } from "@mobile-dev/shared/recordings.ts";
import { captureUiError, countUiEvent, markUiSurfaceReady, recordUiTiming, setUiGauge, setUiSurface, setUiTelemetryContext } from "./telemetry.ts";

type ComparisonState = {
  comparison?: PerformanceComparison;
  hiddenIds: ReadonlySet<string>;
  range?: RecordingRange;
  /** Showing previews without frame detail: the full recordings are loading, or this host cannot load them. */
  preview?: "loading" | "only";
  canMessage: boolean;
  busy: boolean;
  error: string;
};

export class ComparisonController {
  private readonly app: HostBridge;
  private state: ComparisonState = { hiddenIds: new Set(), canMessage: false, busy: false, error: "" };
  private listeners = new Set<() => void>();
  private disposed = false;
  private readyAt = performance.now();
  private abort = new AbortController();

  constructor(app: HostBridge) { this.app = app; }
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
    const data = result.structuredContent;
    if (data === undefined) return;
    if (data.recordings !== undefined) {
      this.show(data, undefined);
      return;
    }
    // The comparison tool sends recording IDs and, when they fit, previews without frame
    // detail. Hosts that let cards call tools then load the full recordings.
    const reference = comparisonReferenceSchema.safeParse(data);
    if (reference.success === false) return;
    const { title, recordingIds, range, previews } = reference.data;
    const canLoad = this.app.getHostCapabilities()?.serverTools !== undefined;
    if (previews) {
      countUiEvent("ui.comparison.preview");
      this.show({ title, recordings: previews, ...(range ? { range } : {}) }, canLoad ? "loading" : "only");
    }
    if (canLoad) void this.load({ title, recordingIds, range });
    else if (previews === undefined) this.update({ error: "This app cannot load long recordings into a comparison card. Compare them in Mobile Dev instead." });
  }
  private async load({ title, recordingIds, range }: { title: string; recordingIds: string[]; range?: RecordingRange }) {
    const startedAt = performance.now();
    try {
      const results = await Promise.all(recordingIds.map(recordingId => this.app.callServerTool(
        { name: "mobile_read_performance_recording", arguments: { recordingId } }, { signal: this.abort.signal })));
      if (this.disposed) return;
      const failed = results.find(result => result.isError === true);
      if (failed) {
        this.update({ error: failed.content.filter(item => item.type === "text").map(item => item.text).join("\n") });
        return;
      }
      // A host that trims large results drops the structured samples; say so rather than load forever.
      const recordings = results.map(result => {
        if (result.structuredContent?.recording === undefined) throw new Error("The host returned a recording without its samples.");
        return result.structuredContent.recording;
      });
      recordUiTiming("ui.comparison.load", performance.now() - startedAt);
      this.show({ title, recordings, ...(range ? { range } : {}) }, undefined);
    } catch (error) {
      if (this.disposed) return;
      captureUiError(error, "comparison.load");
      // Previews already on screen stay; the card only lacks frame detail.
      if (this.state.preview) this.update({ preview: "only" });
      else this.update({ error: "Could not load these recordings. Reopen the comparison to try again." });
    }
  }
  private show(data: unknown, preview: ComparisonState["preview"]) {
    const startedAt = performance.now();
    const comparison = comparisonSchema.parse(data);
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
    // Full recordings replacing their previews keep the runs hidden and range selected meanwhile.
    const previous = this.state.comparison;
    const upgrade = this.state.preview !== undefined && previous !== undefined
      && previous.recordings.map(run => run.id).join() === comparison.recordings.map(run => run.id).join();
    this.update(upgrade
      ? { comparison, preview, error: "" }
      : { comparison, preview, range: comparison.range, hiddenIds: new Set(), error: "" });
    if (upgrade === false) markUiSurfaceReady(this.readyAt);
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
  dispose() { this.disposed = true; this.abort.abort(); this.listeners.clear(); }
}
