import type { App } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { OpenAIMessageParams } from "@openai/mcp-extensions/app";
import { recordingRangeSchema, recordingSchema, summarizeRecording } from "../shared/recordings.ts";
import type { PerformanceRecording, RecordingRange } from "../shared/recordings.ts";
import { captureUiError, countUiEvent, markUiSurfaceReady, recordUiTiming, setUiGauge, setUiSurface, setUiTelemetryContext } from "./telemetry.ts";

type RecordingState = {
  recording?: PerformanceRecording;
  range?: RecordingRange;
  canMessage: boolean;
  busy: boolean;
  error: string;
};

export class RecordingController {
  private readonly app: App;
  private state: RecordingState = { canMessage: false, busy: false, error: "" };
  private listeners = new Set<() => void>();
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private polling = false;
  private visible = false;
  private readyAt = performance.now();
  private abort = new AbortController();

  constructor(app: App) {
    this.app = app;
    document.addEventListener("visibilitychange", this.visibilityChanged);
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  getSnapshot = () => this.state;
  private update(next: Partial<RecordingState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }
  hostChanged() {
    const capabilities = this.app.getHostCapabilities();
    const canMessage = Boolean(capabilities?.message?.text);
    this.update({ canMessage });
    this.schedule();
  }
  setVisible(visible: boolean) { this.visible = visible; this.schedule(); }
  accept(result: CallToolResult) {
    if (this.disposed) return;
    if (result.isError) {
      const texts = result.content.filter(item => item.type === "text");
      const message = texts.map(item => item.text).join("\n");
      this.update({ error: message });
      return;
    }
    const data = result.structuredContent;
    if (data === undefined || data.recording === undefined) return;
    const startedAt = performance.now();
    const recording = recordingSchema.parse(data.recording);
    const changedRecording = this.state.recording?.id !== recording.id;
    const previousRange = changedRecording ? undefined : this.state.range;
    const range = data.range === undefined ? previousRange : recordingRangeSchema.parse(data.range);
    if (range) summarizeRecording(recording, range);
    if (changedRecording || this.visible) {
      setUiSurface("recording");
      setUiTelemetryContext({ device_platform: recording.target.platform, device_kind: recording.target.kind ?? (recording.target.platform === "android" ? "emulator" : "simulator") });
      setUiGauge("ui.recording.samples", recording.samples.length);
      setUiGauge("ui.recording.fps_samples", recording.fps.samples.length);
      let frameCount = 0;
      for (const sample of recording.fps.samples) frameCount += sample.frameTimeline?.frames.length ?? 0;
      setUiGauge("ui.recording.display_frames", frameCount);
      const elapsed = performance.now() - startedAt;
      recordUiTiming("ui.recording.process", elapsed);
      if (changedRecording) markUiSurfaceReady(this.readyAt);
    }
    this.update({ recording, range, error: recording.error ?? "" });
    this.schedule();
  }
  select = (range?: RecordingRange) => {
    const recording = this.state.recording;
    if (recording === undefined) return;
    if (range) {
      recordingRangeSchema.parse(range);
      summarizeRecording(recording, range);
    }
    this.update({ range, error: recording.error ?? "" });
    countUiEvent("ui.recording.range_selected");
  };
  private visibilityChanged = () => { this.schedule(); };
  private schedule() {
    clearTimeout(this.timer);
    const status = this.state.recording?.status;
    if (this.disposed || this.polling || this.visible === false || document.visibilityState === "hidden") return;
    if (status !== "connecting" && status !== "recording" && status !== "finishing") return;
    if (this.app.getHostCapabilities()?.serverTools === undefined) return;
    this.timer = setTimeout(() => { void this.poll(); }, 1000);
  }
  private async poll() {
    const recordingId = this.state.recording?.id;
    if (recordingId === undefined || this.disposed) return;
    this.polling = true;
    try {
      const result = await this.app.callServerTool({ name: "mobile_read_performance_recording", arguments: { recordingId } }, { signal: this.abort.signal });
      if (this.state.recording?.id === recordingId) this.accept(result);
    } catch (error) {
      if (this.disposed === false) {
        captureUiError(error, "recording.poll");
        this.update({ error: "Could not refresh this recording. Reopen it to try again." });
      }
    } finally { this.polling = false; this.schedule(); }
  }
  async send(action: "ask" | "open") {
    const { recording, range, canMessage, busy } = this.state;
    if (recording === undefined || canMessage === false || busy) return;
    this.update({ busy: true, error: "" });
    const selected = range ?? { start: 0, end: recording.durationSeconds };
    const reference = JSON.stringify({ recordingId: recording.id, range: selected });
    const summary = summarizeRecording(recording);
    const metrics: string[] = [];
    if (summary.averageCpuPercent !== null) metrics.push("CPU and the busiest recorded threads");
    if (summary.firstMemoryBytes !== null) metrics.push("memory");
    if (summary.averageFps !== null) metrics.push("device-wide Display FPS");
    if (summary.frameStats !== null) metrics.push("Android display jank rate, classification coverage, dropped frames, and frame pacing");
    const metricNames = metrics.join(", ");
    const hasDisplayData = summary.averageFps !== null || summary.frameStats !== null;
    const displayContext = hasDisplayData ? "; device-wide display data cannot attribute a slowdown to this app alone" : "";
    const frameContext = summary.frameStats !== null ? ". Use summary.frameStats for jank statistics; use mobile_read_performance_frames for original frame details. Show the chart with mobile_render_performance_recording when reporting jank" : "";
    const prompt = action === "ask"
      ? `Explain ${metricNames} during ${selected.start}–${selected.end}s of “${recording.title}”. Read the original samples with mobile_read_performance_recording using ${reference}. Distinguish measurements from hypotheses about their cause${displayContext}${frameContext}.`
      : `Open “${recording.title}” in Mobile Dev with ${selected.start}–${selected.end}s selected. Use mobile_open_performance_recording with ${reference}.`;
    const startedAt = performance.now();
    try {
      const message: OpenAIMessageParams = { role: "user", content: [{ type: "text", text: prompt }], _meta: { "openai/message": { target: "active", send: true } } };
      const result = await this.app.sendMessage(message);
      if (result.isError) throw new Error("The host could not send this recording to chat.");
      countUiEvent(`ui.recording.${action}`);
      const elapsed = performance.now() - startedAt;
      recordUiTiming("ui.recording.message_ack", elapsed);
    } catch (error) {
      captureUiError(error, `recording.${action}`);
      const message = error instanceof Error ? error.message : "Could not send this recording to chat.";
      this.update({ error: message });
    } finally { this.update({ busy: false }); }
  }
  dispose() {
    this.disposed = true;
    this.abort.abort();
    clearTimeout(this.timer);
    document.removeEventListener("visibilitychange", this.visibilityChanged);
    this.listeners.clear();
  }
}
