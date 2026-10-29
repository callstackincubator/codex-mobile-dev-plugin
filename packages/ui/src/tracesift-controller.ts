import { canMessage, ChatDeliveryError, sendChat } from "./chat-message.ts";
import { cardsCallTools } from "./host-bridge.ts";
import type { HostBridge } from "./host-bridge.ts";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { traceSiftAnalysisSchema, traceSiftHandoffSchema, traceSiftRestoreSchema, type TraceSiftAnalysis, type TraceSiftProfileType } from "@mobile-dev/shared/tracesift.ts";
import { decodeTraceSiftExplorePayload, TRACE_SIFT_PAYLOAD_MAX_BYTES, traceSiftExploreEnvelopeSchema, TRACE_SIFT_PAYLOAD_TOO_LARGE, traceSiftPayloadRefused, type TraceSiftExploreKind } from "@mobile-dev/shared/tracesift-explore.ts";
import type { ReactExploreHandoff, TaskHandoff } from "@callstack/tracesift-explore";
import { buildSelectionPrompt, frameSelectionEvidence, type SelectionCard } from "./tracesift/selection.ts";
import { buildReactSelectionPrompt, reactSelectionEvidence, type ReactSelectionRecording } from "./tracesift/react-selection.ts";
import type { ContributionChartKind } from "./tracesift/contribution.ts";
import { captureUiError, countUiEvent, markUiSurfaceReady, recordUiTiming, setUiGauge, setUiSurface, setUiTelemetryContext } from "./telemetry.ts";
import { Store } from "./store.ts";
import { callTool, ToolCallError, toolResultText } from "./tool-call.ts";
import type { ToolCallParams } from "./tool-call.ts";

/** The finding the explorer draws, as the payload tool delivered it. */
type ExplorerPayload = { kind: "task"; payload: TaskHandoff } | { kind: "react"; payload: ReactExploreHandoff };

