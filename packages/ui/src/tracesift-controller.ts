import type { App } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { OpenAIMessageParams } from "@openai/mcp-extensions/app";
import { traceSiftAnalysisSchema, traceSiftHandoffSchema, traceSiftRestoreSchema, type TraceSiftAnalysis, type TraceSiftProfileType } from "@mobile-dev/shared/tracesift.ts";
import { decodeTraceSiftExplorePayload, TRACE_SIFT_PAYLOAD_MAX_BYTES, traceSiftExploreEnvelopeSchema, TRACE_SIFT_PAYLOAD_TOO_LARGE, traceSiftPayloadRefused, type TraceSiftExploreKind } from "@mobile-dev/shared/tracesift-explore.ts";
import { buildSelectionPrompt, frameSelectionEvidence, type SelectionCard } from "@mobile-dev/shared/tracesift-selection.ts";
import { buildReactSelectionPrompt, reactSelectionEvidence, type ReactSelectionRecording } from "@mobile-dev/shared/tracesift-react-selection.ts";
import type { ContributionChartKind } from "./components/tracesift/contribution-chart.tsx";
import { captureUiError, countUiEvent, markUiSurfaceReady, recordUiTiming, setUiGauge, setUiSurface, setUiTelemetryContext } from "./telemetry.ts";

type State = {
  analysis?: TraceSiftAnalysis;
  canInvestigate: boolean;
  /** The host's theme, which TraceSift's components take from a class, not the document attribute. */
  dark: boolean;
  busyCard?: string;
  error: string;
  /** Said when a finding was handed to the browser window instead of this panel. */
  notice: string;
  /**
   * The source folder an investigation lands in. Without one there is nothing to
   * tell the chat which code a frame belongs to, so Investigate waits for it.
   */
  project?: string;
  /** True while the saved folder is being read or its dialog is open. */
  projectBusy: boolean;
  /**
   * The profile the panel's upload pane is waiting on, named by its file so the
   * pane can say which one. Absent in the inline card, where the model analyzes.
   */
  analyzing?: { name: string; profileType: TraceSiftProfileType };
  /** Which drawing every card on this analysis carries; one switch, as on the web. */
  chartKind: ContributionChartKind;
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
    /**
     * Whether a click picks a frame rather than navigating to it. Held here so
     * the bar can show the count, and so returning drops a half-built set.
     */
    picking?: boolean;
    /**
     * The frames or components picked, in order. A task frame is a
     * `TaskTreeNode.id`, a React one `<rootId>.<commitIndex>.<fiberId>`.
     */
    selected?: string[];
  };
};

function composerUnavailable(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:no (?:active |available )?composer|composer.*(?:unavailable|not available|not active)|requires? an (?:active|available) composer|MCP app messages are disabled for this view)/i.test(message);
}

