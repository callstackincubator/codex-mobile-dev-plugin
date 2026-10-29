import { chatMessage } from "./chat-message.ts";
import { cardsCallTools } from "./host-bridge.ts";
import type { HostAttachmentsSource, HostBridge } from "./host-bridge.ts";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { recordingRangeSchema, recordingReferenceSchema, recordingSchema, summarizeRecording } from "@mobile-dev/shared/recordings.ts";
import type { PerformanceRecording, RecordingRange } from "@mobile-dev/shared/recordings.ts";
import { captureUiError, countUiEvent, markUiSurfaceReady, recordUiTiming, setUiGauge, setUiSurface, setUiTelemetryContext } from "./telemetry.ts";
import { readRecording, RecordingReadError, RecordingTrimmedError, toolResultText } from "./recording-reader.ts";
import { Store } from "./store.ts";

type RecordingState = {
  recording?: PerformanceRecording;
  range?: RecordingRange;
  /** Showing a preview without thread or frame detail: the full recording is loading, or this host cannot load it. */
  preview?: "loading" | "only";
  canMessage: boolean;
  /** The server has Mobile Dev's workspace to open the recording in. */
  canOpen: boolean;
  busy: boolean;
  error: string;
};

export type RecordingOptions = {
  /** The host's attachments, where it shows the panel's context in its composer. */
  attachments?: HostAttachmentsSource;
  /** Whether the server has Mobile Dev's workspace to open recordings in. */
  workspace?: boolean;
};

export class RecordingController extends Store<RecordingState> {
  private readonly app: HostBridge;
  private readonly attachments: HostAttachmentsSource;
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private polling = false;
  private visible = false;
  private readyAt = performance.now();
  private lifetime = new AbortController();
  /** The full recording being read; a newer recording replaces it. */
  private loading?: AbortController;

