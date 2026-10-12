import type { App } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { OpenAIMessageParams } from "@openai/mcp-extensions/app";
import { traceSiftAnalysisSchema, traceSiftHandoffSchema, type TraceSiftAnalysis } from "../shared/tracesift.ts";
import { captureUiError, countUiEvent, markUiSurfaceReady, recordUiTiming, setUiGauge, setUiSurface } from "./telemetry.ts";

type State = { analysis?: TraceSiftAnalysis; canInvestigate: boolean; busyCard?: string; error: string };

function composerUnavailable(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:no (?:active |available )?composer|composer.*(?:unavailable|not available|not active)|requires? an (?:active|available) composer|MCP app messages are disabled for this view)/i.test(message);
}

export class TraceSiftController {
  private state: State = { canInvestigate: false, error: "" };
  private listeners = new Set<() => void>();
  private disposed = false;
  private readonly readyAt = performance.now();
  private readonly app: App;
  constructor(app: App) { this.app = app; }
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
  accept(result: CallToolResult) {
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
    this.update({ analysis, error: "", busyCard: undefined });
    markUiSurfaceReady(this.readyAt);
  }
  investigate = async (cardId: string) => {
    const { analysis, canInvestigate, busyCard } = this.state;
    if (!analysis || !canInvestigate || busyCard || this.disposed || !analysis.cards.some(card => card.id === cardId)) return;
    this.update({ busyCard: cardId, error: "" });
    let sending = false;
    let toolFailed = false;
    try {
      const handoffStartedAt = performance.now();
      const result = await this.app.callServerTool({ name: "mobile_get_tracesift_handoff", arguments: { analysisId: analysis.analysisId, cardId } });
      recordUiTiming("ui.tracesift.handoff", performance.now() - handoffStartedAt);
      if (result.isError) { toolFailed = true; throw new Error(result.content.filter(item => item.type === "text").map(item => item.text).join("\n") || "TraceSift could not prepare this investigation."); }
      const parsed = traceSiftHandoffSchema.safeParse(result.structuredContent);
      if (!parsed.success) throw new Error("TraceSift returned an invalid handoff result.");
      const { handoff } = parsed.data;
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
  dispose() { this.disposed = true; this.listeners.clear(); }
}