export class TraceSiftController {
  private state: State = { canInvestigate: false, dark: false, error: "", notice: "", chartKind: "bar", projectBusy: false };
  private listeners = new Set<() => void>();
  private disposed = false;
  private readyAt = performance.now();
  /** When the current explorer's payload arrived, so its own readiness can be timed. */
  private explorerReadyAt = 0;
  private readonly app: App;
  private viewId?: string | number;
  private inputKey?: string;
  private copiedTimer?: ReturnType<typeof setTimeout>;
  /** Serializes `mobile_remember_tracesift_analysis` calls so out-of-order completions cannot write a stale analysis over a newer one. */
  private rememberChain: Promise<void> = Promise.resolve();
  /** Bumped by every restore attempt; a response only applies while it still matches the latest one requested. */
  private restoreToken = 0;
  constructor(app: App) { this.app = app; }

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
    // TraceSift's components read their theme from a `.dark` ancestor, not the
    // document attribute the rest of this frame uses.
    this.update({
      canInvestigate: Boolean(capabilities?.serverTools && capabilities?.message?.text),
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
    this.update({ analysis, error: "", busyCard: undefined, copiedCard: undefined, handoffCard: undefined, openingExploreCard: undefined, explorer: undefined });
    // Which kind of recording is open, so a CPU call tree and a React commit set
    // are told apart. Setting it flushes the last context's measurements.
    setUiTelemetryContext({ tracesift_view: "cards", tracesift_profile: analysis.profileType });
    // A new analysis drops the explorer and its picks. The gauge follows the
    // state, not the navigation: `tracesift_view` does not change here, so
    // nothing else would clear the last reading's count.
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
    // Chained rather than run in parallel: two registrations racing could let an
    // earlier call's completion overwrite a later one's write to the view reference.
    this.rememberChain = this.rememberChain.then(run);
    return this.rememberChain;
  };
  restore = async (viewId: string | number) => {
    if (this.disposed || this.state.analysis) return;
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
    if (this.disposed || this.state.analysis) return;
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
  /**
   * Where the chat should look. A profile names frames, not files, so without the
   * folder the reader picked the agent has only a stack to go on.
   */
  private inProject(handoff: string, project: string) {
    return `Investigate this in the project at ${project}.\n\n${handoff}`;
  }

  /**
   * One hand-off to the active chat. A timeout is not a failure to retry: the
   * message may well have landed, and sending twice reads as two findings.
   */
  private async sendHandoff(text: string, event: string) {
    let sending = false;
    try {
      const message: OpenAIMessageParams = { role: "user", content: [{ type: "text", text }], _meta: { "openai/message": { target: "active", send: true } } };
      const sendStartedAt = performance.now();
      sending = true;
      const sent = await this.app.sendMessage(message, { timeout: 5000, maxTotalTimeout: 5000 });
      if (sent.isError) throw new Error("Codex could not start this investigation.");
      recordUiTiming("ui.tracesift.message_ack", performance.now() - sendStartedAt);
      countUiEvent(event);
    } catch (error) {
      const timedOut = sending && typeof error === "object" && error !== null && "code" in error && error.code === -32001;
      const missingComposer = sending && composerUnavailable(error);
      countUiEvent(timedOut ? "ui.tracesift.delivery_unconfirmed" : missingComposer ? "ui.tracesift.composer_unavailable" : "ui.tracesift.send_failed");
      if (!timedOut && !missingComposer) captureUiError(new Error("TraceSift investigation action failed."), "tracesift.investigate");
      throw new Error(timedOut
        ? "Codex did not confirm delivery. Check the chat before retrying to avoid sending the investigation twice."
        : missingComposer
          ? "Codex could not find this chat's input. Reopen the chat, then try Investigate again."
          : error instanceof Error ? error.message : "Could not start this investigation.",
        { cause: error });
    }
  }

  investigate = async (cardId: string) => {
    const { analysis, canInvestigate, busyCard, project } = this.state;
    if (!analysis || !canInvestigate || !project || busyCard || this.disposed || !analysis.cards.some(card => card.id === cardId)) return;
    this.update({ busyCard: cardId, error: "" });
    try {
      // Fetching the hand-off and delivering it fail differently: the service
      // versus the host's composer.
      let handoff: string;
      try { handoff = await this.handoff(cardId); }
      catch (error) {
        countUiEvent("ui.tracesift.handoff_failed");
        throw error;
      }
      await this.sendHandoff(this.inProject(handoff, project), "ui.tracesift.investigate");
    } catch (error) {
      this.update({ error: error instanceof Error ? error.message : "Could not start this investigation." });
    } finally { this.update({ busyCard: undefined }); }
  };
  setChartKind = (chartKind: ContributionChartKind) => { this.update({ chartKind }); };

  /** The card's hand-off on the clipboard — the same text Investigate sends. */
  copyHandoff = async (cardId: string) => {
    if (this.state.handoffCard || this.disposed) return;
    this.update({ handoffCard: cardId, copiedCard: undefined, error: "" });
    try {
      const handoff = await this.handoff(cardId);
      const { project } = this.state;
      await navigator.clipboard.writeText(project ? this.inProject(handoff, project) : handoff);
      countUiEvent("ui.tracesift.copy_handoff");
      this.update({ copiedCard: cardId });
      this.copiedTimer = setTimeout(() => this.update({ copiedCard: undefined }), 2000);
    } catch (error) {
      countUiEvent("ui.tracesift.copy_failed");
      this.update({ error: error instanceof Error ? error.message : "That hand-off could not be copied." });
    } finally { this.update({ handoffCard: undefined }); }
  };

  /**
   * Open the full explorer for one card. The chart band carries the node to
   * focus; the tree arrives over MCP, and the button stays busy while it does.
   */
  openExplore = async (cardId: string, focus = "") => {
    const { analysis } = this.state;
    if (!analysis || this.disposed || this.state.openingExploreCard || this.state.explorer) return;
    const card = analysis.cards.find(entry => entry.id === cardId);
    if (!card) return;
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
      // Megabytes take a while, and `accept` may have replaced the analysis
      // meanwhile. Installing this payload then would show the new reading a
      // card id it does not have, holding the old tree behind an error.
      if (this.disposed || this.state.analysis?.analysisId !== analysis.analysisId) {
        this.update({ openingExploreCard: undefined });
        return;
      }
      const kind: TraceSiftExploreKind = envelope.data.kind;
      // The context names the work: switched before the timings are recorded, so
      // the fetch is attributed to the explorer rather than flushed to the cards.
      setUiTelemetryContext({ tracesift_view: "explorer" });
      recordUiTiming("ui.tracesift.payload", performance.now() - startedAt);
      setUiGauge("ui.tracesift.payload_bytes", envelope.data.payloadBytes);
      this.explorerReadyAt = startedAt;
      // A wide view is the explorer's own shape; the cards stay inline. The host
      // decides, and the explorer is usable inline if it declines.
      void this.requestDisplayMode("fullscreen");
      this.update({
        openingExploreCard: undefined,
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
      // A finding too big for the bridge is not a failure the reader has to act
      // on: the browser window renders the same data without crossing one, so
      // Explore takes them there and says where it went.
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

  /** The cards list again. The payload is dropped: it is megabytes with no reason to sit held. */
  closeExplore = () => {
    if (this.disposed || !this.state.explorer) return;
    this.update({ explorer: undefined });
    // The cards are an inline surface; opening the explorer asked for fullscreen,
    // so returning has to hand the width back.
    void this.requestDisplayMode("inline");
    setUiTelemetryContext({ tracesift_view: "cards" });
    // A picked set belongs to the reading that built it. Left standing, the last
    // count would keep being reported against the card list that replaced it.
    setUiGauge("ui.tracesift.selected_frames", 0);
  };

  /** The node drilled into, held here so reopening does not resurrect an old focus. */
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

  /**
   * Switch between picking frames and navigating them. Turning it off empties the
   * set, so picks never linger behind an affordance the reader has dismissed.
   */
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

  /** A frame clicked while picking; a second click on it takes it back out. */
  toggleSelectedFrame = (nodeId: string) => {
    const explorer = this.state.explorer;
    if (this.disposed || !explorer || !explorer.picking) return;
    const selected = explorer.selected ?? [];
    const next = selected.includes(nodeId) ? selected.filter(id => id !== nodeId) : [...selected, nodeId];
    this.update({ explorer: { ...explorer, selected: next } });
    setUiGauge("ui.tracesift.selected_frames", next.length);
    countUiEvent(next.length > selected.length ? "ui.tracesift.frame_add" : "ui.tracesift.frame_remove");
  };

  /** Empty the set without leaving picking mode, which is what the button beside it says. */
  clearSelectedFrames = () => {
    const explorer = this.state.explorer;
    if (this.disposed || !explorer || !explorer.selected?.length) return;
    this.update({ explorer: { ...explorer, selected: [] } });
    setUiGauge("ui.tracesift.selected_frames", 0);
    countUiEvent("ui.tracesift.pick_clear");
  };

  /**
   * The hand-off for picked task frames, or why there is none. Split per kind: a
   * CPU profile is sampled and a React one is not.
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
          // A tree holding none of the picked ids stopped matching what is on
          // screen — not the same as nothing having been clicked yet.
          ? "None of the selected frames are in this task's call tree, so they cannot be described. Reopen Explore and try again."
          : "Nothing is selected yet. Turn on Select frames, then click the frames you want asked about.",
      };
    }
    return { text: buildSelectionPrompt({ card, evidence, ...(profileTitle ? { profileTitle } : {}) }) };
  }

  /** The same, for components picked out of a React recording's commits. */
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
          // A pick names its commit, so a recording holding none of them stopped
          // matching the view the reader clicked in.
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

  /**
   * Ask the chat about the picks. Unlike Investigate this needs no service call:
   * the picks and the whole tree are already in this frame.
   */
  investigateSelected = async () => {
    const { analysis, canInvestigate, busyCard, explorer, project } = this.state;
    if (!analysis || !canInvestigate || !project || busyCard || this.disposed) return;
    const card = analysis.cards.find(entry => entry.id === explorer?.cardId);
    if (!card || !explorer) return;

    this.update({ busyCard: card.id, error: "" });
    // Set once the text is on its way: `sendHandoff` already counts and captures
    // delivery failures, and tells a timeout from a missing composer.
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
      await this.sendHandoff(this.inProject(built.text, project), "ui.tracesift.pick_investigate");
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
      // A host without display modes keeps the explorer inline, which is a
      // narrower reading of the same data, not a broken one.
      countUiEvent("ui.tracesift.display_mode_unavailable");
    }
  }

  /**
   * The upload pane's one action. A panel frame never learns a dropped file's
   * path, so the host's own dialog supplies one and the analysis follows it.
   */
  pickAndAnalyze = async (profileType: TraceSiftProfileType) => {
    if (this.disposed || this.state.analyzing) return;
    this.update({ error: "", notice: "" });
    const startedAt = performance.now();
    try {
      const result = await this.app.callServerTool({ name: "mobile_pick_profile_file", arguments: {} });
      if (result.isError) throw new Error(result.content.filter(item => item.type === "text").map(item => item.text).join("\n") || "This host could not open a file dialog.");
      recordUiTiming("ui.tracesift.pick", performance.now() - startedAt);
      const picked = result.structuredContent;
      // Cancel is the ordinary way out of a dialog, so the pane simply stays put.
      if (picked?.picked !== true || typeof picked.path !== "string") { countUiEvent("ui.tracesift.pick_cancelled"); return; }
      await this.analyze(picked.path, profileType);
    } catch (error) {
      countUiEvent("ui.tracesift.pick_failed");
      captureUiError(error, "tracesift.pick");
      if (!this.disposed) this.update({ error: error instanceof Error ? error.message : "That profile could not be chosen." });
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

  /**
   * The folder saved by a previous panel, if it is still there. Called once the
   * host is connected rather than from `hostChanged`, which re-enters on every
   * theme and context change.
   */
  loadProject = async () => {
    this.update({ projectBusy: true });
    try {
      const result = await this.app.callServerTool({ name: "mobile_get_tracesift_project", arguments: {} });
      if (this.disposed || result.isError) return;
      const path = result.structuredContent?.path;
      if (typeof path === "string" && path !== "") this.update({ project: path });
      countUiEvent(typeof path === "string" && path !== "" ? "ui.tracesift.project_hit" : "ui.tracesift.project_miss");
    } catch (error) {
      countUiEvent("ui.tracesift.project_failed");
      captureUiError(new Error("The saved TraceSift project could not be read."), "tracesift.project");
    } finally { this.update({ projectBusy: false }); }
  };

  /** Choose the folder, through the host's own dialog. Cancel keeps the current one. */
  pickProject = async () => {
    if (this.disposed || this.state.projectBusy) return;
    this.update({ projectBusy: true, error: "" });
    const startedAt = performance.now();
    try {
      const result = await this.app.callServerTool({ name: "mobile_pick_tracesift_project", arguments: {} });
      if (this.disposed) return;
      recordUiTiming("ui.tracesift.project_pick", performance.now() - startedAt);
      if (result.isError) throw new Error(result.content.filter(item => item.type === "text").map(item => item.text).join("\n") || "This host could not open a folder dialog.");
      const picked = result.structuredContent;
      if (picked?.picked !== true || typeof picked.path !== "string") { countUiEvent("ui.tracesift.project_cancelled"); return; }
      countUiEvent("ui.tracesift.project_chosen");
      this.update({ project: picked.path });
    } catch (error) {
      countUiEvent("ui.tracesift.project_failed");
      captureUiError(error, "tracesift.project");
      if (!this.disposed) this.update({ error: error instanceof Error ? error.message : "That project folder could not be chosen." });
    } finally { this.update({ projectBusy: false }); }
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
    // The pane has no reading, so the profile kind is cleared rather than left
    // naming the one the next measurements would be attributed against.
    setUiTelemetryContext({ tracesift_view: "upload", tracesift_profile: "none" });
    countUiEvent("ui.tracesift.reset");
  };

  dispose() {
    this.disposed = true;
    if (this.copiedTimer !== undefined) clearTimeout(this.copiedTimer);
    this.listeners.clear();
  }
}
