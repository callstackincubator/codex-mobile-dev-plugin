import { chatMessage } from "./chat-message.ts";
import { attachReference, cardsCallTools } from "./host-bridge.ts";
import type { HostAttachmentsSource, HostBridge } from "./host-bridge.ts";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { traceSiftAnalysisSchema, traceSiftCaptureSchema, traceSiftCaptureUrlSchema, traceSiftHandoffSchema, traceSiftReadinessSchema, traceSiftRestoreSchema, traceSiftSetupActionResultSchema, traceSiftRnTargetsSchema, type TraceSiftAnalysis, type TraceSiftProfileType, type TraceSiftReadiness, type TraceSiftRnTarget, type TraceSiftSetupAction } from "@mobile-dev/shared/tracesift.ts";
import { decodeTraceSiftExplorePayload, TRACE_SIFT_PAYLOAD_MAX_BYTES, traceSiftExploreEnvelopeSchema, TRACE_SIFT_PAYLOAD_TOO_LARGE, traceSiftPayloadRefused, type TraceSiftExploreKind } from "@mobile-dev/shared/tracesift-explore.ts";
import { buildSelectionPrompt, frameSelectionEvidence, type SelectionCard } from "@mobile-dev/shared/tracesift-selection.ts";
import { findingName } from "@mobile-dev/shared/tracesift-labels.ts";
import { buildReactSelectionPrompt, reactSelectionEvidence, type ReactSelectionRecording } from "@mobile-dev/shared/tracesift-react-selection.ts";
import type { ContributionChartKind } from "./components/tracesift/contribution-chart.tsx";
import { captureUiError, countUiEvent, markUiSurfaceReady, recordUiTiming, setUiGauge, setUiSurface, setUiTelemetryContext } from "./telemetry.ts";

export type TraceSiftCaptureSource = "rn" | "chrome";

/** One place a profiling build can go. `device` is what `profile build --device` takes. */
export type TraceSiftRunTarget = { platform: "ios" | "android"; kind: "simulator" | "device" | "android"; id?: string; name: string; note: string };

/**
 * "Run with TraceSift": produce a profiling build from the panel.
 *
 * `setup` is what the CLI itself reads to decide whether the profiler package
 * still has to be installed, so a project that has it goes straight to targets.
 */
type RunState = {
  open: boolean;
  /** The folder the build runs in; the same one the server saved for recording. */
  projectPath: string;
  pickingProject: boolean;
  checking: boolean;
  setup?: { installed: boolean; command: string; platforms: ("ios" | "android")[] };
  installing: boolean;
  targets: TraceSiftRunTarget[];
  /** The target being built for, while a build is running. */
  building?: TraceSiftRunTarget;
  error: string;
  /** The end of the last successful build's log. */
  notice: string;
};

type State = {
  recordedProfiles: { path: string; name: string; recordedAt: string; sizeBytes: number; projectName?: string }[];
  deletingProfile?: string;
  analysis?: TraceSiftAnalysis;
  canInvestigate: boolean;
  /** Explore, the project and hand-offs need the host to let cards call the server. */
  canCallTools: boolean;
  dark: boolean;
  busyCard?: string;
  error: string;
  /** Said when a finding was handed to the browser window instead of this panel. */
  notice: string;
  /** File name the upload pane is waiting on. Absent in the inline card. */
  analyzing?: { name: string; profileType: TraceSiftProfileType };
  /**
   * Recording a running app, rather than reading a profile someone already has.
   *
   * `step` is where the control stands: `idle` offers a start, `launched`
   * waits for the person to sign in or navigate, `recording` is live. The busy
   * steps are separate so the buttons can disable themselves without a second
   * flag, and `url` outlives the launch so a reopened panel can say what is open.
   *
   * `source` is which of the two the control is pointed at. React Native needs
   * no `launched` step at all — the app is already running, so one press
   * records — and the two sources keep their own fields side by side so
   * switching chips does not throw away what the other one found.
   */
  capture: {
    source: TraceSiftCaptureSource;
    step: "idle" | "launching" | "launched" | "starting" | "recording" | "stopping" | "closing";
    /** Chrome: the address to open. */
    url: string;
    /** React Native: the apps Metro reported, and which of them to record. */
    targets: TraceSiftRnTarget[];
    /** Empty means let the CLI pick the app it recommends, as the agent does. */
    targetId: string;
    metro: string;
    targetsError: string;
    loadingTargets: boolean;
    error: string;
  };
  run: RunState;
  /** Which drawing every card on this analysis carries; one switch, as on the web. */
  checkingReadiness: boolean;
  readiness?: TraceSiftReadiness;
  setupAction?: TraceSiftSetupAction;
  setupNotice: string;
  chartKind: ContributionChartKind;
  /** The finding shown; kept here so returning from Explore lands on the explored finding. */
  selectedCard?: string;
  /** The card whose hand-off is being fetched, and the one just copied. */
  handoffCard?: string;
  copiedCard?: string;
  openingExploreCard?: string;
  /** The finding whose full explorer is on screen, or nothing while in the cards list. */
  explorer?: {
    cardId: string;
    kind: "task" | "react";
    /** `TaskHandoff` or `ReactExploreHandoff` from @callstack/tracesift-explore. */
    payload: unknown;
    /** The call-tree node the card's chart band was clicked, if any. */
    focus?: string;
    /** Which commit of a React timeline is open, as `<rootId>.<commitIndex>`; the explorer reports switches. */
    commitKey?: string;
    /** Whether a click picks a frame rather than navigating to it. */
    picking?: boolean;
    /** Picked frames in order: `TaskTreeNode.id` for tasks, `<rootId>.<commitIndex>.<fiberId>` for React. */
    selected?: string[];
  };
};

function composerUnavailable(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:no (?:active |available )?composer|composer.*(?:unavailable|not available|not active)|requires? an (?:active|available) composer|MCP app messages are disabled for this view)/i.test(message);
}

export class TraceSiftController {
  private state: State = { recordedProfiles: [], canInvestigate: false, canCallTools: false, dark: false, error: "", notice: "", setupNotice: "", checkingReadiness: false, chartKind: "bar",
    capture: { source: "rn", step: "idle", url: "", targets: [], targetId: "", metro: "", targetsError: "", loadingTargets: false, error: "" },
    run: { open: false, projectPath: "", pickingProject: false, checking: false, installing: false, targets: [], error: "", notice: "" } };
  private listeners = new Set<() => void>();
  private disposed = false;
  private readyAt = performance.now();
  /** When the current explorer's payload arrived, so its own readiness can be timed. */
  private explorerReadyAt = 0;
  private readonly app: HostBridge;
  private readonly attachments: HostAttachmentsSource;
  private viewId?: string | number;
  private inputKey?: string;
  private copiedTimer?: ReturnType<typeof setTimeout>;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private buildPollTimer?: ReturnType<typeof setTimeout>;
  private buildRunId?: string;
  private buildStartedAt = 0;
  private reconnectGeneration = 0;
  /** Serializes `mobile_remember_tracesift_analysis` calls so out-of-order completions cannot write a stale analysis over a newer one. */
  private rememberChain: Promise<void> = Promise.resolve();
  /** Bumped by every restore attempt; a response only applies while it still matches the latest one requested. */
  private restoreToken = 0;
  /** Bumped by every readiness check so reopening cannot apply an older result after Retry. */
  private readinessToken = 0;
  /** `attachments` reads the host's composer pills, where it has them. */
  constructor(app: HostBridge, { attachments = () => undefined }: { attachments?: HostAttachmentsSource } = {}) {
    this.app = app;
    this.attachments = attachments;
  }