type State = {
  analysis?: TraceSiftAnalysis;
  canInvestigate: boolean;
  /** Explore, the project and hand-offs need the host to let cards call the server. */
  canCallTools: boolean;
  dark: boolean;
  busyCard?: string;
  error: string;
  /** Said when a finding was handed to the browser window instead of this panel. */
  notice: string;
  /** Source folder for investigations; Investigate waits for it. */
  project?: string;
  /** True while the saved folder is being read or its dialog is open. */
  projectBusy: boolean;
  /** File name the upload pane is waiting on. Absent in the inline card. */
  analyzing?: { name: string; profileType: TraceSiftProfileType };
  chartKind: ContributionChartKind;
  /** The card whose hand-off is being fetched, and the one just copied. */
  handoffCard?: string;
  copiedCard?: string;
  openingExploreCard?: string;
  /** The finding whose full explorer is on screen, or nothing while in the cards list. */
  explorer?: ExplorerPayload & {
    cardId: string;
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

export class TraceSiftController extends Store<State> {
  private disposed = false;
  private readyAt = performance.now();
  /** When the current explorer's payload arrived, so its own readiness can be timed. */
  private explorerReadyAt = 0;
  private readonly app: HostBridge;
  private viewId?: string | number;
  private inputKey?: string;
  private copiedTimer?: ReturnType<typeof setTimeout>;
  /** Serializes `mobile_remember_tracesift_analysis` calls so out-of-order completions cannot write a stale analysis over a newer one. */
  private rememberChain: Promise<void> = Promise.resolve();
  /** Bumped by every restore attempt; a response only applies while it still matches the latest one requested. */
  private restoreToken = 0;
  constructor(app: HostBridge) {
    super({ canInvestigate: false, canCallTools: false, dark: false, error: "", notice: "", chartKind: "bar", projectBusy: false });
    this.app = app;
  }

  /** The authoritative hand-off for one card. Investigate sends it; Copy copies it. */
  private async handoff(cardId: string) {
    const analysisId = this.state.analysis?.analysisId;
    if (!analysisId) throw new Error("No analysis is open.");
    const startedAt = performance.now();
    const result = await callTool(this.app, { name: "mobile_get_tracesift_handoff", arguments: { analysisId, cardId } }, {
      fallback: "TraceSift could not prepare this investigation.", answered: () => recordUiTiming("ui.tracesift.handoff", performance.now() - startedAt),
    });
    const parsed = traceSiftHandoffSchema.safeParse(result.structuredContent);
    if (!parsed.success) throw new Error("TraceSift returned an invalid handoff result.");
    return parsed.data.handoff;
  }
  hostChanged() {
    // TraceSift's components read the theme from a `.dark` ancestor, not the document attribute.
    this.update({
      canInvestigate: cardsCallTools(this.app) && canMessage(this.app),
      canCallTools: cardsCallTools(this.app),
      dark: this.app.getHostContext()?.theme === "dark",
    });
  }
  accept(result: CallToolResult, remember = true) {
    if (this.disposed) return;
    if (result.isError) {
      this.update({ error: toolResultText(result) });
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
        const result = await callTool(this.app, { name: "mobile_remember_tracesift_analysis", arguments: { viewId, analysisId } }, {
          answered: () => recordUiTiming("ui.tracesift.remember", performance.now() - startedAt),
        });
        if (result.structuredContent?.remembered !== true) throw new Error("TraceSift could not remember this analysis.");
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
  restore = (viewId: string | number) => this.restoreFrom({ name: "mobile_restore_tracesift_analysis", arguments: { viewId } }, "TraceSift analysis restore failed.", "tracesift.restore");
  private restoreInput = (path: string, profileType: TraceSiftProfileType) =>
    this.restoreFrom({ name: "mobile_restore_tracesift_analysis_by_input", arguments: { path, profileType } }, "TraceSift analysis input restore failed.", "tracesift.restore_input");
  private async restoreFrom(params: ToolCallParams, failure: string, operation: string) {
    if (this.disposed || this.state.analysis || !cardsCallTools(this.app)) return;
    const token = ++this.restoreToken;
    const startedAt = performance.now();
    // A restore no longer applies once the card closed, an analysis arrived, or a newer restore started.
    const stale = () => this.disposed || this.state.analysis !== undefined || token !== this.restoreToken;
    try {
      const result = await callTool(this.app, params, {
        fallback: "TraceSift could not restore this analysis.", answered: () => recordUiTiming("ui.tracesift.restore", performance.now() - startedAt),
      });
      if (stale()) return;
      const parsed = traceSiftRestoreSchema.safeParse(result.structuredContent);
      if (!parsed.success) throw new Error("TraceSift returned an invalid restore result.");
      countUiEvent(parsed.data.restored ? "ui.tracesift.restore_hit" : "ui.tracesift.restore_miss");
      if (parsed.data.analysis) this.accept({ content: [], structuredContent: parsed.data.analysis }, false);
    } catch (error) {
      if (token !== this.restoreToken || (error instanceof ToolCallError && stale())) return;
      countUiEvent("ui.tracesift.restore_failed");
      captureUiError(new Error(failure), operation);
      if (!this.state.analysis) this.update({ error: error instanceof Error ? error.message : "TraceSift could not restore this analysis." });
    }
  }
  /** A profile names frames, not files; the picked folder tells the agent where to look. */
  private inProject(handoff: string, project: string) {
    return `Investigate this in the project at ${project}.\n\n${handoff}`;
  }

  /** Sends one hand-off to the active chat. Never retry a timeout: the message may have landed. */
  private async sendHandoff(text: string, event: string) {
    try {
      const sendStartedAt = performance.now();
      await sendChat(this.app, text);
      recordUiTiming("ui.tracesift.message_ack", performance.now() - sendStartedAt);
      countUiEvent(event);
    } catch (error) {
      const failure = error instanceof ChatDeliveryError ? error.reason : undefined;
      countUiEvent(failure === "unconfirmed" ? "ui.tracesift.delivery_unconfirmed" : failure === "no-composer" ? "ui.tracesift.composer_unavailable" : "ui.tracesift.send_failed");
      if (failure !== "unconfirmed" && failure !== "no-composer") captureUiError(new Error("TraceSift investigation action failed."), "tracesift.investigate");
      throw new Error(failure === "unconfirmed"
        ? "The host did not confirm delivery. Check the chat before retrying to avoid sending the investigation twice."
        : failure === "no-composer"
          ? "The host could not find this chat's input. Reopen the chat, then try Investigate again."
          : failure === "rejected" ? "The host could not start this investigation."
            : error instanceof Error ? error.message : "Could not start this investigation.",
        { cause: error });
    }
  }

  investigate = async (cardId: string) => {
    const { analysis, canInvestigate, busyCard, project } = this.state;
    if (!analysis || !canInvestigate || !project || busyCard || this.disposed || !analysis.cards.some(card => card.id === cardId)) return;
    this.update({ busyCard: cardId, error: "" });
    try {
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
      const result = await callTool(this.app, {
        name: "mobile_tracesift_explore_payload",
        arguments: analysis.profileType === "cpu"
          ? { analysisId: analysis.analysisId, taskIndex: card.taskIndex }
          : { analysisId: analysis.analysisId },
      }, { fallback: "TraceSift could not open this task." });
      const envelope = traceSiftExploreEnvelopeSchema.safeParse(result.structuredContent);
      if (!envelope.success) throw new Error("TraceSift did not return the data this explorer needs.");
      if (envelope.data.payloadBytes > TRACE_SIFT_PAYLOAD_MAX_BYTES) throw new Error(TRACE_SIFT_PAYLOAD_TOO_LARGE);
      const decoded = await decodeTraceSiftExplorePayload(result, envelope.data);
      // `accept` may have replaced the analysis while the payload loaded; installing it would pair the new reading with an unknown card id.
      if (this.disposed || this.state.analysis?.analysisId !== analysis.analysisId) {
        this.update({ openingExploreCard: undefined });
        return;
      }
      const kind: TraceSiftExploreKind = envelope.data.kind;
      // The explorer and the selection hand-offs check the fields they read.
      const loaded: ExplorerPayload = kind === "task" ? { kind, payload: decoded as TaskHandoff } : { kind, payload: decoded as ReactExploreHandoff };
      // Switched before recording timings so the fetch is attributed to the explorer.
      setUiTelemetryContext({ tracesift_view: "explorer" });
      recordUiTiming("ui.tracesift.payload", performance.now() - startedAt);
      setUiGauge("ui.tracesift.payload_bytes", envelope.data.payloadBytes);
      this.explorerReadyAt = startedAt;
      // The host may decline fullscreen; the explorer still works inline.
      void this.requestDisplayMode("fullscreen");
      this.update({
        openingExploreCard: undefined,
        explorer: {
          ...loaded, cardId,
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
  private taskSelectionHandoff(handoff: TaskHandoff | null, selected: readonly string[], profileTitle?: string) {
    const card: SelectionCard | undefined = typeof handoff?.card === "object" && handoff.card !== null ? handoff.card : undefined;
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
  private reactSelectionHandoff(handoff: ReactExploreHandoff | null, selected: readonly string[], profileTitle?: string) {
    const recording: ReactSelectionRecording | undefined = typeof handoff?.explore === "object" && handoff.explore !== null ? handoff.explore : undefined;
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
    const { analysis, canInvestigate, busyCard, explorer, project } = this.state;
    if (!analysis || !canInvestigate || !project || busyCard || this.disposed) return;
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
      const result = await callTool(this.app, {
        name: "mobile_open_tracesift_explore",
        arguments: analysis.profileType === "cpu"
          ? { analysisId: analysis.analysisId, taskIndex: card.taskIndex, ...(focus ? { focus } : {}) }
          : { analysisId: analysis.analysisId, rootId: card.rootId, commitIndex: card.commitIndex },
      }, { fallback: "TraceSift could not open this task." });
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
      const result = await callTool(this.app, { name: "mobile_pick_profile_file", arguments: {} }, { fallback: "This host could not open a file dialog." });
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

  /** Analyze one profile by path. `accept` installs the cards this returns. */
  analyze = async (path: string, profileType: TraceSiftProfileType) => {
    if (this.disposed || this.state.analyzing) return;
    const name = path.split(/[\\/]/).pop() || path;
    this.inputKey = JSON.stringify({ path, profileType });
    this.update({ analyzing: { name, profileType }, error: "", notice: "" });
    const startedAt = performance.now();
    try {
      const result = await callTool(this.app, { name: "mobile_analyze_profile", arguments: { path, profileType } }, {
        fallback: "TraceSift could not analyze this profile.", answered: () => { if (!this.disposed) recordUiTiming("ui.tracesift.analyze", performance.now() - startedAt); },
      });
      if (this.disposed) return;
      countUiEvent("ui.tracesift.analyze");
      this.accept(result);
    } catch (error) {
      // An answer that lands after the card closed is dropped, failed or not.
      if (this.disposed && error instanceof ToolCallError) return;
      countUiEvent("ui.tracesift.analyze_failed");
      captureUiError(error, "tracesift.analyze");
      if (!this.disposed) this.update({ error: error instanceof Error ? error.message : "TraceSift could not analyze this profile." });
    } finally { this.update({ analyzing: undefined }); }
  };

  /**
   * The folder saved by a previous panel, if still there. Called once the host connects,
   * not from `hostChanged`, which re-enters on every theme and context change.
   */
  loadProject = async () => {
    if (!cardsCallTools(this.app)) return;
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

  /** Chooses the folder through the host's dialog; cancel keeps the current one. */
  pickProject = async () => {
    if (this.disposed || this.state.projectBusy) return;
    this.update({ projectBusy: true, error: "" });
    const startedAt = performance.now();
    try {
      const result = await callTool(this.app, { name: "mobile_pick_tracesift_project", arguments: {} }, {
        fallback: "This host could not open a folder dialog.", answered: () => { if (!this.disposed) recordUiTiming("ui.tracesift.project_pick", performance.now() - startedAt); },
      });
      if (this.disposed) return;
      const picked = result.structuredContent;
      if (picked?.picked !== true || typeof picked.path !== "string") { countUiEvent("ui.tracesift.project_cancelled"); return; }
      countUiEvent("ui.tracesift.project_chosen");
      this.update({ project: picked.path });
    } catch (error) {
      if (this.disposed && error instanceof ToolCallError) return;
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
    // Clear the profile kind so later measurements are not attributed to the previous reading.
    setUiTelemetryContext({ tracesift_view: "upload", tracesift_profile: "none" });
    countUiEvent("ui.tracesift.reset");
  };

  dispose() {
    this.disposed = true;
    if (this.copiedTimer !== undefined) clearTimeout(this.copiedTimer);
    this.close();
  }
}