  constructor(app: HostBridge, { attachments = () => undefined, workspace = false }: RecordingOptions = {}) {
    super({ canMessage: false, canOpen: workspace, busy: false, error: "" });
    this.app = app;
    this.attachments = attachments;
    document.addEventListener("visibilitychange", this.visibilityChanged);
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
      this.update({ error: toolResultText(result) });
      return;
    }
    const data = result.structuredContent;
    if (data === undefined) return;
    this.loading?.abort();
    // Results saved before recordings were sent by reference carry the full recording.
    if (data.recording !== undefined) {
      this.present(recordingSchema.parse(data.recording), data.range);
      return;
    }
    const reference = recordingReferenceSchema.safeParse(data);
    if (reference.success === false) return;
    const { recordingId, range, preview } = reference.data;
    // The workspace reopening a recording it already shows in full only selects the range.
    if (this.state.recording?.id === recordingId && this.state.preview === undefined) {
      this.present(this.state.recording, range);
      return;
    }
    // The preview draws at once; hosts that let cards call tools then read the full recording.
    const canLoad = cardsCallTools(this.app);
    if (preview) {
      countUiEvent("ui.recording.preview");
      this.present(preview, range, canLoad ? "loading" : "only");
    }
    // Without a preview on screen, the full recording opens at the requested range.
    if (canLoad) void this.load(recordingId, preview ? undefined : range);
    else if (preview === undefined) this.update({ error: "This app cannot load the recording." });
  }
  /** Without a requested range, the same recording keeps its selected range across preview replacement and refresh. */
  private present(recording: PerformanceRecording, requestedRange?: unknown, preview?: RecordingState["preview"]) {
    const startedAt = performance.now();
    const changedRecording = this.state.recording?.id !== recording.id;
    const range = requestedRange === undefined ? changedRecording ? undefined : this.state.range : recordingRangeSchema.parse(requestedRange);
    if (range) summarizeRecording(recording, range);
    if (changedRecording || this.visible) {
      setUiSurface("recording");
      setUiTelemetryContext({ device_platform: recording.target.platform, device_kind: recording.target.kind ?? (recording.target.platform === "android" ? "emulator" : "simulator") });
      // Processing and size measure full recordings, comparable with releases that sent them; previews are counted.
      if (preview === undefined) {
        setUiGauge("ui.recording.samples", recording.samples.length);
        setUiGauge("ui.recording.fps_samples", recording.fps.samples.length);
        let frameCount = 0;
        for (const sample of recording.fps.samples) frameCount += sample.frameTimeline?.frames.length ?? 0;
        setUiGauge("ui.recording.display_frames", frameCount);
        recordUiTiming("ui.recording.process", performance.now() - startedAt);
      }
      if (changedRecording) markUiSurfaceReady(this.readyAt);
    }
    this.update({ recording, range, preview, error: recording.error ?? "" });
    this.schedule();
  }
  private async load(recordingId: string, range?: RecordingRange) {
    const loading = this.loading = new AbortController();
    const startedAt = performance.now();
    try {
      const recording = await readRecording(this.app, recordingId, loading.signal);
      if (loading.signal.aborted) return;
      recordUiTiming("ui.recording.load", performance.now() - startedAt);
      this.present(recording, range);
    } catch (error) {
      if (loading.signal.aborted || this.disposed) return;
      if (error instanceof RecordingReadError === false) captureUiError(error, "recording.load");
      // A preview already on screen stays; the card only lacks thread and frame detail.
      if (this.state.preview) this.update({ preview: "only" });
      else this.update({ error: error instanceof RecordingReadError ? error.message : "Could not load this recording. Reopen it to try again." });
    }
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
    if (cardsCallTools(this.app) === false) return;
    this.timer = setTimeout(() => { void this.poll(); }, 1000);
  }
  private async poll() {
    const recordingId = this.state.recording?.id;
    if (recordingId === undefined || this.disposed) return;
    this.polling = true;
    try {
      const recording = await readRecording(this.app, recordingId, this.lifetime.signal);
      if (this.state.recording?.id === recordingId) this.present(recording);
    } catch (error) {
      // A host that trims long results keeps the card on what it shows until the next read.
      if (this.disposed === false && error instanceof RecordingTrimmedError === false) {
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
    let sending = false;
    try {
      const modelContext = this.attachments();
      if (modelContext) {
        const current = modelContext.getCurrent();
        const contextStartedAt = performance.now();
        try {
          await modelContext.update({
            content: [...(current?.content ?? []).filter(item => item._meta?.["mobile-dev/recordingReference"] !== true), {
              type: "text", text: prompt,
              _meta: { "openai/title": `${recording.title.replace(/\s+/g, " ").trim()} · ${selected.start}–${selected.end}s`, "mobile-dev/recordingReference": true },
            }],
            structuredContent: { ...current?.structuredContent, selectedRecording: { recordingId: recording.id, range: selected } },
          }, { timeout: 5000 });
        } finally { recordUiTiming("ui.recording.context_attach", performance.now() - contextStartedAt); }
      }
      if (this.disposed) return;
      const text = modelContext ? (action === "ask" ? (range ? "Explain this selected range." : "Explain this recording.") : "Open this recording in Mobile Dev.") : prompt;
      const message = chatMessage(this.app, text);
      const startedAt = performance.now();
      sending = true;
      const result = await this.app.sendMessage(message, { timeout: 5000, maxTotalTimeout: 5000 });
      if (result.isError) throw new Error("The host could not send this recording to chat.");
      countUiEvent(`ui.recording.${action}`);
      const elapsed = performance.now() - startedAt;
      recordUiTiming("ui.recording.message_ack", elapsed);
    } catch (error) {
      captureUiError(new Error("Recording chat action failed."), `recording.${action}`);
      const timedOut = sending && typeof error === "object" && error !== null && "code" in error && error.code === -32001;
      const message = timedOut ? "The host did not confirm delivery. Check the chat before retrying to avoid sending the question twice." : error instanceof Error ? error.message : "Could not send this recording to chat.";
      this.update({ error: message });
    } finally { this.update({ busy: false }); }
  }
  dispose() {
    this.disposed = true;
    this.lifetime.abort();
    this.loading?.abort();
    clearTimeout(this.timer);
    document.removeEventListener("visibilitychange", this.visibilityChanged);
    this.close();
  }
}
