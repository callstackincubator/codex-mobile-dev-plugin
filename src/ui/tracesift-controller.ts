import type { App } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { OpenAIMessageParams } from "@openai/mcp-extensions/app";
import { traceSiftAnalysisSchema, traceSiftHandoffSchema, traceSiftRestoreSchema, type TraceSiftAnalysis, type TraceSiftProfileType } from "../shared/tracesift.ts";
import type { ContributionChartKind } from "./components/tracesift/contribution-chart.tsx";
import { captureUiError, countUiEvent, markUiSurfaceReady, recordUiTiming, setUiGauge, setUiSurface } from "./telemetry.ts";

type State = {
  analysis?: TraceSiftAnalysis;
  canInvestigate: boolean;
  busyCard?: string;
  error: string;
  /** Which drawing every card on this analysis carries; one switch, as on the web. */
  chartKind: ContributionChartKind;
  /** The card whose hand-off is being fetched, and the one just copied. */
  handoffCard?: string;
  copiedCard?: string;
  openingExploreCard?: string;
};

function composerUnavailable(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:no (?:active |available )?composer|composer.*(?:unavailable|not available|not active)|requires? an (?:active|available) composer|MCP app messages are disabled for this view)/i.test(message);
}

export class TraceSiftController {
  private state: State = { canInvestigate: false, error: "", chartKind: "bar" };
  private listeners = new Set<() => void>();
  private disposed = false;
  private readonly readyAt = performance.now();
  private readonly app: App;
  private viewId?: string | number;
  private inputKey?: string;
  private copiedTimer?: ReturnType<typeof setTimeout>;
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
    this.update({ canInvestigate: Boolean(capabilities?.serverTools && capabilities?.message?.text) });
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
    this.update({ analysis, error: "", busyCard: undefined, copiedCard: undefined, handoffCard: undefined, openingExploreCard: undefined });
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
  private remember = async (viewId: string | number, analysisId: string) => {
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
  restore = async (viewId: string | number) => {
    if (this.disposed || this.state.analysis) return;
    const startedAt = performance.now();
    try {
      const result = await this.app.callServerTool({ name: "mobile_restore_tracesift_analysis", arguments: { viewId } });
      recordUiTiming("ui.tracesift.restore", performance.now() - startedAt);
      if (this.disposed || this.state.analysis) return;
      if (result.isError) throw new Error(result.content.filter(item => item.type === "text").map(item => item.text).join("\n") || "TraceSift could not restore this analysis.");
      const parsed = traceSiftRestoreSchema.safeParse(result.structuredContent);
      if (!parsed.success) throw new Error("TraceSift returned an invalid restore result.");
      countUiEvent(parsed.data.restored ? "ui.tracesift.restore_hit" : "ui.tracesift.restore_miss");
      if (parsed.data.analysis) this.accept({ content: [], structuredContent: parsed.data.analysis }, false);
    } catch (error) {
      countUiEvent("ui.tracesift.restore_failed");
      captureUiError(new Error("TraceSift analysis restore failed."), "tracesift.restore");
      if (!this.state.analysis) this.update({ error: error instanceof Error ? error.message : "TraceSift could not restore this analysis." });
    }
  };
  private restoreInput = async (path: string, profileType: TraceSiftProfileType) => {
    if (this.disposed || this.state.analysis) return;
    const startedAt = performance.now();
    try {
      const result = await this.app.callServerTool({ name: "mobile_restore_tracesift_analysis_by_input", arguments: { path, profileType } });
      recordUiTiming("ui.tracesift.restore", performance.now() - startedAt);
      if (this.disposed || this.state.analysis) return;
      if (result.isError) throw new Error(result.content.filter(item => item.type === "text").map(item => item.text).join("\n") || "TraceSift could not restore this analysis.");
      const parsed = traceSiftRestoreSchema.safeParse(result.structuredContent);
      if (!parsed.success) throw new Error("TraceSift returned an invalid restore result.");
      countUiEvent(parsed.data.restored ? "ui.tracesift.restore_hit" : "ui.tracesift.restore_miss");
      if (parsed.data.analysis) this.accept({ content: [], structuredContent: parsed.data.analysis }, false);
    } catch (error) {
      countUiEvent("ui.tracesift.restore_failed");
      captureUiError(new Error("TraceSift analysis input restore failed."), "tracesift.restore_input");
      if (!this.state.analysis) this.update({ error: error instanceof Error ? error.message : "TraceSift could not restore this analysis." });
    }
  };
  investigate = async (cardId: string) => {
    const { analysis, canInvestigate, busyCard } = this.state;
    if (!analysis || !canInvestigate || busyCard || this.disposed || !analysis.cards.some(card => card.id === cardId)) return;
    this.update({ busyCard: cardId, error: "" });
    let sending = false;
    let toolFailed = false;
    try {
      let handoff: string;
      try { handoff = await this.handoff(cardId); }
      catch (error) { toolFailed = true; throw error; }
      const message: OpenAIMessageParams = { role: "user", content: [{ type: "text", text: handoff }], _meta: { "openai/message": { target: "active", send: true } } };
      const sendStartedAt = performance.now();
      sending = true;
      const sent = await this.app.sendMessage(message, { timeout: 5000, maxTotalTimeout: 5000 });
      if (sent.isError) throw new Error("Codex could not start this investigation.");
      recordUiTiming("ui.tracesift.message_ack", performance.now() - sendStartedAt);
      countUiEvent("ui.tracesift.investigate");
    } catch (error) {
      const timedOut = sending && typeof error === "object" && error !== null && "code" in error && error.code === -32001;
      const missingComposer = sending && composerUnavailable(error);
      countUiEvent(timedOut ? "ui.tracesift.delivery_unconfirmed" : missingComposer ? "ui.tracesift.composer_unavailable" : toolFailed ? "ui.tracesift.handoff_failed" : "ui.tracesift.send_failed");
      if (!timedOut && !missingComposer && !toolFailed) captureUiError(new Error("TraceSift investigation action failed."), "tracesift.investigate");
      this.update({ error: timedOut
        ? "Codex did not confirm delivery. Check the chat before retrying to avoid sending the investigation twice."
        : missingComposer
          ? "Codex could not find this chat's input. Reopen the chat, then try Investigate again."
        : error instanceof Error ? error.message : "Could not start this investigation." });
    } finally { this.update({ busyCard: undefined }); }
  };
  setChartKind = (chartKind: ContributionChartKind) => { this.update({ chartKind }); };

  /**
   * The card's hand-off on the clipboard, which is the same text Investigate
   * sends. A reader who wants to paste it into another tool, or read it before
   * committing a turn to it, has no other way to get at it.
   */
  copyHandoff = async (cardId: string) => {
    if (this.state.handoffCard || this.disposed) return;
    this.update({ handoffCard: cardId, copiedCard: undefined, error: "" });
    try {
      const handoff = await this.handoff(cardId);
      await navigator.clipboard.writeText(handoff);
      countUiEvent("ui.tracesift.copy_handoff");
      this.update({ copiedCard: cardId });
      // Long enough to read, short enough that the button is back to itself
      // before anyone reaches for it again.
      this.copiedTimer = setTimeout(() => this.update({ copiedCard: undefined }), 2000);
    } catch (error) {
      countUiEvent("ui.tracesift.copy_failed");
      this.update({ error: error instanceof Error ? error.message : "That hand-off could not be copied." });
    } finally { this.update({ handoffCard: undefined }); }
  };

  openExplore = async (cardId: string, focus = "") => {
    const { analysis } = this.state;
    if (!analysis || this.disposed || this.state.openingExploreCard) return;
    const card = analysis.cards.find(entry => entry.id === cardId);
    if (!card) return;
    this.update({ openingExploreCard: cardId, error: "" });
    const startedAt = performance.now();
    try {
      const result = await this.app.callServerTool({
        name: "mobile_open_tracesift_explore",
        arguments: analysis.profileType === "cpu"
          ? { analysisId: analysis.analysisId, taskIndex: card.taskIndex, ...(focus ? { focus } : {}) }
          : { analysisId: analysis.analysisId, rootId: card.rootId, commitIndex: card.commitIndex },
      });
      if (result.isError) throw new Error(result.content.filter(item => item.type === "text").map(item => item.text).join("\n") || "TraceSift could not open this task.");
      if (result.structuredContent?.opened !== true) throw new Error("TraceSift did not confirm that Explore opened.");
      recordUiTiming("ui.tracesift.explore", performance.now() - startedAt);
      countUiEvent("ui.tracesift.explore");
    } catch (error) {
      countUiEvent("ui.tracesift.explore_failed");
      this.update({ error: error instanceof Error ? error.message : "That task could not be opened." });
    } finally { this.update({ openingExploreCard: undefined }); }
  };

  dispose() {
    this.disposed = true;
    if (this.copiedTimer !== undefined) clearTimeout(this.copiedTimer);
    this.listeners.clear();
  }
}