  /** The authoritative hand-off for one card. Investigate sends it; Copy copies it. */
  private async handoff(cardId: string) {
    const analysisId = this.state.analysis?.analysisId;
    if (!analysisId) throw new Error("No analysis is open.");
    const startedAt = performance.now();
    const result = await this.app.callServerTool({ name: "mobile_get_tracesift_handoff", arguments: { analysisId, cardId } });
    recordUiTiming("ui.tracesift.handoff", performance.now() - startedAt);
    if (result.isError) throw new Error(result.content.filter(item => item.type === "text").map(item => item.text).join("\n") || "TraceSift could not prepare this investigation.");
    const parsed = traceSiftHandoffSchema.safeParse(result.structuredContent);
    if (!parsed.success) throw new Error("TraceSift returned an invalid handoff result.");
    return parsed.data.handoff;
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  private update(next: Partial<State>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }
  hostChanged() {
    const capabilities = this.app.getHostCapabilities();
    // TraceSift's components read the theme from a `.dark` ancestor, not the document attribute.
    this.update({
      canInvestigate: cardsCallTools(this.app) && Boolean(capabilities?.message?.text),
      canCallTools: cardsCallTools(this.app),
      dark: this.app.getHostContext()?.theme === "dark",
    });
  }
  accept(result: CallToolResult, remember = true) {
    if (this.disposed) return;
    if (result.isError) {
      this.update({ error: result.content.filter(item => item.type === "text").map(item => item.text).join("\n") });
      return;
    }
    if (result.structuredContent?.analysisId === undefined) return;
    const startedAt = performance.now();
    const parsed = traceSiftAnalysisSchema.safeParse(result.structuredContent);
    if (!parsed.success) throw new Error("TraceSift returned an invalid analysis result.");
    const analysis = parsed.data;
    setUiSurface("tracesift");
    setUiGauge("ui.tracesift.cards", analysis.cards.length);
    recordUiTiming("ui.tracesift.process", performance.now() - startedAt);
    this.update({
      analysis, readiness: { apiVersion: 1, status: "ready" }, checkingReadiness: false, error: "",
      busyCard: undefined, copiedCard: undefined, handoffCard: undefined, openingExploreCard: undefined, explorer: undefined, selectedCard: undefined,
    });
    // Setting the context flushes the previous context's measurements.
    setUiTelemetryContext({ tracesift_view: "cards", tracesift_profile: analysis.profileType });
    // A new analysis drops the picks; `tracesift_view` does not change here, so nothing else would reset the gauge.
    setUiGauge("ui.tracesift.selected_frames", 0);
    markUiSurfaceReady(this.readyAt);
    if (remember && this.viewId !== undefined) void this.remember(this.viewId, analysis.analysisId);
  }
  setViewId = (viewId: string | number) => {
    if (this.disposed || this.viewId === viewId) return;
    this.viewId = viewId;
    const analysisId = this.state.analysis?.analysisId;
    if (analysisId) void this.remember(viewId, analysisId);
    else void this.restore(viewId);
  };
  setProfileInput = (path: string, profileType: TraceSiftProfileType) => {
    const inputKey = JSON.stringify({ path, profileType });
    if (this.disposed || this.inputKey === inputKey) return;
    this.inputKey = inputKey;
    if (!this.state.analysis) void this.restoreInput(path, profileType);
  };
  private remember = (viewId: string | number, analysisId: string): Promise<void> => {
    const run = async () => {
      if (!cardsCallTools(this.app)) return;
      const startedAt = performance.now();
      try {
        const result = await this.app.callServerTool({ name: "mobile_remember_tracesift_analysis", arguments: { viewId, analysisId } });
        recordUiTiming("ui.tracesift.remember", performance.now() - startedAt);
        if (result.isError || result.structuredContent?.remembered !== true) throw new Error("TraceSift could not remember this analysis.");
        countUiEvent("ui.tracesift.remember_success");
      } catch {
        countUiEvent("ui.tracesift.remember_failed");
        captureUiError(new Error("TraceSift analysis registration failed."), "tracesift.remember");
      }
    };
    // Chained so an earlier call cannot overwrite a later one's write to the view reference.
    this.rememberChain = this.rememberChain.then(run);
    return this.rememberChain;
  };
  restore = async (viewId: string | number) => {
    if (this.disposed || this.state.analysis || !cardsCallTools(this.app)) return;
    const token = ++this.restoreToken;
    const startedAt = performance.now();
    try {
      const result = await this.app.callServerTool({ name: "mobile_restore_tracesift_analysis", arguments: { viewId } });
      recordUiTiming("ui.tracesift.restore", performance.now() - startedAt);
      if (this.disposed || this.state.analysis || token !== this.restoreToken) return;
      if (result.isError) throw new Error(result.content.filter(item => item.type === "text").map(item => item.text).join("\n") || "TraceSift could not restore this analysis.");
      const parsed = traceSiftRestoreSchema.safeParse(result.structuredContent);
      if (!parsed.success) throw new Error("TraceSift returned an invalid restore result.");
      countUiEvent(parsed.data.restored ? "ui.tracesift.restore_hit" : "ui.tracesift.restore_miss");
      if (parsed.data.analysis) this.accept({ content: [], structuredContent: parsed.data.analysis }, false);
    } catch (error) {
      if (token !== this.restoreToken) return;
      countUiEvent("ui.tracesift.restore_failed");
      captureUiError(new Error("TraceSift analysis restore failed."), "tracesift.restore");
      if (!this.state.analysis) this.update({ error: error instanceof Error ? error.message : "TraceSift could not restore this analysis." });
    }
  };
  private restoreInput = async (path: string, profileType: TraceSiftProfileType) => {
    if (this.disposed || this.state.analysis || !cardsCallTools(this.app)) return;
    const token = ++this.restoreToken;
    const startedAt = performance.now();
    try {
      const result = await this.app.callServerTool({ name: "mobile_restore_tracesift_analysis_by_input", arguments: { path, profileType } });
      recordUiTiming("ui.tracesift.restore", performance.now() - startedAt);
      if (this.disposed || this.state.analysis || token !== this.restoreToken) return;
      if (result.isError) throw new Error(result.content.filter(item => item.type === "text").map(item => item.text).join("\n") || "TraceSift could not restore this analysis.");
      const parsed = traceSiftRestoreSchema.safeParse(result.structuredContent);
      if (!parsed.success) throw new Error("TraceSift returned an invalid restore result.");
      countUiEvent(parsed.data.restored ? "ui.tracesift.restore_hit" : "ui.tracesift.restore_miss");
      if (parsed.data.analysis) this.accept({ content: [], structuredContent: parsed.data.analysis }, false);
    } catch (error) {
      if (token !== this.restoreToken) return;
      countUiEvent("ui.tracesift.restore_failed");
      captureUiError(new Error("TraceSift analysis input restore failed."), "tracesift.restore_input");
      if (!this.state.analysis) this.update({ error: error instanceof Error ? error.message : "TraceSift could not restore this analysis." });
    }
  };
  /** Sends one hand-off to the active chat, as a pill where the host has them. Never retry a timeout: the message may have landed. */
  private async sendHandoff(text: string, event: string, cardId: string, pill: { title: string; message: string }) {
    let sending = false;
    try {
      const modelContext = this.attachments();
      if (modelContext) {
        const contextStartedAt = performance.now();
        try {
          await attachReference(modelContext, {
            marker: "mobile-dev/tracesiftHandoff", title: pill.title, text,
            structuredContent: { selectedTraceSiftFinding: { analysisId: this.state.analysis?.analysisId, cardId } },
          });
        } finally { recordUiTiming("ui.tracesift.context_attach", performance.now() - contextStartedAt); }
      }
      if (this.disposed) return;
      const message = chatMessage(this.app, modelContext ? pill.message : text);
      const sendStartedAt = performance.now();
      sending = true;
      const sent = await this.app.sendMessage(message, { timeout: 5000, maxTotalTimeout: 5000 });
      if (sent.isError) throw new Error("The host could not start this investigation.");
      recordUiTiming("ui.tracesift.message_ack", performance.now() - sendStartedAt);
      countUiEvent(event);
    } catch (error) {
      const timedOut = sending && typeof error === "object" && error !== null && "code" in error && error.code === -32001;
      const missingComposer = sending && composerUnavailable(error);
      countUiEvent(timedOut ? "ui.tracesift.delivery_unconfirmed" : missingComposer ? "ui.tracesift.composer_unavailable" : "ui.tracesift.send_failed");
      if (!timedOut && !missingComposer) captureUiError(new Error("TraceSift investigation action failed."), "tracesift.investigate");
      throw new Error(timedOut
        ? "The host did not confirm delivery. Check the chat before retrying to avoid sending the investigation twice."
        : missingComposer
          ? "The host could not find this chat's input. Reopen the chat, then try Investigate again."
          : error instanceof Error ? error.message : "Could not start this investigation.",
        { cause: error });
    }
  }

  /** How the card names a finding, so its pill reads like the list beside it. */
  private findingLabel(analysis: TraceSiftAnalysis, cardId: string) {
    const index = analysis.cards.findIndex(card => card.id === cardId);
    return { noun: analysis.profileType === "cpu" ? "task" : "commit", rank: index + 1, name: findingName(analysis.cards[index]) };
  }
  investigate = async (cardId: string) => {
    const { analysis, canInvestigate, busyCard } = this.state;
    if (!analysis || !canInvestigate || busyCard || this.disposed || !analysis.cards.some(card => card.id === cardId)) return;
    this.update({ busyCard: cardId, error: "" });
    try {
      let handoff: string;
      try { handoff = await this.handoff(cardId); }
      catch (error) {
        countUiEvent("ui.tracesift.handoff_failed");
        throw error;
      }
      // The chat already works in the reader's project, so the hand-off goes as is.
      const { noun, rank, name } = this.findingLabel(analysis, cardId);
      await this.sendHandoff(handoff, "ui.tracesift.investigate", cardId, {
        title: `TraceSift · ${noun} ${rank}: ${name}`, message: `Investigate this TraceSift ${noun}.`,
      });
    } catch (error) {
      this.update({ error: error instanceof Error ? error.message : "Could not start this investigation." });
    } finally { this.update({ busyCard: undefined }); }
  };
  setChartKind = (chartKind: ContributionChartKind) => { this.update({ chartKind }); };
  /** Show another finding. Counted, because the card shows one at a time and the rest wait in a list. */
  selectCard = (cardId: string) => {
    const { analysis, selectedCard } = this.state;
    const first = analysis?.cards[0]?.id;
    if (!analysis?.cards.some(card => card.id === cardId) || (selectedCard ?? first) === cardId) return;
    this.update({ selectedCard: cardId });
    countUiEvent("ui.tracesift.finding_selected");
  };

  /** The card's hand-off on the clipboard — the same text Investigate sends. */
  copyHandoff = async (cardId: string) => {
    if (this.state.handoffCard || this.disposed) return;
    this.update({ handoffCard: cardId, copiedCard: undefined, error: "" });
    try {
      const handoff = await this.handoff(cardId);
      await navigator.clipboard.writeText(handoff);
      countUiEvent("ui.tracesift.copy_handoff");
      this.update({ copiedCard: cardId });
      this.copiedTimer = setTimeout(() => this.update({ copiedCard: undefined }), 2000);
    } catch (error) {
      countUiEvent("ui.tracesift.copy_failed");
      this.update({ error: error instanceof Error ? error.message : "That hand-off could not be copied." });
    } finally { this.update({ handoffCard: undefined }); }
  };

  /** Opens the full explorer for one card, focused on the clicked chart node. */
  openExplore = async (cardId: string, focus = "") => {
    const { analysis } = this.state;
    if (!analysis || this.disposed || this.state.openingExploreCard || this.state.explorer) return;
    const card = analysis.cards.find(entry => entry.id === cardId);
    if (!card) return;
    if (!cardsCallTools(this.app)) {
      this.update({ notice: "This app does not let the card open Explore. Ask the agent about this card." });
      return;
    }
    this.update({ openingExploreCard: cardId, error: "", notice: "" });
    const startedAt = performance.now();
    try {
      const result = await this.app.callServerTool({
        name: "mobile_tracesift_explore_payload",
        arguments: analysis.profileType === "cpu"
          ? { analysisId: analysis.analysisId, taskIndex: card.taskIndex }
          : { analysisId: analysis.analysisId },
      });
      if (result.isError) throw new Error(result.content.filter(item => item.type === "text" && "text" in item).map(item => item.text).join("\n") || "TraceSift could not open this task.");
      const envelope = traceSiftExploreEnvelopeSchema.safeParse(result.structuredContent);
      if (!envelope.success) throw new Error("TraceSift did not return the data this explorer needs.");
      if (envelope.data.payloadBytes > TRACE_SIFT_PAYLOAD_MAX_BYTES) throw new Error(TRACE_SIFT_PAYLOAD_TOO_LARGE);
      const payload = await decodeTraceSiftExplorePayload(result, envelope.data);
      // `accept` may have replaced the analysis while the payload loaded; installing it would pair the new reading with an unknown card id.
      if (this.disposed || this.state.analysis?.analysisId !== analysis.analysisId) {
        this.update({ openingExploreCard: undefined });
        return;
      }
      const kind: TraceSiftExploreKind = envelope.data.kind;
      // Switched before recording timings so the fetch is attributed to the explorer.
      setUiTelemetryContext({ tracesift_view: "explorer" });
      recordUiTiming("ui.tracesift.payload", performance.now() - startedAt);
      setUiGauge("ui.tracesift.payload_bytes", envelope.data.payloadBytes);
      this.explorerReadyAt = startedAt;
      // The host may decline fullscreen; the explorer still works inline.
      void this.requestDisplayMode("fullscreen");
      this.update({
        openingExploreCard: undefined,
        selectedCard: cardId,
        explorer: {
          cardId, kind, payload,
          ...(focus ? { focus } : {}),
          ...(kind === "react" ? { commitKey: `${card.rootId}.${card.commitIndex}` } : {}),
        },
      });
      countUiEvent("ui.tracesift.explore");
      markUiSurfaceReady(this.explorerReadyAt);
    } catch (error) {
      const message = error instanceof Error ? error.message : "That task could not be opened.";
      // Too big for the bridge: open the browser window instead and say so.
      if (traceSiftPayloadRefused(message)) {
        countUiEvent("ui.tracesift.explore_too_large");
        this.update({ openingExploreCard: undefined });
        await this.openExploreInBrowser(cardId, focus);
        if (!this.disposed && !this.state.error) this.update({ notice: `${TRACE_SIFT_PAYLOAD_TOO_LARGE} Opened it in your browser instead.` });
        return;
      }
      countUiEvent("ui.tracesift.explore_failed");
      captureUiError(error, "tracesift.explore");
      this.update({ openingExploreCard: undefined, error: message });
    }
  };

  /** Back to the cards list; drops the large payload. */
  closeExplore = () => {
    if (this.disposed || !this.state.explorer) return;
    this.update({ explorer: undefined });
    // Opening the explorer asked for fullscreen; hand the width back.
    void this.requestDisplayMode("inline");
    setUiTelemetryContext({ tracesift_view: "cards" });
    // Picks belong to the explorer reading; reset the gauge so it is not reported against the card list.
    setUiGauge("ui.tracesift.selected_frames", 0);
  };

  setExploreFocus = (focus?: string) => {
    const next = focus || undefined;
    const explorer = this.state.explorer;
    if (this.disposed || !explorer || explorer.focus === next) return;
    const updated = { ...explorer };
    if (next === undefined) delete updated.focus; else updated.focus = next;
    this.update({ explorer: updated });
  };

  /** Which commit of an open React timeline the explorer is showing. */
  setExploreCommit = (commitKey: string) => {
    const explorer = this.state.explorer;
    if (this.disposed || !explorer || explorer.commitKey === commitKey) return;
    this.update({ explorer: { ...explorer, commitKey } });
  };

  /** Switches between picking and navigating frames. Turning it off empties the set. */
  setPicking = (picking: boolean) => {
    const explorer = this.state.explorer;
    if (this.disposed || !explorer || explorer.picking === picking) return;
    this.update({ explorer: { ...explorer, picking, ...(picking ? {} : { selected: [] }) } });
    countUiEvent(picking ? "ui.tracesift.pick_on" : "ui.tracesift.pick_off");
    if (!picking && explorer.selected?.length) {
      setUiGauge("ui.tracesift.selected_frames", 0);
      countUiEvent("ui.tracesift.pick_clear");
    }
  };

  /** Toggles a frame while picking. */
  toggleSelectedFrame = (nodeId: string) => {
    const explorer = this.state.explorer;
    if (this.disposed || !explorer || !explorer.picking) return;
    const selected = explorer.selected ?? [];
    const next = selected.includes(nodeId) ? selected.filter(id => id !== nodeId) : [...selected, nodeId];
    this.update({ explorer: { ...explorer, selected: next } });
    setUiGauge("ui.tracesift.selected_frames", next.length);
    countUiEvent(next.length > selected.length ? "ui.tracesift.frame_add" : "ui.tracesift.frame_remove");
  };

  clearSelectedFrames = () => {
    const explorer = this.state.explorer;
    if (this.disposed || !explorer || !explorer.selected?.length) return;
    this.update({ explorer: { ...explorer, selected: [] } });
    setUiGauge("ui.tracesift.selected_frames", 0);
    countUiEvent("ui.tracesift.pick_clear");
  };

  /**
   * The hand-off for picked task frames, or why there is none. Split per kind because
   * a CPU profile is sampled and a React one is not.
   */
  private taskSelectionHandoff(payload: unknown, selected: readonly string[], profileTitle?: string) {
    const handoff = payload as { card?: unknown } | null;
    const card = handoff && typeof handoff.card === "object" && handoff.card !== null
      ? handoff.card as SelectionCard
      : undefined;
    if (!card?.tree) return { error: "This task's call tree is not loaded, so its selection cannot be described." };
    const evidence = frameSelectionEvidence(card, selected);
    if (evidence.frames.length === 0) {
      return {
        empty: selected.length
          // None of the picked ids in the tree means the view changed, not that nothing was clicked.
          ? "None of the selected frames are in this task's call tree, so they cannot be described. Reopen Explore and try again."
          : "Nothing is selected yet. Turn on Select frames, then click the frames you want asked about.",
      };
    }
    return { text: buildSelectionPrompt({ card, evidence, ...(profileTitle ? { profileTitle } : {}) }) };
  }

  /** Same, for components picked from a React recording's commits. */
  private reactSelectionHandoff(payload: unknown, selected: readonly string[], profileTitle?: string) {
    const handoff = payload as { explore?: unknown } | null;
    const recording = handoff && typeof handoff.explore === "object" && handoff.explore !== null
      ? handoff.explore as ReactSelectionRecording
      : undefined;
    if (!recording?.commits) return { error: "This recording's commits are not loaded, so its selection cannot be described." };
    const evidence = reactSelectionEvidence(recording, selected);
    if (evidence.components.length === 0) {
      return {
        empty: selected.length
          // Picks name their commit; none matching means the view changed.
          ? "None of the selected components are in this recording's commits, so they cannot be described. Reopen Explore and try again."
          : "Nothing is selected yet. Turn on Select components, then click the components you want asked about.",
      };
    }
    return {
      text: buildReactSelectionPrompt({
        recording,
        evidence,
        ...(profileTitle ? { profileTitle } : {}),
      }),
    };
  }

  /** Asks the chat about the picks. Needs no service call: the picks and tree are already here. */
  investigateSelected = async () => {
    const { analysis, canInvestigate, busyCard, explorer } = this.state;
    if (!analysis || !canInvestigate || busyCard || this.disposed) return;
    const card = analysis.cards.find(entry => entry.id === explorer?.cardId);
    if (!card || !explorer) return;

    this.update({ busyCard: card.id, error: "" });
    // Set once the text is on its way; from then `sendHandoff` counts and captures delivery failures.
    let sending = false;
    try {
      const selected = explorer.selected ?? [];
      const built = explorer.kind === "react"
        ? this.reactSelectionHandoff(explorer.payload, selected, analysis.title)
        : this.taskSelectionHandoff(explorer.payload, selected, analysis.title);
      if ("error" in built) {
        this.update({ error: built.error });
        return;
      }
      if ("empty" in built) {
        countUiEvent("ui.tracesift.pick_investigate_empty");
        this.update({ error: built.empty });
        return;
      }
      sending = true;
      const { noun, rank, name } = this.findingLabel(analysis, card.id);
      await this.sendHandoff(built.text, "ui.tracesift.pick_investigate", card.id, {
        title: `TraceSift · ${noun} ${rank}: ${name}, selected parts`, message: `Investigate the selected parts of this TraceSift ${noun}.`,
      });
    } catch (error) {
      if (!sending) {
        countUiEvent("ui.tracesift.pick_investigate_failed");
        captureUiError(new Error("TraceSift selection handoff failed."), "tracesift.selection");
      }
      this.update({ error: error instanceof Error ? error.message : "Could not describe this selection to the chat." });
    } finally { this.update({ busyCard: undefined }); }
  };

  /** The old path: `tracesift explore` opens the web app in a browser window. */
  openExploreInBrowser = async (cardId: string, focus = "") => {
    const { analysis } = this.state;
    if (!analysis || this.disposed || this.state.openingExploreCard) return;
    const card = analysis.cards.find(entry => entry.id === cardId);
    if (!card) return;
    this.update({ openingExploreCard: cardId, error: "", notice: "" });
    const startedAt = performance.now();
    try {
      const result = await this.app.callServerTool({
        name: "mobile_open_tracesift_explore",
        arguments: analysis.profileType === "cpu"
          ? { analysisId: analysis.analysisId, taskIndex: card.taskIndex, ...(focus ? { focus } : {}) }
          : { analysisId: analysis.analysisId, rootId: card.rootId, commitIndex: card.commitIndex },
      });
      if (result.isError) throw new Error(result.content.filter(item => item.type === "text" && "text" in item).map(item => item.text).join("\n") || "TraceSift could not open this task.");
      if (result.structuredContent?.opened !== true) throw new Error("TraceSift did not confirm that Explore opened.");
      recordUiTiming("ui.tracesift.explore_browser", performance.now() - startedAt);
      countUiEvent("ui.tracesift.explore_browser");
    } catch (error) {
      countUiEvent("ui.tracesift.explore_browser_failed");
      this.update({ error: error instanceof Error ? error.message : "That task could not be opened." });
    } finally { this.update({ openingExploreCard: undefined }); }
  };

  private async requestDisplayMode(mode: "fullscreen" | "inline") {
    try {
      const modes = this.app.getHostContext()?.availableDisplayModes;
      if (modes && !modes.includes(mode)) return;
      await this.app.requestDisplayMode({ mode });
    } catch {
      // Without display modes the explorer stays inline, narrower but usable.
      countUiEvent("ui.tracesift.display_mode_unavailable");
    }
  }

  /** The upload pane's action. A dropped file has no path in a panel frame, so the host's dialog supplies one. */
  pickAndAnalyze = async (profileType: TraceSiftProfileType) => {
    if (this.disposed || this.state.analyzing) return;
    this.update({ error: "", notice: "" });
    const startedAt = performance.now();
    try {
      const result = await this.app.callServerTool({ name: "mobile_pick_profile_file", arguments: {} });
      if (result.isError) throw new Error(result.content.filter(item => item.type === "text").map(item => item.text).join("\n") || "This host could not open a file dialog.");
      recordUiTiming("ui.tracesift.pick", performance.now() - startedAt);
      const picked = result.structuredContent;
      // Cancel leaves the pane as is.
      if (picked?.picked !== true || typeof picked.path !== "string") { countUiEvent("ui.tracesift.pick_cancelled"); return; }
      await this.analyze(picked.path, profileType);
    } catch (error) {
      countUiEvent("ui.tracesift.pick_failed");
      captureUiError(error, "tracesift.pick");
      if (!this.disposed) this.update({ error: error instanceof Error ? error.message : "That profile could not be chosen." });
    }
  };

  loadRecordedProfiles = async () => {
    if (this.disposed) return;
    try {
      const result = await this.app.callServerTool({ name: "mobile_tracesift_recorded_profiles", arguments: {} });
      if (result.isError) throw new Error("Saved profiles could not be listed.");
      const profiles = result.structuredContent?.profiles;
      if (!Array.isArray(profiles) || !profiles.every(profile => typeof profile?.path === "string" && typeof profile?.name === "string" && typeof profile?.recordedAt === "string" && typeof profile?.sizeBytes === "number")) return;
      if (!this.disposed) this.update({ recordedProfiles: profiles });
    } catch {
      // File picking and recording remain available if the local list cannot be read.
    }
  };

  deleteRecordedProfile = async (path: string) => {
    if (this.disposed || this.state.deletingProfile) return;
    this.update({ deletingProfile: path, error: "" });
    try {
      const result = await this.app.callServerTool({ name: "mobile_tracesift_delete_recorded_profile", arguments: { path } });
      if (result.isError || result.structuredContent?.deleted !== true) throw new Error("Saved profile could not be deleted.");
      if (!this.disposed) this.update({ recordedProfiles: this.state.recordedProfiles.filter(profile => profile.path !== path) });
    } catch (error) {
      captureUiError(error, "tracesift.delete_recording");
      if (!this.disposed) this.update({ error: error instanceof Error ? error.message : "Saved profile could not be deleted." });
    } finally {
      if (!this.disposed) this.update({ deletingProfile: undefined });
    }
  };

  /** Preflight the local service before the upload pane asks the user for a profile. */
  checkReadiness = async () => {
    if (this.disposed || this.state.checkingReadiness) return;
    const token = ++this.readinessToken;
    this.update({ checkingReadiness: true, error: "" });
    const startedAt = performance.now();
    try {
      const result = await this.app.callServerTool({ name: "mobile_tracesift_status", arguments: {} });
      if (this.disposed || token !== this.readinessToken) return;
      recordUiTiming("ui.tracesift.readiness", performance.now() - startedAt);
      if (result.isError) throw new Error(result.content.filter(item => item.type === "text").map(item => item.text).join("\n") || "TraceSift readiness could not be checked.");
      const parsed = traceSiftReadinessSchema.safeParse(result.structuredContent);
      if (!parsed.success) throw new Error("TraceSift returned an invalid readiness result.");
      countUiEvent(parsed.data.status === "ready" ? "ui.tracesift.readiness_ready" : "ui.tracesift.readiness_setup_required");
      this.update({ readiness: parsed.data });
    } catch (error) {
      if (this.disposed || token !== this.readinessToken) return;
      countUiEvent("ui.tracesift.readiness_failed");
      captureUiError(error, "tracesift.readiness");
      this.update({
        readiness: {
          apiVersion: 1, status: "setup_required", reason: "startup_failed",
          message: error instanceof Error ? error.message : "TraceSift readiness could not be checked.",
        },
      });
    } finally {
      if (!this.disposed && token === this.readinessToken) this.update({ checkingReadiness: false });
    }
  };

  /** Run one fixed setup command from its explicit panel button, then re-check the service. */
  runSetup = async (action: TraceSiftSetupAction) => {
    if (this.disposed || this.state.setupAction || this.state.checkingReadiness) return;
    this.update({ setupAction: action, setupNotice: "", error: "" });
    const startedAt = performance.now();
    try {
      const result = await this.app.callServerTool({
        name: action === "install" ? "mobile_install_tracesift_cli" : "mobile_initialize_tracesift",
        arguments: {},
      });
      recordUiTiming(`ui.tracesift.${action}`, performance.now() - startedAt);
      if (result.isError) throw new Error(result.content.filter(item => item.type === "text").map(item => item.text).join("\n") || `TraceSift ${action} failed.`);
      const parsed = traceSiftSetupActionResultSchema.safeParse(result.structuredContent);
      if (!parsed.success || parsed.data.action !== action) throw new Error("TraceSift returned an invalid setup result.");
      countUiEvent(`ui.tracesift.${action}_success`);
      this.update({ setupAction: undefined, setupNotice: parsed.data.message });
      await this.checkReadiness();
      if (!this.disposed && this.state.readiness?.status === "ready") this.update({ setupNotice: "" });
    } catch (error) {
      countUiEvent(`ui.tracesift.${action}_failed`);
      // Command output is useful in the local panel but must not become telemetry.
      captureUiError(new Error(`TraceSift ${action} action failed.`), `tracesift.${action}`);
      if (!this.disposed) this.update({
        setupAction: undefined,
        error: error instanceof Error ? error.message : `TraceSift ${action} failed. Run the command in a terminal instead.`,
      });
    }
  };

  /** Analyze one profile by path. `accept` installs the cards this returns. */
  analyze = async (path: string, profileType: TraceSiftProfileType) => {
    if (this.disposed || this.state.analyzing) return;
    const name = path.split(/[\\/]/).pop() || path;
    this.inputKey = JSON.stringify({ path, profileType });
    this.update({ analyzing: { name, profileType }, error: "", notice: "" });
    const startedAt = performance.now();
    try {
      const result = await this.app.callServerTool({ name: "mobile_analyze_profile", arguments: { path, profileType } });
      if (this.disposed) return;
      recordUiTiming("ui.tracesift.analyze", performance.now() - startedAt);
      if (result.isError) throw new Error(result.content.filter(item => item.type === "text").map(item => item.text).join("\n") || "TraceSift could not analyze this profile.");
      countUiEvent("ui.tracesift.analyze");
      this.accept(result);
    } catch (error) {
      countUiEvent("ui.tracesift.analyze_failed");
      captureUiError(error, "tracesift.analyze");
      if (!this.disposed) this.update({ error: error instanceof Error ? error.message : "TraceSift could not analyze this profile." });
    } finally { this.update({ analyzing: undefined }); }
  };

  private captureUpdate(next: Partial<State["capture"]>) {
    this.update({ capture: { ...this.state.capture, ...next } });
  }

  /** One capture tool call, with the panel's own wording when the tool says nothing. */
  private async captureTool(name: string, args: Record<string, unknown>, fallback: string) {
    const result = await this.app.callServerTool({ name, arguments: args });
    if (result.isError) throw new Error(result.content.filter(item => item.type === "text").map(item => item.text).join("\n") || fallback);
    return result.structuredContent;
  }

  setCaptureUrl = (url: string) => { this.captureUpdate({ url, error: "" }); };

  /**
   * Pick the recording back up where it actually is.
   *
   * The browser and the recording outlive this panel — they belong to Chrome
   * and to a detached recorder — so a reopened panel asks the recorder rather
   * than assuming it starts at `idle`. Only a React Native recording carries a
   * target label, so that is what tells the panel which source is live.
   */
  loadCapture = async () => {
    try {
      const state = traceSiftCaptureSchema.safeParse(await this.captureTool("mobile_tracesift_capture_state", {}, "TraceSift could not report the recording."));
      if (this.disposed || !state.success) return;
      const step = state.data.recording ? "recording" as const : state.data.browser ? "launched" as const : "idle" as const;
      this.captureUpdate({
        step, url: state.data.browser?.url || this.state.capture.url,
        ...(state.data.app ? { source: "rn" as const } : state.data.browser ? { source: "chrome" as const } : {}),
      });
      if (step !== "idle") countUiEvent("ui.tracesift.capture_resumed");
    } catch (error) {
      // Nothing is on screen yet that depends on this, so a host without the
      // capture tools simply shows the control at rest.
      captureUiError(error, "tracesift.capture");
    }
    // Asked once on open and again only when the person presses Refresh: an
    // app that reconnects to Metro later is a press away, not worth a timer
    // spawning a subprocess behind a panel nobody is looking at.
    await this.loadReactNativeTargets();
  };

  setCaptureSource = (source: TraceSiftCaptureSource) => {
    if (this.state.capture.source === source) return;
    this.captureUpdate({ source, error: "" });
  };

  /** The React Native apps that can be recorded, over either route, and which of them Start would record. */
  loadReactNativeTargets = async () => {
    if (this.disposed || this.state.capture.loadingTargets) return;
    this.captureUpdate({ loadingTargets: true, targetsError: "" });
    const startedAt = performance.now();
    try {
      const listed = traceSiftRnTargetsSchema.safeParse(
        await this.captureTool("mobile_tracesift_list_react_native_targets", {}, "TraceSift could not list the React Native apps."));
      if (this.disposed) return;
      if (!listed.success) throw new Error("TraceSift returned an invalid React Native target list.");
      recordUiTiming("ui.tracesift.capture_rn_targets", performance.now() - startedAt);
      const { targets, metro } = listed.data;
      // Keep the person's own choice when the app they picked is still there;
      // otherwise fall in behind the one the CLI would pick on its own.
      const kept = targets.some(target => target.id === this.state.capture.targetId) ? this.state.capture.targetId : "";
      this.captureUpdate({ targets, metro, targetsError: "", targetId: kept || targets.find(target => target.recommended)?.id || targets[0]?.id || "" });
    } catch (error) {
      countUiEvent("ui.tracesift.capture_rn_targets_failed");
      captureUiError(error, "tracesift.capture");
      if (!this.disposed) this.captureUpdate({ targets: [], targetsError: error instanceof Error ? error.message : "TraceSift could not list the React Native apps." });
    } finally { if (!this.disposed) this.captureUpdate({ loadingTargets: false }); }
  };

  setCaptureTarget = (targetId: string) => { this.captureUpdate({ targetId, error: "" }); };

  /**
   * Record the React Native app that is already running.
   *
   * One press, not two: nothing is launched and no window opens, so there is
   * no signed-in state to reach first the way there is in a browser.
   */
  startReactNativeCapture = async () => {
    if (this.disposed || this.state.capture.step !== "idle" || this.state.capture.source !== "rn") return;
    if (!this.state.capture.targets.length) {
      this.captureUpdate({ error: "No React Native app found, over Metro or from a profiling build. Start the app, then refresh." });
      return;
    }
    const { targetId } = this.state.capture;
    this.captureUpdate({ source: "rn", step: "starting", error: "" });
    const startedAt = performance.now();
    try {
      await this.captureTool("mobile_tracesift_record_react_native", targetId ? { targetId } : {}, "TraceSift could not start recording.");
      if (this.disposed) return;
      recordUiTiming("ui.tracesift.capture_rn_start", performance.now() - startedAt);
      countUiEvent("ui.tracesift.capture_rn_start");
      this.captureUpdate({ step: "recording" });
    } catch (error) {
      countUiEvent("ui.tracesift.capture_rn_start_failed");
      captureUiError(error, "tracesift.capture");
      if (!this.disposed) this.captureUpdate({ step: "idle", error: error instanceof Error ? error.message : "TraceSift could not start recording." });
    }
  };

  private runUpdate(next: Partial<RunState>) { this.update({ run: { ...this.state.run, ...next } }); }

  /** The folder the server saved last time, so the picker opens on it. */
  loadRunProject = async () => {
    try {
      const path = (await this.captureTool("mobile_get_tracesift_project", {}, "The saved project could not be read.") as { path?: unknown } | undefined)?.path;
      if (this.disposed || typeof path !== "string" || this.state.run.projectPath) return;
      this.runUpdate({ projectPath: path });
    } catch (error) { captureUiError(error, "tracesift.run"); }
  };

  /** Open the popup. A project that is already chosen is checked at once, so the person only ever sees what is left to do. */
  openRun = async () => {
    if (this.disposed || this.state.run.building) return;
    this.runUpdate({ open: true, error: "", notice: "" });
    if (!this.state.run.projectPath) await this.loadRunProject();
    if (this.state.run.projectPath) await this.checkRun();
  };

  closeRun = () => { if (!this.state.run.building) this.runUpdate({ open: false }); };

  /** The host's folder dialog; the choice is saved server-side, which is also where recording reads its working directory. */
  pickRunProject = async () => {
    if (this.disposed || this.state.run.pickingProject || this.state.run.building) return;
    this.runUpdate({ pickingProject: true, error: "" });
    try {
      const picked = await this.captureTool("mobile_pick_tracesift_project", {}, "This host could not open a folder dialog.") as { picked?: unknown; path?: unknown } | undefined;
      if (this.disposed) return;
      if (picked?.picked !== true || typeof picked.path !== "string") { countUiEvent("ui.tracesift.run_project_cancelled"); return; }
      this.runUpdate({ projectPath: picked.path, setup: undefined, targets: [] });
      await this.checkRun();
    } catch (error) {
      captureUiError(error, "tracesift.run");
      if (!this.disposed) this.runUpdate({ error: error instanceof Error ? error.message : "That project could not be chosen." });
    } finally { if (!this.disposed) this.runUpdate({ pickingProject: false }); }
  };

  /** Is the profiler installed, and where can a build go. Both are reads. */
  checkRun = async () => {
    const { projectPath } = this.state.run;
    if (this.disposed || !projectPath || this.state.run.checking) return;
    this.runUpdate({ checking: true, error: "" });
    const startedAt = performance.now();
    try {
      const setup = await this.captureTool("mobile_tracesift_profiler_setup", { projectPath }, "The project could not be checked.") as { installed?: unknown; command?: unknown; platforms?: unknown } | undefined;
      if (this.disposed || projectPath !== this.state.run.projectPath) return;
      if (typeof setup?.installed !== "boolean" || typeof setup.command !== "string" || !Array.isArray(setup.platforms)) throw new Error("TraceSift returned an invalid project check.");
      const platforms = setup.platforms.filter((value): value is "ios" | "android" => value === "ios" || value === "android");
      this.runUpdate({ setup: { installed: setup.installed, command: setup.command, platforms } });
      if (setup.installed) await this.loadRunTargets(platforms);
      recordUiTiming("ui.tracesift.run_check", performance.now() - startedAt);
    } catch (error) {
      countUiEvent("ui.tracesift.run_check_failed");
      captureUiError(error, "tracesift.run");
      if (!this.disposed) this.runUpdate({ setup: undefined, targets: [], error: error instanceof Error ? error.message : "The project could not be checked." });
    } finally { if (!this.disposed) this.runUpdate({ checking: false }); }
  };

  private async loadRunTargets(platforms: ("ios" | "android")[]) {
    const targets: TraceSiftRunTarget[] = [];
    let listError = "";
    // One listing covers both platforms: a phone the developer has plugged in
    // should appear by name whichever one it is, and the popup shows them in
    // a single list.
    try {
      const listed = await this.captureTool("mobile_tracesift_profile_devices", {}, "The targets could not be listed.") as { devices?: unknown } | undefined;
      for (const entry of Array.isArray(listed?.devices) ? listed.devices : []) {
        const device = entry as { kind?: unknown; id?: unknown; name?: unknown; note?: unknown };
        if (typeof device.id !== "string" || typeof device.name !== "string") continue;
        const note = typeof device.note === "string" ? device.note : "";
        if ((device.kind === "device" || device.kind === "simulator") && platforms.includes("ios")) {
          targets.push({ platform: "ios", kind: device.kind, id: device.id, name: device.name, note });
        } else if (device.kind === "android" && platforms.includes("android")) {
          targets.push({ platform: "android", kind: "android", id: device.id, name: device.name, note });
        }
      }
    } catch (error) { listError = error instanceof Error ? error.message : "The targets could not be listed."; }
    // Still offer Android when adb listed nothing, so a device attached after
    // this check can be built for without reopening the popup; adb picks the
    // one it sees and says so itself if there is none.
    if (platforms.includes("android") && !targets.some((target) => target.platform === "android")) {
      targets.push({ platform: "android", kind: "android", name: "Android emulator or device", note: "none attached yet — the one adb sees" });
    }
    if (!this.disposed) this.runUpdate({ targets, ...(listError ? { error: listError } : {}) });
  }

  /** Add the package with the project's own package manager: the command the popup shows beside its run button. */
  installRunProfiler = async () => {
    const { projectPath, setup } = this.state.run;
    if (this.disposed || !projectPath || !setup || this.state.run.installing) return;
    this.runUpdate({ installing: true, error: "" });
    const startedAt = performance.now();
    try {
      await this.captureTool("mobile_tracesift_install_profiler", { projectPath }, "The profiler package could not be installed.");
      if (this.disposed) return;
      recordUiTiming("ui.tracesift.run_install", performance.now() - startedAt);
      countUiEvent("ui.tracesift.run_install");
      this.runUpdate({ installing: false });
      await this.checkRun();
    } catch (error) {
      countUiEvent("ui.tracesift.run_install_failed");
      // Command output is useful in the local panel but must not become telemetry.
      captureUiError(new Error("TraceSift profiler install failed."), "tracesift.run");
      if (!this.disposed) this.runUpdate({ installing: false, error: error instanceof Error ? error.message : "The install failed. Run the command in a terminal instead." });
    }
  };

  /** Give a newly launched app a short window to connect to the recorder. */
  private refreshAfterBuild = async (generation: number, attempt = 0) => {
    if (this.disposed || generation !== this.reconnectGeneration) return;
    await this.loadReactNativeTargets();
    if (this.disposed || generation !== this.reconnectGeneration || this.state.capture.targets.length || attempt >= 6) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.refreshAfterBuild(generation, attempt + 1);
    }, 2000);
  };

  /** Build, install and launch for one target, then look for the app as it connects. */
  buildForTarget = async (target: TraceSiftRunTarget) => {
    const { projectPath } = this.state.run;
    if (this.disposed || !projectPath || this.state.run.building) return;
    if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer);
    const generation = ++this.reconnectGeneration;
    this.runUpdate({ open: false, building: target, error: "", notice: "" });
    this.buildStartedAt = performance.now();
    try {
      const result = await this.captureTool("mobile_tracesift_profile_build",
        { projectPath, platform: target.platform, ...(target.id ? { device: target.id } : {}) }, "The profiling build could not start.") as { runId?: unknown } | undefined;
      if (this.disposed) return;
      if (typeof result?.runId !== "string") throw new Error("TraceSift did not return a build ID.");
      this.buildRunId = result.runId;
      void this.pollBuild(generation);
    } catch (error) {
      countUiEvent("ui.tracesift.run_build_failed");
      captureUiError(new Error("TraceSift profiling build failed."), "tracesift.run");
      if (!this.disposed) this.runUpdate({ building: undefined, error: error instanceof Error ? error.message : "The profiling build failed." });
    }
  };

  private pollBuild = async (generation: number) => {
    if (this.disposed || generation !== this.reconnectGeneration || !this.buildRunId) return;
    try {
      const result = await this.captureTool("mobile_tracesift_profile_build_status", { runId: this.buildRunId }, "The build status could not be read.") as { status?: unknown; error?: unknown } | undefined;
      if (this.disposed || generation !== this.reconnectGeneration) return;
      if (result?.status === "running") {
        this.buildPollTimer = setTimeout(() => { void this.pollBuild(generation); }, 2000);
        return;
      }
      if (result?.status === "failed" || result?.status === "idle") {
        this.buildRunId = undefined;
        countUiEvent("ui.tracesift.run_build_failed");
        captureUiError(new Error("TraceSift profiling build failed."), "tracesift.run");
        this.runUpdate({ building: undefined, error: typeof result.error === "string" ? result.error : "The profiling build ended without launching the app." });
        return;
      }
      if (result?.status !== "completed") throw new Error("TraceSift returned an invalid build status.");
      this.buildRunId = undefined;
      recordUiTiming("ui.tracesift.run_build", performance.now() - this.buildStartedAt);
      countUiEvent("ui.tracesift.run_build");
      const target = this.state.run.building;
      this.runUpdate({ building: undefined, notice: `Launched on ${target?.name ?? "the device"}. Use the app, then press Start profile when it appears below.`, error: "" });
      void this.refreshAfterBuild(generation);
    } catch (error) {
      if (this.disposed || generation !== this.reconnectGeneration) return;
      // A transient status request should not claim the app failed to launch.
      this.buildPollTimer = setTimeout(() => { void this.pollBuild(generation); }, 4000);
      this.runUpdate({ error: error instanceof Error ? error.message : "The build status could not be read." });
    }
  };

  /** Open the address in a Chrome that stays open, so a person can sign in before recording. */
  launchCapture = async () => {
    if (this.disposed || this.state.capture.step !== "idle") return;
    const url = this.state.capture.url.trim();
    if (!traceSiftCaptureUrlSchema.safeParse(url).success) {
      this.captureUpdate({ error: "Enter an http:// or https:// address." });
      return;
    }
    // The action settles the source, not the chip: whatever the panel was
    // showing, this recording is Chrome's, and stopping it must know that.
    this.captureUpdate({ source: "chrome", step: "launching", error: "" });
    const startedAt = performance.now();
    try {
      await this.captureTool("mobile_tracesift_launch_browser", { url }, "TraceSift could not open a browser.");
      if (this.disposed) return;
      recordUiTiming("ui.tracesift.capture_launch", performance.now() - startedAt);
      countUiEvent("ui.tracesift.capture_launch");
      this.captureUpdate({ step: "launched" });
    } catch (error) {
      countUiEvent("ui.tracesift.capture_launch_failed");
      captureUiError(error, "tracesift.capture");
      if (!this.disposed) this.captureUpdate({ step: "idle", error: error instanceof Error ? error.message : "TraceSift could not open a browser." });
    }
  };

  startCapture = async () => {
    if (this.disposed || this.state.capture.step !== "launched") return;
    this.captureUpdate({ step: "starting", error: "" });
    const startedAt = performance.now();
    try {
      await this.captureTool("mobile_tracesift_start_recording", {}, "TraceSift could not start recording.");
      if (this.disposed) return;
      recordUiTiming("ui.tracesift.capture_start", performance.now() - startedAt);
      countUiEvent("ui.tracesift.capture_start");
      this.captureUpdate({ step: "recording" });
    } catch (error) {
      countUiEvent("ui.tracesift.capture_start_failed");
      captureUiError(error, "tracesift.capture");
      if (!this.disposed) this.captureUpdate({ step: "launched", error: error instanceof Error ? error.message : "TraceSift could not start recording." });
    }
  };

  /**
   * End the recording and read what it wrote.
   *
   * The browser is left open on purpose: the sign-in it holds is the expensive
   * part, and the next recording should not have to repeat it.
   */
  stopCapture = async () => {
    if (this.disposed || this.state.capture.step !== "recording") return;
    this.captureUpdate({ step: "stopping", error: "" });
    const startedAt = performance.now();
    let path: string | undefined;
    try {
      const capture = traceSiftCaptureSchema.shape.capture.unwrap()
        .safeParse(await this.captureTool("mobile_tracesift_stop_recording", {}, "TraceSift could not stop the recording."));
      if (this.disposed) return;
      if (!capture.success) throw new Error("TraceSift returned an invalid recording result.");
      recordUiTiming("ui.tracesift.capture_stop", performance.now() - startedAt);
      countUiEvent("ui.tracesift.capture_stop");
      path = capture.data.path;
      // Chrome keeps the browser, and with it the sign-in worth reusing. React
      // Native launched nothing, so there is nothing to return to.
      this.captureUpdate({ step: this.state.capture.source === "rn" ? "idle" : "launched" });
    } catch (error) {
      countUiEvent("ui.tracesift.capture_stop_failed");
      captureUiError(error, "tracesift.capture");
      if (!this.disposed) this.captureUpdate({ step: "recording", error: error instanceof Error ? error.message : "TraceSift could not stop the recording." });
      return;
    }
    // A trace is only worth recording for the cards it becomes, so the reading
    // follows the stop without a second press.
    await this.loadRecordedProfiles();
    await this.analyze(path, "cpu");
  };

  closeCapture = async () => {
    if (this.disposed || this.state.capture.step !== "launched") return;
    this.captureUpdate({ step: "closing", error: "" });
    try {
      await this.captureTool("mobile_tracesift_close_browser", {}, "TraceSift could not close the browser.");
      if (this.disposed) return;
      countUiEvent("ui.tracesift.capture_close");
      this.captureUpdate({ step: "idle" });
    } catch (error) {
      countUiEvent("ui.tracesift.capture_close_failed");
      captureUiError(error, "tracesift.capture");
      if (!this.disposed) this.captureUpdate({ step: "launched", error: error instanceof Error ? error.message : "TraceSift could not close the browser." });
    }
  };

  /**
   * Start readiness again from now. The inline card's frame opens with its
   * analysis, but the tool's frame is the whole workspace: timing a reading from
   * when that loaded would report a session's age as this surface's readiness.
   */
  restartReadiness = () => { this.readyAt = performance.now(); };

  /** Back to the upload pane, dropping the reading and its megabytes of tree. */
  reset = () => {
    if (this.disposed || (!this.state.analysis && !this.state.explorer)) return;
    if (this.state.explorer) this.closeExplore();
    this.inputKey = undefined;
    this.update({ analysis: undefined, error: "", notice: "", copiedCard: undefined, openingExploreCard: undefined });
    setUiGauge("ui.tracesift.cards", 0);
    // Clear the profile kind so later measurements are not attributed to the previous reading.
    setUiTelemetryContext({ tracesift_view: "upload", tracesift_profile: "none" });
    countUiEvent("ui.tracesift.reset");
  };

  dispose() {
    this.disposed = true;
    if (this.copiedTimer !== undefined) clearTimeout(this.copiedTimer);
    if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer);
    if (this.buildPollTimer !== undefined) clearTimeout(this.buildPollTimer);
    this.listeners.clear();
  }
}
